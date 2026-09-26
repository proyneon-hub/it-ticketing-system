import type { ListAgentRunsQuery, UpdateAgentSettingsInput } from '../../shared/schemas';
import { hasAnthropicKey } from '../agent/anthropicClient';
import type { TokenPayload } from '../auth';
import { agentEnabled } from '../config';
import { breakerConfig, breakerState } from '../domain/agentBreaker';
import { autoModeAvailable } from '../domain/agentPolicy';
import { assertStaff } from '../domain/permissions';
import { NotFoundError, ValidationError } from '../errors';
import * as runs from '../repositories/agentRunRepository';
import { agentModel, startOfUtcDay } from './agentWorkerService';
import { getSettings, updateSettings, type AgentSettingsValues } from './agentSettingsService';

// The agent's settings and its record of runs, for the team (docs/adr/011). Reading is for staff;
// changing the settings and reading the runs' steps is for admins, and the routes say so.

export interface AgentSettingsView extends AgentSettingsValues {
  // Whether the agent is switched on in this deployment at all (AGENT_ENABLED and a key), and the
  // model it uses. Neither can be changed here: they are the deployment's.
  enabled: boolean;
  model: string;
  // What it has spent since 00:00 UTC, against `dailyCostCapUsd`.
  spentTodayUsd: number;
  // Whether this deployment lets it answer without a person; where it does not, auto runs as assist.
  autoAvailable: boolean;
  // Whether it has paused itself because runs keep failing.
  circuit: { open: boolean; consecutiveFailures: number; reopensAt?: string };
}

export async function getSettingsView(user: TokenPayload): Promise<AgentSettingsView> {
  assertStaff(user);
  const config = breakerConfig();
  const now = new Date();
  const [settings, spentTodayUsd, attempts] = await Promise.all([
    getSettings(),
    runs.costSince(startOfUtcDay(now)),
    runs.recentAttempts(config.failures),
  ]);
  const circuit = breakerState(attempts, now, config);
  return {
    ...settings,
    enabled: agentEnabled() && hasAnthropicKey(process.env),
    model: agentModel(),
    spentTodayUsd,
    autoAvailable: autoModeAvailable(),
    circuit: {
      open: circuit.open,
      consecutiveFailures: circuit.consecutiveFailures,
      ...(circuit.reopensAt ? { reopensAt: circuit.reopensAt.toISOString() } : {}),
    },
  };
}

export async function changeSettings(
  user: TokenPayload,
  changes: UpdateAgentSettingsInput
): Promise<AgentSettingsView> {
  await updateSettings(changes, user.email);
  return getSettingsView(user);
}

// A run as the admin list shows it: what happened, and what it cost, and nothing the ticket said.
const toRunSummary = (run: runs.AgentRunRecord) => ({
  _id: String(run._id),
  ticketId: String(run.ticketId),
  ticketNumber: run.ticketNumber,
  mode: run.mode,
  model: run.model,
  promptVersion: run.promptVersion,
  outcome: run.outcome,
  outcomeReason: run.outcomeReason,
  attempts: run.attempts,
  steps: run.steps,
  inputTokens: run.inputTokens,
  outputTokens: run.outputTokens,
  cacheReadTokens: run.cacheReadTokens,
  costUsd: run.costUsd,
  latencyMs: run.latencyMs,
  triage: run.triage,
  hasProposal: Boolean(run.proposal),
  startedAt: run.startedAt.toISOString(),
  finishedAt: run.finishedAt?.toISOString(),
});

export async function listRuns(user: TokenPayload, query: ListAgentRunsQuery) {
  assertStaff(user);
  const { runs: rows, total } = await runs.listRuns(
    { outcome: query.outcome },
    { skip: (query.page - 1) * query.limit, limit: query.limit }
  );
  return {
    runs: rows.map(toRunSummary),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getRun(user: TokenPayload, id: string) {
  assertStaff(user);
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw new ValidationError('Invalid run id.');
  const run = await runs.findRun(id);
  if (!run) throw new NotFoundError('Run not found.');
  const steps = await runs.stepsForRun(run._id);
  return {
    run: {
      ...toRunSummary(run),
      proposal: run.proposal,
      escalationSummary: run.escalationSummary,
      intendedActions: run.intendedActions,
    },
    steps: steps.map((step) => ({
      attempt: step.attempt,
      index: step.index,
      kind: step.kind,
      toolName: step.toolName,
      input: step.input,
      outputSummary: step.outputSummary,
      isError: step.isError,
      dryRun: step.dryRun,
      stopReason: step.stopReason,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      latencyMs: step.latencyMs,
    })),
  };
}
