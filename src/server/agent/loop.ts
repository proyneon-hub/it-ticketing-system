import type Anthropic from '@anthropic-ai/sdk';
import { agentCategories, type AgentCategory } from '../../shared/ticket-constants';
import { addUsage, costUsd, emptyUsage, type TokenUsage } from '../domain/agentPricing';
import { renderTicketForAgent } from './render';
import { executeTool } from './registry';
import { toolDefinitions, type ToolContext } from './tools';
import type { RunContext, RunOutcome, RunState, StepRecord } from './types';

// The agent loop: ask the model, run the tools it calls, feed the results back, and stop when the
// ticket has been dealt with or a limit is reached. Every way it can stop is listed here:
//
//   decided        the model called propose_resolution, post_resolution or escalate: the run ends
//                  at once, without another model call
//   ticket_changed a person edited the ticket while the agent worked on it: aborted at once
//   kill_switch    the settings say stop: aborted before the next step
//   daily_cost_cap today's spend has reached the cap: aborted before the next step
//   budget_exceeded  the run used its token budget: escalated to a person
//   step_limit_reached  too many model calls: escalated
//   model_refusal / max_tokens  the model declined, or was cut off (its tool input may be
//                  truncated, so it is never run): escalated
//   no_decision    the model stopped without deciding: triaged if it set a triage, else escalated
//
// Anything that goes wrong for a person's ticket ends with the ticket in front of a person, which is
// also where every ticket is without the agent.

const RESULT_LIMIT = 20_000;

const totalTokens = (usage: TokenUsage): number =>
  usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

const clip = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

// The tool's result as the model receives it: JSON, capped, so nothing can fill the context.
function resultText(content: unknown): string {
  const json = JSON.stringify(content);
  return json.length > RESULT_LIMIT ? `${json.slice(0, RESULT_LIMIT)} [cut]` : json;
}

const summarizeInput = (input: unknown): string => clip(JSON.stringify(input) ?? '', 500);

const validCategory = (category: string): AgentCategory =>
  (agentCategories as readonly string[]).includes(category)
    ? (category as AgentCategory)
    : 'General Support';

export async function runAgent(ctx: RunContext): Promise<RunOutcome> {
  const startedAt = ctx.now();
  const [ticket, comments, initial] = await Promise.all([
    ctx.api.getTicket(ctx.ticketId),
    ctx.api.getComments(ctx.ticketId),
    ctx.settings(),
  ]);

  const state: RunState = {
    ticket: {
      number: ticket.ticketNumber ?? '',
      title: ticket.title,
      category: ticket.category,
      requesterEmail: ticket.requesterEmail,
    },
    retrievedKb: new Set(),
    readKb: new Set(),
    intended: [],
    autoAllowlist: initial.autoAllowlist,
  };
  const toolContext: ToolContext = {
    ticketId: ctx.ticketId,
    mode: ctx.mode,
    api: ctx.api,
    state,
  };

  const tools = toolDefinitions();
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: renderTicketForAgent(ticket, comments, {
        ticketId: ctx.ticketId,
        mode: ctx.mode,
        autoAllowlist: initial.autoAllowlist,
      }),
    },
  ];

  let usage = emptyUsage();
  let modelCalls = 0;
  let stepIndex = 0;

  const record = (step: Omit<StepRecord, 'index'>) =>
    ctx.recorder.step({ ...step, index: stepIndex++ });

  const finish = (outcome: RunOutcome['outcome'], reason?: string): RunOutcome => ({
    outcome,
    ...(reason ? { reason } : {}),
    steps: modelCalls,
    usage,
    costUsd: costUsd(ctx.model, usage),
    latencyMs: ctx.now() - startedAt,
    ...(state.triage ? { triage: state.triage } : {}),
    ...(state.decision?.proposal ? { proposal: state.decision.proposal } : {}),
    ...(state.decision?.escalationSummary
      ? { escalationSummary: state.decision.escalationSummary }
      : {}),
    intended: state.intended,
  });

  // Stops the run without changing anything: nothing more is asked of the model.
  const abort = (reason: string): RunOutcome => finish('aborted', reason);

  // Hands the ticket to a person because the agent could not finish. It goes through the same
  // escalate tool as a deliberate escalation, so the mode's rules apply to it in the same way.
  async function escalateBecause(reason: string): Promise<RunOutcome> {
    state.triage ??= {
      category: validCategory(ticket.category),
      priority: ticket.priority,
      assigneeGroup: 'Help Desk',
    };
    const started = ctx.now();
    const input = {
      ticket_id: ctx.ticketId,
      assignee_group: 'Help Desk',
      reason: 'other',
      summary: {
        reported: 'See the ticket.',
        checked: `The agent stopped before it could decide (${reason}).`,
        ruled_out: 'Nothing.',
        why_escalating: 'The agent could not finish, so a person needs to take this.',
      },
    };
    const outcome = await executeTool('escalate', input, toolContext);
    await record({
      kind: 'tool',
      toolName: 'escalate',
      input: summarizeInput(input),
      outputSummary: outcome.summary,
      isError: outcome.isError,
      dryRun: outcome.dryRun,
      latencyMs: ctx.now() - started,
    });
    return finish('escalated', reason);
  }

  // The model has stopped asking for tools.
  async function concludeWithoutTools(): Promise<RunOutcome> {
    if (state.decision) return finish(state.decision.kind);
    if (state.triage) return finish('triaged', 'no_decision');
    return escalateBecause('no_decision');
  }

  for (let turn = 0; turn < ctx.limits.maxSteps; turn += 1) {
    const settings = await ctx.settings();
    state.autoAllowlist = settings.autoAllowlist;

    if (settings.killSwitch) return abort('kill_switch');

    const runCost = costUsd(ctx.model, usage);
    if ((await ctx.spentTodayUsd()) + runCost >= settings.dailyCostCapUsd) {
      return abort('daily_cost_cap');
    }
    if (totalTokens(usage) >= ctx.limits.maxTokens) return escalateBecause('budget_exceeded');

    const modelStarted = ctx.now();
    const response = await ctx.modelClient.create({
      model: ctx.model,
      system: ctx.system,
      tools,
      messages,
      maxTokens: ctx.limits.maxOutputTokens,
    });
    modelCalls += 1;
    usage = addUsage(usage, response.usage);
    await record({
      kind: 'model',
      stopReason: response.stopReason ?? undefined,
      inputTokens: response.usage.input + response.usage.cacheRead + response.usage.cacheWrite,
      outputTokens: response.usage.output,
      latencyMs: ctx.now() - modelStarted,
    });

    // The whole content goes back, not only its text, so the conversation stays exactly as the
    // model produced it.
    messages.push({ role: 'assistant', content: response.content });

    // Declined, or cut off part way through: a tool call in either may be incomplete, so none is run.
    if (response.stopReason === 'refusal') return escalateBecause('model_refusal');
    if (response.stopReason === 'max_tokens') return escalateBecause('max_tokens');

    const toolCalls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );
    // The switch may have been flipped while the model was thinking, which can take seconds. Check
    // again before anything it asked for is run, so nothing is done after someone has stopped the agent.
    const latest = await ctx.settings();
    if (latest.killSwitch) return abort('kill_switch');
    state.autoAllowlist = latest.autoAllowlist;

    if (toolCalls.length === 0) return concludeWithoutTools();

    // All results of one turn go back in a single message.
    const results: Anthropic.ToolResultBlockParam[] = [];
    let stopBecause: string | undefined;
    for (const call of toolCalls) {
      const toolStarted = ctx.now();
      const outcome = await executeTool(call.name, call.input, toolContext);
      await record({
        kind: 'tool',
        toolName: call.name,
        input: summarizeInput(call.input),
        outputSummary: outcome.summary,
        isError: outcome.isError,
        dryRun: outcome.dryRun,
        latencyMs: ctx.now() - toolStarted,
      });
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: resultText(outcome.content),
        is_error: outcome.isError,
      });
      if (outcome.abort) {
        stopBecause = outcome.abort;
        break;
      }
    }
    messages.push({ role: 'user', content: results });

    // A person is on the ticket: step back, without another word to the model.
    if (stopBecause) return abort(stopBecause);

    // Decided: nothing more to ask the model, so no more is spent.
    if (state.decision) return finish(state.decision.kind);
  }

  return escalateBecause('step_limit_reached');
}
