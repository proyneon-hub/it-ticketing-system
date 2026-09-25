import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { proposalStatuses } from '../shared/agent-constants';
import { outboxStatuses } from '../shared/ticket-constants';
import { logger } from './logger';
import * as agentRuns from './repositories/agentRunRepository';
import * as agentSettings from './repositories/agentSettingsRepository';
import { countByStatus } from './repositories/outboxRepository';
import { countByProposalStatus } from './repositories/ticketRepository';

// Prometheus metrics for the running process, served at GET /api/metrics (routes/metrics.ts).
// They are per instance: a container's numbers describe that container, and a serverless
// deployment gets one small process per warm function, so they are only meaningful for
// the long-running Docker deployment (docs/RUNBOOK.md).

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// The route label is the path template ("/api/tickets/:id"), never the URL that was requested.
// A label built from raw URLs would create a new time series for every ticket id and every
// scanner probe, and grow without limit. A request that never reached a route handler is
// "unmatched": an unknown path, or one turned away by authentication before its route.
export function routeLabel(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const path: unknown = req.route?.path;
  return typeof path === 'string' ? `${req.baseUrl}${path}` || '/' : 'unmatched';
}

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Time to answer an HTTP request, by route template.',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests answered, by route template and status code.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const ticketsCreated = new Counter({
  name: 'tickets_created_total',
  help: 'Tickets created since the process started.',
  registers: [registry],
});

export const slaEscalations = new Counter({
  name: 'sla_escalations_total',
  help: 'Tickets marked by the SLA escalation job.',
  labelNames: ['kind'],
  registers: [registry],
});

export const outboxDeliveries = new Counter({
  name: 'outbox_deliveries_total',
  help: 'Webhook delivery attempts by outcome.',
  labelNames: ['result'],
  registers: [registry],
});

// How many events are in each state, read from the database when Prometheus scrapes. It
// only reads while a connection is already open, so a scrape never causes a connection
// (and a database outage does not stop the other metrics from being served).
new Gauge({
  name: 'outbox_events',
  help: 'Webhook outbox events by status. A growing "dead" count needs an admin.',
  labelNames: ['status'],
  registers: [registry],
  async collect() {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const counts = new Map((await countByStatus('webhook')).map((row) => [row._id, row.count]));
      for (const status of outboxStatuses) this.set({ status }, counts.get(status) ?? 0);
    } catch (error) {
      logger.warn({ err: error }, 'Could not read outbox counts for metrics');
    }
  },
});

// --- The service desk agent ------------------------------------------------------------------
//
// Two kinds, for the reason the outbox gauge above reads the database: a serverless deployment has
// a small process per warm function, so what happened in one process says little. What a person wants
// to know (how many runs, how they ended, what was spent, whether the switch is on) is read from the
// database when Prometheus scrapes, and is right whichever process answers. The counters below are
// only the fine detail of the runs this process did itself (tool calls, tokens, how long a run took).

export const agentRunDuration = new Histogram({
  name: 'agent_run_duration_seconds',
  help: 'Time the agent took over one ticket, by how the run ended.',
  labelNames: ['outcome', 'mode'],
  buckets: [0.5, 1, 2, 5, 10, 20, 40, 80, 160],
  registers: [registry],
});

export const agentToolCalls = new Counter({
  name: 'agent_tool_calls_total',
  help: 'Tool calls the agent made in this process, by tool and whether they failed.',
  labelNames: ['tool', 'is_error'],
  registers: [registry],
});

export const agentTokens = new Counter({
  name: 'agent_tokens_total',
  help: 'Tokens the agent used in this process, by model and kind.',
  labelNames: ['model', 'direction'],
  registers: [registry],
});

const DAY_MS = 24 * 60 * 60 * 1000;

// Reads only while a connection is open, like the outbox gauge, so a scrape never causes one.
function collectFromDatabase(what: string, read: () => Promise<void>) {
  return async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      await read();
    } catch (error) {
      logger.warn({ err: error }, `Could not read ${what} for metrics`);
    }
  };
}

new Gauge({
  name: 'agent_runs',
  help: 'Agent runs started in the last 24 hours, by mode, outcome and model.',
  labelNames: ['mode', 'outcome', 'model'],
  registers: [registry],
  collect() {
    return collectFromDatabase('agent runs', async () => {
      this.reset();
      for (const row of await agentRuns.countRunsSince(new Date(Date.now() - DAY_MS))) {
        this.set(row._id, row.count);
      }
    })();
  },
});

new Gauge({
  name: 'agent_proposals',
  help: 'Tickets by where the agent’s drafted reply stands. Approved and edited against rejected is how often the draft was good enough.',
  labelNames: ['status'],
  registers: [registry],
  collect() {
    return collectFromDatabase('agent proposals', async () => {
      const counts = new Map((await countByProposalStatus()).map((row) => [row._id, row.count]));
      for (const status of proposalStatuses.filter((s) => s !== 'none')) {
        this.set({ status }, counts.get(status) ?? 0);
      }
    })();
  },
});

new Gauge({
  name: 'agent_cost_usd_today',
  help: 'What agent runs started since 00:00 UTC have cost, in US dollars, by model.',
  labelNames: ['model'],
  registers: [registry],
  collect() {
    return collectFromDatabase('agent cost', async () => {
      this.reset();
      const now = new Date();
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      for (const row of await agentRuns.costByModelSince(since)) {
        this.set({ model: row._id }, row.total);
      }
    })();
  },
});

new Gauge({
  name: 'agent_kill_switch',
  help: '1 while the agent’s kill switch is on, otherwise 0.',
  registers: [registry],
  collect() {
    return collectFromDatabase('the kill switch', async () => {
      this.set((await agentSettings.read())?.killSwitch === true ? 1 : 0);
    })();
  },
});

new Gauge({
  name: 'agent_events',
  help: 'Outbox events waiting for the agent, by status. A growing "pending" means the worker is not running; "dead" means runs gave up.',
  labelNames: ['status'],
  registers: [registry],
  collect() {
    return collectFromDatabase('agent events', async () => {
      const counts = new Map((await countByStatus('agent')).map((row) => [row._id, row.count]));
      for (const status of outboxStatuses) this.set({ status }, counts.get(status) ?? 0);
    })();
  },
});

// Times every request and counts it when the response is finished.
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const stop = httpDuration.startTimer();
  res.on('finish', () => {
    const route = routeLabel(req);
    stop({ method: req.method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` });
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}
