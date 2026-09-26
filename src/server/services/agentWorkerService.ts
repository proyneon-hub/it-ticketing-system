import { AnthropicModelClient, hasAnthropicKey } from '../agent/anthropicClient';
import { createHttpApi } from '../agent/httpApi';
import { runAgent } from '../agent/loop';
import { DEFAULT_PROMPT, loadPrompt, type Prompt } from '../agent/prompt';
import type { ModelClient, RunContext, RunOutcome } from '../agent/types';
import type { AgentRunMode } from '../../shared/agent-constants';
import { agentEnabled } from '../config';
import { breakerConfig, breakerState } from '../domain/agentBreaker';
import { autoModeAvailable, effectiveMode } from '../domain/agentPolicy';
import { isPricedModel } from '../domain/agentPricing';
import { MAX_ATTEMPTS, backoffMs } from '../domain/outbox';
import { logger } from '../logger';
import { agentRunDuration, agentTokens, agentToolCalls } from '../metrics';
import * as outboxRepository from '../repositories/outboxRepository';
import type { OutboxEventRecord } from '../repositories/outboxRepository';
import * as runs from '../repositories/agentRunRepository';
import * as tickets from '../repositories/ticketRepository';
import { issueServiceToken } from '../security/accessToken';
import { getSettings } from './agentSettingsService';
import { recordProposal } from './proposalService';

// Turns outbox events into agent runs. Each `ticket.created` event the agent is listening for
// becomes at most one run for that version of that ticket. The worker is the trusted side of the
// design (docs/adr/009): it may read the database to decide whether and how to run, and it mints
// the run's token. The agent itself gets nothing but that token and the ticketing API.
//
// Every path ends with the ticket in front of a person, which is where every ticket is without the
// agent: a run that fails, is stopped, or is skipped changes nothing about the ticket.

type Env = Record<string, string | undefined>;

// An event stays claimed longer than the time after which a run is considered dead
// (STALE_RUN_MS, five minutes), so if a worker dies the next one to claim the event finds a run it
// is allowed to take over, and not one that looks alive by a few milliseconds.
export const AGENT_LOCK_MS = 6 * 60 * 1000;

const DEFAULT_LIMIT = 5;
// Stop taking new events after this long, so a call fits inside a serverless time limit even when
// the last run takes a minute or more to finish.
const DEFAULT_BUDGET_MS = 100_000;

export const DEFAULT_MODEL = 'claude-sonnet-5';

const numberFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const agentModel = (env: Env = process.env): string =>
  env.AGENT_MODEL?.trim() || DEFAULT_MODEL;

// Where the agent reaches the ticketing API. Never taken from the request that triggered the run:
// the token would go wherever a Host header pointed. On Vercel it is the deployment's own address.
export function agentApiBaseUrl(env: Env = process.env): string {
  if (env.AGENT_API_BASE_URL?.trim()) return env.AGENT_API_BASE_URL.trim();
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return `http://127.0.0.1:${env.PORT || 5000}`;
}

// The start of the current day in UTC. The daily cost cap counts from here.
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export interface AgentRunsResult {
  // False when the agent is not on or cannot run; nothing was claimed, and `reason` says why.
  configured: boolean;
  reason?: 'disabled' | 'no_api_key' | 'bad_model';
  // Runs that finished, whatever their outcome.
  ran: number;
  // Events with nothing to do: already handled, the ticket is gone, the agent is off for it, or
  // the day's cost cap has been reached.
  skipped: number;
  // Runs that failed. Each is retried later, or marked dead after the last attempt.
  failed: number;
  // True when the call stopped at its limit or time budget with events possibly still waiting.
  more: boolean;
}

export interface AgentWorkerOptions {
  now?: Date;
  // The most events to work on in one call.
  limit?: number;
  budgetMs?: number;
  env?: Env;
  // For tests: the model to use instead of the real one, and a stand-in for fetch.
  modelClient?: () => ModelClient;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  prompt?: Prompt;
}

const notConfigured = (reason: NonNullable<AgentRunsResult['reason']>): AgentRunsResult => ({
  configured: false,
  reason,
  ran: 0,
  skipped: 0,
  failed: 0,
  more: false,
});

// A short, safe description of why a run failed, for the record. Error messages from the API or
// the network can be long; nothing in them is a person's text (ApiError never carries a body).
const describeFailure = (error: unknown): string => {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 300);
};

const toResult = (outcome: RunOutcome): runs.RunResult => ({
  outcome: outcome.outcome,
  outcomeReason: outcome.reason,
  steps: outcome.steps,
  inputTokens: outcome.usage.input,
  outputTokens: outcome.usage.output,
  cacheReadTokens: outcome.usage.cacheRead,
  cacheWriteTokens: outcome.usage.cacheWrite,
  costUsd: outcome.costUsd,
  latencyMs: outcome.latencyMs,
  triage: outcome.triage,
  proposal: outcome.proposal,
  escalationSummary: outcome.escalationSummary,
  intendedActions: outcome.intended,
});

const emptyResult = (outcomeReason: string): runs.RunResult => ({
  outcome: 'aborted',
  outcomeReason,
  steps: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  intendedActions: [],
});

interface Deps {
  // What time it is now. Read when each thing happens, so a run's start time is when it started and
  // not when the job did. A test can pin it with the `now` option.
  clock: () => Date;
  env: Env;
  model: string;
  prompt: Prompt;
  modelClient: () => ModelClient;
  baseUrl: string;
  fetchImpl: typeof fetch | undefined;
}

type Handled = 'ran' | 'skipped' | 'failed';

// The mode a run actually uses. Auto (the agent posting replies alone) is only for a deployment that
// allows it (autoModeAvailable: not on Vercel unless AGENT_ALLOW_AUTO=true). Anywhere else a setting of
// auto runs as assist: the agent triages and drafts, and a person still approves. The server refuses
// an auto post there too (services/agentResolutionService.ts), so this is not the only lock.
const runnableMode = (mode: 'shadow' | 'assist' | 'auto', env: Env): AgentRunMode => {
  if (mode === 'auto' && !autoModeAvailable(env)) {
    logger.warn({ requested: mode }, 'Agent auto mode is not available here; running as assist');
    return 'assist';
  }
  return mode;
};

const HOUR_MS = 60 * 60 * 1000;

// What this process did on one run, for the metrics that describe the detail (the ones that describe the
// whole system are read from the database when Prometheus scrapes).
function observeRun(outcome: RunOutcome, mode: AgentRunMode, model: string): void {
  agentRunDuration.observe({ outcome: outcome.outcome, mode }, outcome.latencyMs / 1000);
  const { input, output, cacheRead, cacheWrite } = outcome.usage;
  agentTokens.inc({ model, direction: 'input' }, input);
  agentTokens.inc({ model, direction: 'output' }, output);
  agentTokens.inc({ model, direction: 'cache_read' }, cacheRead);
  agentTokens.inc({ model, direction: 'cache_write' }, cacheWrite);
}

async function handle(event: OutboxEventRecord, deps: Deps): Promise<Handled> {
  const ticketId = event.payload.ticket.id;
  const done = () => outboxRepository.markDelivered(event._id, deps.clock());

  const ticket = await tickets.findById(ticketId);
  if (!ticket) {
    // Deleted since the event was written: nothing to triage.
    await done();
    return 'skipped';
  }

  const settings = await getSettings(deps.env);
  const mode = effectiveMode(settings, ticket.category);
  const version = ticket.__v ?? 0;
  const base = {
    ticketId: ticket._id,
    ticketVersion: version,
    model: deps.model,
    promptVersion: deps.prompt.version,
    ticketNumber: ticket.ticketNumber,
    requesterEmail: ticket.requesterEmail,
    // The request that created the ticket: one id links it, the event, this run and every call the
    // agent makes back into the API.
    requestId: event.requestId,
  };

  // Off, by the kill switch or for this category: recorded, so it can be seen, and not run.
  if (mode === 'off') {
    const begun = await runs.beginRun({ ...base, mode: 'shadow' }, deps.clock());
    if ('started' in begun) {
      await runs.finishRun(
        begun.started._id,
        begun.started.attempts,
        emptyResult(settings.killSwitch ? 'kill_switch' : 'mode_off'),
        deps.clock()
      );
    }
    await done();
    return 'skipped';
  }

  // Today's spending has reached the cap: recorded, and not run. The ticket stays with people.
  const spent = await runs.costSince(startOfUtcDay(deps.clock()));
  if (spent >= settings.dailyCostCapUsd) {
    const begun = await runs.beginRun({ ...base, mode: 'shadow' }, deps.clock());
    if ('started' in begun) {
      await runs.finishRun(
        begun.started._id,
        begun.started.attempts,
        emptyResult('daily_cost_cap'),
        deps.clock()
      );
    }
    await done();
    return 'skipped';
  }

  // The model or the API is failing: stop asking, and leave the ticket with people, until it has had
  // time to recover (domain/agentBreaker.ts). Worked out from the runs, so every instance agrees.
  const breaker = breakerConfig(deps.env);
  const state = breakerState(await runs.recentAttempts(breaker.failures), deps.clock(), breaker);
  if (state.open) {
    const paused = await runs.beginRun({ ...base, mode: 'shadow' }, deps.clock());
    if ('started' in paused) {
      await runs.finishRun(
        paused.started._id,
        paused.started.attempts,
        emptyResult('circuit_open'),
        deps.clock()
      );
    }
    await done();
    return 'skipped';
  }

  // One requester's tickets may only be run so often, so a person raising a stream of them cannot
  // run up the bill. Past the limit the ticket goes to a person, as it would without the agent.
  const recent = ticket.requesterEmail
    ? await runs.countForRequesterSince(
        ticket.requesterEmail,
        new Date(deps.clock().getTime() - HOUR_MS)
      )
    : 0;
  if (recent >= settings.perRequesterHourlyLimit) {
    const limited = await runs.beginRun({ ...base, mode: 'shadow' }, deps.clock());
    if ('started' in limited) {
      await runs.finishRun(
        limited.started._id,
        limited.started.attempts,
        emptyResult('requester_rate_limited'),
        deps.clock()
      );
    }
    await done();
    return 'skipped';
  }

  const runMode = runnableMode(mode, deps.env);
  const begun = await runs.beginRun({ ...base, mode: runMode }, deps.clock());
  if ('skipped' in begun) {
    if (begun.skipped === 'done') {
      await done();
      return 'skipped';
    }
    // Someone else is on it. Look again in a couple of minutes rather than give up.
    await outboxRepository.markForRetry(
      event._id,
      new Date(deps.clock().getTime() + 2 * 60 * 1000),
      'A run for this ticket is already in progress.'
    );
    return 'skipped';
  }

  const run = begun.started;
  const token = await issueServiceToken({ ticketId: String(ticket._id), runId: String(run._id) });
  const context: RunContext = {
    ticketId: String(ticket._id),
    runId: String(run._id),
    mode: runMode,
    model: deps.model,
    system: deps.prompt.text,
    requestId: event.requestId,
    api: createHttpApi({
      baseUrl: deps.baseUrl,
      token,
      requestId: event.requestId,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    }),
    modelClient: deps.modelClient(),
    recorder: {
      step: async (step) => {
        if (step.kind === 'tool') {
          agentToolCalls.inc({
            tool: step.toolName ?? 'unknown',
            is_error: String(step.isError === true),
          });
        }
        await runs.recordStep({ runId: run._id, attempt: run.attempts, ...step });
      },
    },
    limits: {
      maxSteps: numberFrom(deps.env.AGENT_MAX_STEPS, 8),
      maxTokens: numberFrom(deps.env.AGENT_RUN_TOKEN_BUDGET, 60_000),
      maxOutputTokens: 2048,
    },
    settings: () => getSettings(deps.env),
    spentTodayUsd: () => runs.costSince(startOfUtcDay(new Date())),
    now: () => Date.now(),
  };

  try {
    const outcome = await runAgent(context);
    observeRun(outcome, runMode, deps.model);
    // A reply waiting for a person is marked on the ticket first: if that fails, the run is retried as
    // a whole, and a proposal is never left on a run that no ticket points to.
    if (runMode !== 'shadow' && outcome.outcome === 'proposed') {
      await recordProposal(ticketId, run._id);
    }
    await runs.finishRun(run._id, run.attempts, toResult(outcome), new Date());
    await done();
    return 'ran';
  } catch (error) {
    const reason = describeFailure(error);
    logger.error({ err: error, ticketId, runId: String(run._id) }, 'Agent run failed');
    await runs.finishRun(
      run._id,
      run.attempts,
      { ...emptyResult(reason), outcome: 'error' },
      new Date()
    );

    // Put the event back with a growing delay, and give up after the last attempt: an admin can
    // retry it from the outbox. Either way the ticket is with people, as it always was.
    if (event.attempts >= MAX_ATTEMPTS) {
      await outboxRepository.markDead(event._id, reason);
    } else {
      await outboxRepository.markForRetry(
        event._id,
        new Date(deps.clock().getTime() + backoffMs(event.attempts)),
        reason
      );
    }
    return 'failed';
  }
}

// Works through the agent's events, oldest first, one at a time, until the limit or the time
// budget. Safe to call at any time and from several workers at once: events are claimed atomically
// and a ticket version is only ever run once.
export async function processAgentEvents(
  options: AgentWorkerOptions = {}
): Promise<AgentRunsResult> {
  const env = options.env ?? process.env;
  const pinned = options.now;
  const clock = (): Date => pinned ?? new Date();

  if (!agentEnabled(env)) return notConfigured('disabled');
  // A test may supply its own model; otherwise the real one needs a key.
  if (!options.modelClient && !hasAnthropicKey(env)) return notConfigured('no_api_key');
  const model = agentModel(env);
  if (!isPricedModel(model)) {
    logger.error({ model }, 'AGENT_MODEL is not a model the agent is priced for');
    return notConfigured('bad_model');
  }

  const deps: Deps = {
    clock,
    env,
    model,
    prompt: options.prompt ?? loadPrompt(DEFAULT_PROMPT),
    modelClient: options.modelClient ?? (() => new AnthropicModelClient()),
    baseUrl: options.baseUrl ?? agentApiBaseUrl(env),
    fetchImpl: options.fetchImpl,
  };

  const limit = options.limit ?? DEFAULT_LIMIT;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const started = Date.now();
  const result: AgentRunsResult = { configured: true, ran: 0, skipped: 0, failed: 0, more: false };

  for (let worked = 0; ; worked += 1) {
    if (worked >= limit || Date.now() - started >= budgetMs) {
      result.more = true;
      break;
    }
    const event = await outboxRepository.claimNext('agent', clock(), AGENT_LOCK_MS);
    if (!event) break;

    const handled = await handle(event, deps);
    result[handled === 'ran' ? 'ran' : handled === 'skipped' ? 'skipped' : 'failed'] += 1;
  }
  return result;
}
