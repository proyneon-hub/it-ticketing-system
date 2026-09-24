import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { outboxStatuses } from '../shared/ticket-constants';
import { logger } from './logger';
import { countByStatus } from './repositories/outboxRepository';

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
  help: 'Outbox events by status. A growing "dead" count needs an admin.',
  labelNames: ['status'],
  registers: [registry],
  async collect() {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const counts = new Map((await countByStatus()).map((row) => [row._id, row.count]));
      for (const status of outboxStatuses) this.set({ status }, counts.get(status) ?? 0);
    } catch (error) {
      logger.warn({ err: error }, 'Could not read outbox counts for metrics');
    }
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
