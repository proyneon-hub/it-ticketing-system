import type { DecisionKind } from './types';
import { disposition } from '../domain/agentPolicy';
import { ApiError } from './httpApi';
import { ToolRefusal, ToolUnavailable, findTool, type ToolContext } from './tools';

// Every tool call the model makes goes through here, in this order, and stops at the first thing
// that is wrong:
//
//   1. the tool exists;
//   2. its input matches the schema the model was shown;
//   3. it is about this run's ticket and no other;
//   4. the mode allows a tool of its tier (a write in shadow mode is only recorded);
//   5. the checks the model cannot bypass (citations, Security tickets, confidence, ...);
//   6. it runs, or in shadow mode it is recorded as what would have run.
//
// A failure is not an exception: it is a result the model is told about, so it can correct itself.
// What it is told never repeats anything a person typed. The loop records every call.

export interface ToolOutcome {
  // What goes back to the model, as the tool's result.
  content: unknown;
  isError: boolean;
  // Recorded, not carried out (shadow mode).
  dryRun: boolean;
  // Set when this call decided the ticket: the run ends.
  terminal?: DecisionKind;
  // A short line for the audit trail.
  summary: string;
}

const failure = (code: string, message: string): ToolOutcome => ({
  content: { error: { code, message } },
  isError: true,
  dryRun: false,
  summary: `${code}: ${message}`.slice(0, 200),
});

const SHADOW_NOTE =
  'Shadow mode: this was recorded and not carried out. Carry on as if it had been.';

// What a successful read amounts to, for the audit trail.
function describe(name: string, content: unknown): string {
  const c = content as Record<string, unknown>;
  switch (name) {
    case 'search_kb':
      return `articles: ${((c.articles as { id: string }[]) ?? []).map((a) => a.id).join(', ') || 'none'}`;
    case 'get_kb_article':
      return `read ${String(c.id)}`;
    case 'search_tickets':
      return `${((c.tickets as unknown[]) ?? []).length} similar tickets`;
    case 'get_requester_context':
      return `${((c.open as unknown[]) ?? []).length} open, ${((c.recently_finished as unknown[]) ?? []).length} finished`;
    default:
      return 'ok';
  }
}

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolOutcome> {
  // 1. The tool exists.
  const tool = findTool(name);
  if (!tool) return failure('unknown_tool', `There is no tool called "${name.slice(0, 40)}".`);

  // 2. The input is what the model was told to send.
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    return failure('invalid_input', problems.slice(0, 300));
  }
  const input = parsed.data as Record<string, unknown>;

  // 3. This run's ticket, and no other. The API refuses the run's token any other ticket too, so
  //    this is the second lock on the same door.
  if (
    typeof input.ticket_id === 'string' &&
    input.ticket_id.toLowerCase() !== ctx.ticketId.toLowerCase()
  ) {
    return failure('wrong_ticket', 'You can only act on the ticket you were given.');
  }

  // 4. What the mode allows.
  const allowed = disposition(ctx.mode, tool.tier);
  if (allowed === 'refuse') {
    return failure(
      'not_allowed',
      `${tool.name} is not allowed in ${ctx.mode} mode. Use propose_resolution, or escalate.`
    );
  }

  // 5. The checks the model cannot bypass.
  const refusal = tool.check?.(input, ctx);
  if (refusal) return failure('refused', refusal);

  const remember = () => {
    tool.remember?.(input, ctx);
    if (tool.decide) ctx.state.decision = tool.decide(input, ctx);
  };

  // 6a. Shadow mode: record what would have been done.
  if (allowed === 'dry-run') {
    const summary = tool.summarize(input);
    ctx.state.intended.push({ tool: tool.name, summary });
    remember();
    return {
      content: { recorded: true, note: SHADOW_NOTE },
      isError: false,
      dryRun: true,
      ...(tool.terminal ? { terminal: tool.terminal } : {}),
      summary: `would: ${summary}`.slice(0, 200),
    };
  }

  // 6b. Run it.
  try {
    const content = await tool.execute(input, ctx);
    remember();
    return {
      content,
      isError: false,
      dryRun: false,
      ...(tool.terminal ? { terminal: tool.terminal } : {}),
      summary: tool.tier === 'read' ? describe(tool.name, content) : tool.summarize(input),
    };
  } catch (error) {
    if (error instanceof ToolRefusal) return failure('refused', error.message);
    if (error instanceof ToolUnavailable) return failure('unavailable', error.message);
    if (error instanceof ApiError) {
      if (error.status === 404) return failure('not_found', 'That does not exist.');
      if (error.status === 403)
        return failure('not_permitted', 'You are not permitted to do that.');
      if (error.status === 400)
        return failure('invalid_input', 'The system rejected that request.');
      if (error.status === 429)
        return failure('rate_limited', 'Too many lookups. Carry on without it.');
      return failure(
        'service_error',
        'The ticketing system could not answer. Carry on without it.'
      );
    }
    // Anything else is a bug or an outage. The model is told only that it failed; the worker's
    // log has the rest.
    return failure('tool_failed', 'That tool failed. Carry on without it.');
  }
}
