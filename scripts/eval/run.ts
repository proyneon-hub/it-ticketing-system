import type { ModelClient } from '../../src/server/agent/types';
import type { Prompt } from '../../src/server/agent/prompt';
import AgentRun from '../../src/server/models/AgentRun';
import AgentStep from '../../src/server/models/AgentStep';
import Comment from '../../src/server/models/Comment';
import OutboxEvent from '../../src/server/models/OutboxEvent';
import Ticket from '../../src/server/models/Ticket';
import { processAgentEvents } from '../../src/server/services/agentWorkerService';
import { scoreCase } from './score';
import type { CaseResult, CaseRun, GoldenTicket, Judgement } from './types';

// Runs golden tickets through the real system: each is created through the API as a person would
// raise it, the outbox hands the event to the worker, the worker runs the agent, and what the agent
// did is read back from the records it leaves. Only the model can be swapped (a live one, a replay of a
// recording, or the offline oracle); everything else is the code that runs in production.

export interface RunOptions {
  tickets: GoldenTicket[];
  baseUrl: string;
  // A technician's token, used to create tickets on behalf of a requester. A function is asked for a
  // token before each call, so a long run can keep signing in again: access tokens last 15 minutes and
  // a full run takes longer than that.
  staffToken: string | (() => string | Promise<string>);
  model: string;
  prompt?: Prompt;
  // The model for one run. Called once the ticket exists, so a replay can be given its id.
  modelFor(context: { golden: GoldenTicket; ticketId: string }): ModelClient;
  // Called after each case, for a recorder to save what it saw.
  afterCase?(context: { golden: GoldenTicket; ticketId: string; run: CaseRun }): Promise<void>;
  // Grades a proposed reply. Only used when asked for, since it costs a model call.
  judge?(run: CaseRun, golden: GoldenTicket): Promise<Judgement>;
  // Stop, and say so, once the runs have cost this much. A guard against a mistake that spends money.
  maxCostUsd?: number;
  onProgress?(line: string): void;
}

export interface RunOutput {
  results: CaseResult[];
  truncated?: string;
}

async function api<T>(
  baseUrl: string,
  token: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${method} ${path} answered ${response.status}: ${(await response.text()).slice(0, 200)}`
    );
  }
  return (await response.json()) as T;
}

const tokenOf = async (options: RunOptions): Promise<string> =>
  typeof options.staffToken === 'function' ? options.staffToken() : options.staffToken;

// The statuses an earlier ticket is walked through, following the workflow's own rules.
const PATH_TO: Record<string, { status: string; assignee?: string }[]> = {
  open: [],
  assigned: [{ status: 'assigned', assignee: 'Help Desk' }],
  'in-progress': [{ status: 'in-progress' }],
  'pending-user': [{ status: 'in-progress' }, { status: 'pending-user' }],
  resolved: [{ status: 'in-progress' }, { status: 'resolved' }],
  closed: [{ status: 'in-progress' }, { status: 'resolved' }, { status: 'closed' }],
};

const requesterFor = (golden: GoldenTicket) => ({
  // One requester per case, so what the agent learns about "the requester's other tickets" is only
  // this case's history, and never another case's ticket.
  requesterName: 'Alex Example',
  requesterEmail: `eval-${golden.id.toLowerCase()}@example.com`,
});

async function createCase(golden: GoldenTicket, options: RunOptions): Promise<string> {
  const requester = requesterFor(golden);

  // The requester's earlier tickets exist already and are not the agent's to work on, so the agent is
  // switched off while they are created (no event is recorded for them).
  process.env.AGENT_ENABLED = 'false';
  for (const earlier of golden.history ?? []) {
    const created = await api<{ ticket: { _id: string } }>(
      options.baseUrl,
      await tokenOf(options),
      'POST',
      '/tickets',
      {
        title: earlier.title,
        description: 'An earlier ticket.',
        category: earlier.category,
        ...requester,
      }
    );
    for (const step of PATH_TO[earlier.status] ?? []) {
      await api(
        options.baseUrl,
        await tokenOf(options),
        'PATCH',
        `/tickets/${created.ticket._id}`,
        step
      );
    }
  }

  // The ticket under test, as its requester raised it. No category: the agent's triage decides.
  process.env.AGENT_ENABLED = 'true';
  const created = await api<{ ticket: { _id: string } }>(
    options.baseUrl,
    await tokenOf(options),
    'POST',
    '/tickets',
    { title: golden.title, description: golden.description, ...requester }
  );
  return created.ticket._id;
}

async function collect(ticketId: string, golden: GoldenTicket): Promise<CaseRun> {
  const empty = {
    id: golden.id,
    outcome: 'none' as const,
    toolCalls: [],
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    model: '',
  };

  const run = await AgentRun.findOne({ ticketId }).lean();
  if (!run) return { ...empty, error: 'The worker recorded no run for this ticket.' };

  const steps = await AgentStep.find({ runId: run._id }).sort({ attempt: 1, index: 1 }).lean();
  const escalate = run.intendedActions.find((action) => action.tool === 'escalate');

  const base = {
    id: golden.id,
    reason: run.outcomeReason,
    toolCalls: steps
      .filter((step) => step.kind === 'tool')
      .map((step) => ({
        tool: step.toolName ?? '',
        isError: step.isError === true,
        dryRun: step.dryRun === true,
        summary: step.outputSummary ?? '',
      })),
    steps: run.steps,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cacheReadTokens: run.cacheReadTokens,
    cacheWriteTokens: run.cacheWriteTokens,
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    model: run.model,
    ...(run.triage
      ? {
          triage: {
            category: run.triage.category,
            priority: run.triage.priority,
            assigneeGroup: run.triage.assigneeGroup,
          },
        }
      : {}),
    ...(run.proposal
      ? {
          proposal: {
            citedKbIds: run.proposal.citedKbIds,
            confidence: run.proposal.confidence,
            replyMarkdown: run.proposal.replyMarkdown,
          },
        }
      : {}),
    ...(run.outcome === 'escalated'
      ? {
          escalation: {
            group: escalate?.summary.split(' -> ')[1],
            reason: /^Why: (\S+)/.exec(run.escalationSummary ?? '')?.[1],
          },
        }
      : {}),
  };

  // A run that ended in an error has no decision to score.
  if (run.outcome === 'error') {
    return { ...base, outcome: 'error', error: run.outcomeReason ?? 'The run failed.' };
  }
  return { ...base, outcome: run.outcome };
}

// Between cases, everything a case created goes, so no case can see another's tickets or comments and
// the run cost of one cannot count against the next. The knowledge base and the users stay.
async function reset(): Promise<void> {
  await Promise.all([
    Ticket.deleteMany({}),
    Comment.deleteMany({}),
    OutboxEvent.deleteMany({}),
    AgentRun.deleteMany({}),
    AgentStep.deleteMany({}),
  ]);
}

export async function runEvaluation(options: RunOptions): Promise<RunOutput> {
  // Each case switches the agent on and off in this process's environment, so put it back afterwards.
  const previous = process.env.AGENT_ENABLED;
  try {
    return await runCases(options);
  } finally {
    if (previous === undefined) delete process.env.AGENT_ENABLED;
    else process.env.AGENT_ENABLED = previous;
  }
}

async function runCases(options: RunOptions): Promise<RunOutput> {
  const results: CaseResult[] = [];
  let spent = 0;
  let truncated: string | undefined;

  for (const golden of options.tickets) {
    if (options.maxCostUsd !== undefined && spent >= options.maxCostUsd) {
      truncated = `Stopped after ${results.length} of ${options.tickets.length} tickets: the runs had cost $${spent.toFixed(4)}, the limit was $${options.maxCostUsd.toFixed(2)}.`;
      break;
    }

    await reset();
    const ticketId = await createCase(golden, options);

    // Failures are recorded and scored, not retried: what the agent does on its first try is the result.
    await processAgentEvents({
      limit: 1,
      baseUrl: options.baseUrl,
      ...(options.prompt ? { prompt: options.prompt } : {}),
      modelClient: () => options.modelFor({ golden, ticketId }),
      env: {
        ...process.env,
        AGENT_ENABLED: 'true',
        AGENT_MODEL: options.model,
        // The evaluation is bounded by its own limit, not by the day's cap for real tickets.
        AGENT_DAILY_COST_CAP_USD: '1000000',
      },
    });

    const run = await collect(ticketId, golden);
    await options.afterCase?.({ golden, ticketId, run });
    const judgement = options.judge && run.proposal ? await options.judge(run, golden) : undefined;
    const score = scoreCase(golden, run, judgement);

    spent += run.costUsd;
    results.push({ golden, run, score });
    options.onProgress?.(
      `${golden.id} ${score.actionOk && score.categoryOk ? 'ok ' : 'MISS'} ${score.action.padEnd(8)} ${run.triage?.category ?? '-'}/${run.triage?.priority ?? '-'}  $${run.costUsd.toFixed(4)}  ${(run.latencyMs / 1000).toFixed(1)}s${run.error ? `  error: ${run.error.slice(0, 60)}` : ''}`
    );
  }

  await reset();
  return { results, ...(truncated ? { truncated } : {}) };
}
