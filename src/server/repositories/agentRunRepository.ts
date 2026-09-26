import type { Types } from 'mongoose';
import type { AgentConfidence, AgentOutcome, AgentRunMode } from '../../shared/agent-constants';
import AgentRun, {
  type AgentProposal,
  type AgentRunRecord,
  type IntendedAction,
} from '../models/AgentRun';
import AgentStep, { type AgentStepAttrs, type AgentStepRecord } from '../models/AgentStep';

// The only module that talks to Mongoose about agent runs and their steps.

export type { AgentProposal, AgentRunRecord, AgentStepRecord, IntendedAction };
export type { AgentConfidence };

// A run that has been "running" for longer than this belonged to a worker that died, and may be
// taken over. Longer than any run should take (the loop is capped at a handful of model calls).
export const STALE_RUN_MS = 5 * 60 * 1000;

export const idempotencyKey = (ticketId: string, ticketVersion: number): string =>
  `${ticketId}:v${ticketVersion}`;

export interface BeginRunInput {
  ticketId: Types.ObjectId | string;
  ticketVersion: number;
  mode: AgentRunMode;
  model: string;
  promptVersion: string;
  requestId?: string | undefined;
  ticketNumber?: string | undefined;
  requesterEmail?: string | undefined;
}

export type BeginRunResult =
  | { started: AgentRunRecord }
  // The ticket version was already handled ('done'), or another worker is on it ('in_progress').
  | { skipped: 'done' | 'in_progress' };

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

// Starts the one run for this version of this ticket. It is atomic and safe to call twice, from
// two workers, or again after a failure:
//   - no run yet: creates it, and the caller runs the agent;
//   - the earlier run failed, or its worker died (still "running" long ago): takes it over, and
//     counts another attempt;
//   - it finished, or another worker is on it now: does nothing, and the caller must not run.
export async function beginRun(
  input: BeginRunInput,
  now: Date = new Date()
): Promise<BeginRunResult> {
  const key = idempotencyKey(String(input.ticketId), input.ticketVersion);
  const fresh = {
    mode: input.mode,
    model: input.model,
    promptVersion: input.promptVersion,
    outcome: 'running' as const,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    intendedActions: [],
    startedAt: now,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.ticketNumber ? { ticketNumber: input.ticketNumber } : {}),
    ...(input.requesterEmail ? { requesterEmail: input.requesterEmail.toLowerCase() } : {}),
  };

  try {
    const created = await AgentRun.create({
      ticketId: input.ticketId,
      ticketVersion: input.ticketVersion,
      idempotencyKey: key,
      attempts: 1,
      ...fresh,
    });
    return { started: created.toObject() as AgentRunRecord };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }

  const staleBefore = new Date(now.getTime() - STALE_RUN_MS);
  const taken = await AgentRun.findOneAndUpdate(
    {
      idempotencyKey: key,
      $or: [{ outcome: 'error' }, { outcome: 'running', startedAt: { $lt: staleBefore } }],
    },
    {
      $set: fresh,
      $inc: { attempts: 1 },
      $unset: { outcomeReason: 1, finishedAt: 1, triage: 1, proposal: 1, escalationSummary: 1 },
    },
    { new: true }
  ).lean<AgentRunRecord>();
  if (taken) return { started: taken };

  const existing = await AgentRun.findOne({ idempotencyKey: key }, { outcome: 1 }).lean();
  return { skipped: existing?.outcome === 'running' ? 'in_progress' : 'done' };
}

export interface RunResult {
  outcome: Exclude<AgentOutcome, 'running'>;
  outcomeReason?: string | undefined;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  triage?: { category: string; priority: string; assigneeGroup: string } | undefined;
  proposal?: AgentProposal | undefined;
  escalationSummary?: string | undefined;
  intendedActions: IntendedAction[];
}

// Records how a run ended. It only applies while this attempt is the one running, so a worker that
// was taken over (it stalled, another started) cannot overwrite the newer attempt's result.
// Returns whether it was applied.
export async function finishRun(
  id: unknown,
  attempt: number,
  result: RunResult,
  now: Date = new Date()
): Promise<boolean> {
  const { outcomeReason, triage, proposal, escalationSummary, ...counts } = result;
  const update = await AgentRun.updateOne(
    { _id: id, outcome: 'running', attempts: attempt },
    {
      $set: {
        ...counts,
        finishedAt: now,
        ...(outcomeReason ? { outcomeReason: outcomeReason.slice(0, 300) } : {}),
        ...(triage ? { triage } : {}),
        ...(proposal ? { proposal } : {}),
        ...(escalationSummary ? { escalationSummary } : {}),
      },
    }
  );
  return update.modifiedCount === 1;
}

export async function recordStep(step: Omit<AgentStepAttrs, 'createdAt'>): Promise<void> {
  await AgentStep.create(step);
}

export const stepsForRun = (runId: unknown): Promise<AgentStepRecord[]> =>
  AgentStep.find({ runId }).sort({ attempt: 1, index: 1 }).lean<AgentStepRecord[]>();

export const findRun = (id: unknown): Promise<AgentRunRecord | null> =>
  AgentRun.findById(id).lean<AgentRunRecord>();

export const findRunByKey = (key: string): Promise<AgentRunRecord | null> =>
  AgentRun.findOne({ idempotencyKey: key }).lean<AgentRunRecord>();

// What runs that started at or after `since` have cost, in US dollars. The daily cost cap is
// checked against this.
export async function costSince(since: Date): Promise<number> {
  const [row] = await AgentRun.aggregate<{ total: number }>([
    { $match: { startedAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: '$costUsd' } } },
  ]);
  return row?.total ?? 0;
}

// How many runs the tickets of one requester have had since `since`. Counted whatever the outcome,
// so a person who raises a lot of tickets cannot run up the bill by raising them quickly.
export const countForRequesterSince = (requesterEmail: string, since: Date): Promise<number> =>
  AgentRun.countDocuments({
    requesterEmail: requesterEmail.toLowerCase(),
    startedAt: { $gte: since },
  });

export interface RunFilter {
  outcome?: AgentOutcome | undefined;
  ticketId?: string | undefined;
}

// Runs, newest first, for the admin view.
export async function listRuns(
  filter: RunFilter,
  { skip, limit }: { skip: number; limit: number }
): Promise<{ runs: AgentRunRecord[]; total: number }> {
  const query = {
    ...(filter.outcome ? { outcome: filter.outcome } : {}),
    ...(filter.ticketId ? { ticketId: filter.ticketId } : {}),
  };
  const [runs, total] = await Promise.all([
    AgentRun.find(query)
      .sort({ startedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<AgentRunRecord[]>(),
    AgentRun.countDocuments(query),
  ]);
  return { runs, total };
}

// Runs started since `since`, by mode, outcome and model. The metrics show the last day of them.
export const countRunsSince = (
  since: Date
): Promise<{ _id: { mode: string; outcome: string; model: string }; count: number }[]> =>
  AgentRun.aggregate([
    { $match: { startedAt: { $gte: since } } },
    {
      $group: {
        _id: { mode: '$mode', outcome: '$outcome', model: '$model' },
        count: { $sum: 1 },
      },
    },
  ]);

// What runs started since `since` have cost, by model, in US dollars.
export const costByModelSince = (since: Date): Promise<{ _id: string; total: number }[]> =>
  AgentRun.aggregate([
    { $match: { startedAt: { $gte: since } } },
    { $group: { _id: '$model', total: { $sum: '$costUsd' } } },
  ]);
