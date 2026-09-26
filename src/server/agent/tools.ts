import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  agentConfidences,
  agentEscalationReasons,
  type AgentRunMode,
  type AgentToolTier,
} from '../../shared/agent-constants';
import {
  agentCategories,
  assigneeGroups,
  kbIdPattern,
  priorities,
  terminalStatuses,
} from '../../shared/ticket-constants';
import type { Ticket } from '../../shared/ticket-types';
import { mayPostAlone } from '../domain/agentPolicy';
import type { AgentApi, Decision, DecisionKind, RunState } from './types';

// The agent's tools. Each is defined once, with a zod schema: the same schema becomes the JSON
// schema the model sees and the validator every call passes through (registry.ts), so what the
// model is told and what is enforced cannot drift apart.
//
// Tools are grouped into permission tiers, and the run's mode decides which tiers act, which are
// only recorded (shadow) and which are refused (domain/agentPolicy.ts). Beyond the mode there are
// checks written here that the model cannot talk its way past: it may cite only articles it read in
// full in this run, it may not resolve a Security ticket, and it may not post unless the category
// is allowlisted and its confidence is high.

export interface ToolContext {
  ticketId: string;
  mode: AgentRunMode;
  api: AgentApi;
  state: RunState;
}

// A refusal the model can act on. The message never repeats anything a person typed.
export class ToolRefusal extends Error {}

// A tool that would change something, in a mode where changes are not yet possible.
export class ToolUnavailable extends Error {}

export interface ToolDefinition {
  name: string;
  tier: AgentToolTier;
  description: string;
  schema: z.ZodType;
  // A tool that ends the run: the ticket has been dealt with once one of these has succeeded.
  terminal?: DecisionKind;
  // A short description of what the call does, for the record of what a shadow run would have done.
  summarize(input: unknown): string;
  // Checks the model cannot bypass, made after validation and before the tool runs (or is
  // recorded). Returns a refusal message, or null.
  check?(input: unknown, ctx: ToolContext): string | null;
  execute(input: unknown, ctx: ToolContext): Promise<unknown>;
  // The decision a terminal tool records.
  decide?(input: unknown, ctx: ToolContext): Decision;
  // Updates what the run remembers once the call has been accepted (whether it ran or was only
  // recorded). The registry's later checks are made against this.
  remember?(input: unknown, ctx: ToolContext): void;
}

function defineTool<S extends z.ZodType>(definition: {
  name: string;
  tier: AgentToolTier;
  description: string;
  schema: S;
  terminal?: DecisionKind;
  summarize(input: z.output<S>): string;
  check?(input: z.output<S>, ctx: ToolContext): string | null;
  execute(input: z.output<S>, ctx: ToolContext): Promise<unknown>;
  decide?(input: z.output<S>, ctx: ToolContext): Decision;
  remember?(input: z.output<S>, ctx: ToolContext): void;
}): ToolDefinition {
  // The registry validates with `schema` before anything else runs, so by the time these functions
  // are called the input has the shape `S` describes.
  return definition as unknown as ToolDefinition;
}

// --- Shared pieces --------------------------------------------------------------------------

const ticketIdField = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'ticket_id must be the ticket id you were given.')
  .describe('The id of the ticket you were given. Only that ticket may be used.');

const kbId = z
  .string()
  .regex(kbIdPattern, 'A knowledge-base id looks like KB-006.')
  .describe('A knowledge-base article id, such as KB-006.');

const resolutionFields = {
  ticket_id: ticketIdField,
  reply_markdown: z
    .string()
    .min(20, 'The reply is too short to help.')
    .max(2000)
    .describe(
      'The reply to the requester: short, plain and kind, with the numbered steps taken from the cited article, and what to do if they do not work.'
    ),
  cited_kb_ids: z
    .array(kbId)
    .min(1, 'Cite at least one article.')
    .max(5)
    .describe(
      'Every article the reply relies on. Each must have been read in full with get_kb_article in this run.'
    ),
  confidence: z
    .enum(agentConfidences)
    .describe(
      'high: an article covers the problem exactly. medium: it covers most of it. low: otherwise, and then escalate instead.'
    ),
  reasoning_summary: z
    .string()
    .max(600)
    .describe(
      'Why this article answers the problem, in a sentence or two. Do not copy the ticket.'
    ),
};

const summarizeResolution = (input: { cited_kb_ids: string[]; confidence: string }): string =>
  `cites ${input.cited_kb_ids.join(', ')}; confidence ${input.confidence}`;

// The refusals shared by propose_resolution and post_resolution.
function checkResolution(
  input: { cited_kb_ids: string[]; confidence: string },
  ctx: ToolContext
): string | null {
  const { triage, decision, readKb } = ctx.state;
  if (!triage) return 'Call set_triage first.';
  if (decision) return 'You have already made a decision for this ticket. Stop.';
  if (triage.category === 'Security') {
    return 'Security tickets are never resolved by the agent. Escalate to the Security Team.';
  }
  if (input.confidence === 'low') {
    return 'Do not propose a fix with low confidence. Escalate to a person instead.';
  }
  const unread = [...new Set(input.cited_kb_ids)].filter((id) => !readKb.has(id));
  if (unread.length > 0) {
    return `You cited ${unread.join(', ')} but did not read ${unread.length > 1 ? 'them' : 'it'} in full in this run. Read each cited article with get_kb_article first, or escalate.`;
  }
  return null;
}

const decisionFor = (
  kind: 'proposed' | 'posted',
  input: {
    reply_markdown: string;
    cited_kb_ids: string[];
    confidence: (typeof agentConfidences)[number];
    reasoning_summary: string;
  }
): Decision => ({
  kind,
  proposal: {
    replyMarkdown: input.reply_markdown,
    citedKbIds: [...new Set(input.cited_kb_ids)],
    confidence: input.confidence,
    reasoningSummary: input.reasoning_summary,
  },
});

// What a ticket looks like in a list of similar tickets: enough to recognise it, without the
// description, which is often long and is someone else's text.
const brief = (ticket: Ticket) => ({
  number: ticket.ticketNumber,
  title: ticket.title,
  status: ticket.status,
  priority: ticket.priority,
  category: ticket.category,
  finished: (terminalStatuses as readonly string[]).includes(ticket.status),
});

// --- Reading --------------------------------------------------------------------------------

const getTicket = defineTool({
  name: 'get_ticket',
  tier: 'read',
  description:
    'Read the ticket you were given again, with its comments. Call this only if you need to re-read something; the ticket is already in your first message.',
  schema: z.object({ ticket_id: ticketIdField }),
  summarize: () => 'read the ticket',
  async execute(_input, ctx) {
    const [ticket, comments] = await Promise.all([
      ctx.api.getTicket(ctx.ticketId),
      ctx.api.getComments(ctx.ticketId),
    ]);
    return {
      ticket_number: ticket.ticketNumber,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      comments: comments.slice(-12).map((comment) => ({
        author_role: comment.author.role,
        visibility: comment.visibility,
        body: comment.body.slice(0, 1000),
      })),
    };
  },
});

const searchTickets = defineTool({
  name: 'search_tickets',
  tier: 'read',
  description:
    'Find similar past tickets, to see how they were solved. Use words a person would use to describe the problem. Finished tickets are the most useful.',
  schema: z.object({
    query: z.string().min(1).max(100).describe('Words describing the problem.'),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  summarize: (input) => `searched tickets for "${input.query.slice(0, 60)}"`,
  async execute(input, ctx) {
    const found = await ctx.api.listTickets({ search: input.query, limit: input.limit + 1 });
    return {
      tickets: found
        .filter((ticket) => ticket.ticketNumber !== ctx.state.ticket.number)
        .slice(0, input.limit)
        .map(brief),
    };
  },
});

const getRequesterContext = defineTool({
  name: 'get_requester_context',
  tier: 'read',
  description:
    "See the requester's other recent tickets. The same problem raised more than once is a reason to escalate rather than repeat the same advice. Takes no input: it is always about the requester of your ticket.",
  schema: z.object({}),
  summarize: () => "read the requester's recent tickets",
  async execute(_input, ctx) {
    // The address comes from the server's own copy of the ticket, never from the model, so it
    // cannot be pointed at anyone else.
    const found = await ctx.api.listTickets({
      requesterEmail: ctx.state.ticket.requesterEmail,
      limit: 11,
    });
    const others = found.filter((ticket) => ticket.ticketNumber !== ctx.state.ticket.number);
    return {
      open: others.filter((ticket) => !brief(ticket).finished).map(brief),
      recently_finished: others
        .filter((ticket) => brief(ticket).finished)
        .slice(0, 5)
        .map(brief),
    };
  },
});

const searchKb = defineTool({
  name: 'search_kb',
  tier: 'read',
  description:
    'Search the knowledge base for articles that cover the problem. Use the words a person would use. Returns article ids, titles and short snippets; read an article in full with get_kb_article before relying on it.',
  schema: z.object({
    query: z.string().min(1).max(100).describe('Words describing the problem.'),
    category: z.enum(agentCategories).optional(),
  }),
  summarize: (input) => `searched the knowledge base for "${input.query.slice(0, 60)}"`,
  async execute(input, ctx) {
    const articles = await ctx.api.searchKb({
      search: input.query,
      category: input.category,
      limit: 5,
    });
    for (const article of articles) ctx.state.retrievedKb.add(article.id);
    return { articles };
  },
});

const getKbArticle = defineTool({
  name: 'get_kb_article',
  tier: 'read',
  description:
    'Read one knowledge-base article in full. You must do this for every article you intend to cite: a reply may only rely on articles you have read.',
  schema: z.object({ kb_id: kbId }),
  summarize: (input) => `read ${input.kb_id}`,
  async execute(input, ctx) {
    const article = await ctx.api.getKbArticle(input.kb_id);
    ctx.state.retrievedKb.add(article.id);
    ctx.state.readKb.add(article.id);
    return article;
  },
});

// --- Deciding -------------------------------------------------------------------------------

const setTriage = defineTool({
  name: 'set_triage',
  tier: 'write-low',
  description:
    "Set the ticket's category, priority and the group that should pick it up. Always call this first, before anything else that decides.",
  schema: z.object({
    ticket_id: ticketIdField,
    category: z.enum(agentCategories),
    priority: z.enum(priorities),
    assignee_group: z.enum(assigneeGroups),
    reasoning_summary: z.string().max(300).describe('Why, in a sentence. Do not copy the ticket.'),
  }),
  check: (_input, ctx) =>
    ctx.state.decision ? 'You have already made a decision for this ticket. Stop.' : null,
  summarize: (input) => `${input.category} / ${input.priority} / ${input.assignee_group}`,
  remember(input, ctx) {
    ctx.state.triage = {
      category: input.category,
      priority: input.priority,
      assigneeGroup: input.assignee_group,
    };
  },
  async execute(input, ctx) {
    await ctx.api.setTriage(ctx.ticketId, {
      category: input.category,
      priority: input.priority,
      assigneeGroup: input.assignee_group,
    });
    return { done: true, note: 'The triage is set on the ticket.' };
  },
});

const proposeResolution = defineTool({
  name: 'propose_resolution',
  tier: 'write-draft',
  terminal: 'proposed',
  description:
    'Draft a reply for a person to approve. Use it only when a knowledge-base article you have read in full directly covers the problem. Every cited id must be an article you read with get_kb_article in this run. Do not use it for Security tickets or with low confidence: escalate instead.',
  schema: z.object(resolutionFields),
  check: checkResolution,
  summarize: summarizeResolution,
  decide: (input) => decisionFor('proposed', input),
  // Nothing is sent anywhere: the draft is kept on the run, and the worker marks the ticket as waiting
  // for a person once the run ends. Only a person's approval posts it.
  async execute() {
    return {
      done: true,
      note: 'Your draft is saved. A person will review it before the requester sees it.',
    };
  },
});

const postResolution = defineTool({
  name: 'post_resolution',
  tier: 'write-high',
  terminal: 'posted',
  description:
    'Post the reply to the requester yourself, and ask them to confirm it worked. Only when the task message says posting is enabled for the category you chose, and only with high confidence. It may be refused; if so, use propose_resolution.',
  schema: z.object(resolutionFields),
  check(input, ctx) {
    const shared = checkResolution(input, ctx);
    if (shared) return shared;
    if (input.confidence !== 'high')
      return 'Posting needs high confidence. Use propose_resolution.';
    const category = ctx.state.triage?.category ?? '';
    if (!mayPostAlone({ autoAllowlist: ctx.state.autoAllowlist }, ctx.mode, category)) {
      return 'Posting is not enabled for this category. Use propose_resolution.';
    }
    return null;
  },
  summarize: summarizeResolution,
  decide: (input) => decisionFor('posted', input),
  // The server checks again, against the settings as they are now: it refuses (403) where posting
  // alone is not allowed, and the model is told, so it can propose the reply instead.
  async execute(input, ctx) {
    await ctx.api.postResolution({
      ticketId: ctx.ticketId,
      replyMarkdown: input.reply_markdown,
      citedKbIds: [...new Set(input.cited_kb_ids)],
      confidence: input.confidence,
    });
    return { done: true, note: 'Your reply has been posted to the requester.' };
  },
});

// The four parts of an escalation, as lines a person reads without opening the ticket.
const summaryLines = (summary: {
  reported: string;
  checked: string;
  ruled_out: string;
  why_escalating: string;
}): string[] => [
  `Reported: ${summary.reported}`,
  `Checked: ${summary.checked}`,
  `Ruled out: ${summary.ruled_out}`,
  `Why escalating: ${summary.why_escalating}`,
];

const summaryField = (what: string) => z.string().min(1).max(500).describe(what);

const escalate = defineTool({
  name: 'escalate',
  tier: 'write-low',
  terminal: 'escalated',
  description:
    'Hand the ticket to a person, with a summary they can act on without reading the ticket. Use it for security incidents, hardware damage, changes to account access or permissions, anything the knowledge base does not cover, unclear or multi-issue tickets, low confidence, and distressed requesters.',
  schema: z.object({
    ticket_id: ticketIdField,
    assignee_group: z.enum(assigneeGroups),
    reason: z.enum(agentEscalationReasons),
    summary: z.object({
      reported: summaryField('What the person reported, in your words.'),
      checked: summaryField('What you looked at: articles, similar tickets, their history.'),
      ruled_out: summaryField('What you ruled out, or "nothing" if you found nothing to rule out.'),
      why_escalating: summaryField('Why a person needs to take this.'),
    }),
  }),
  check(input, ctx) {
    if (!ctx.state.triage) return 'Call set_triage first.';
    if (ctx.state.decision) return 'You have already made a decision for this ticket. Stop.';
    if (input.reason === 'security_incident' && input.assignee_group !== 'Security Team') {
      return 'Security incidents must go to the Security Team.';
    }
    return null;
  },
  summarize: (input) => `${input.reason} -> ${input.assignee_group}`,
  decide: (input) => ({
    kind: 'escalated',
    escalationGroup: input.assignee_group,
    escalationSummary: [`Why: ${input.reason}`, ...summaryLines(input.summary)].join('\n'),
  }),
  async execute(input, ctx) {
    await ctx.api.escalate({
      ticketId: ctx.ticketId,
      assigneeGroup: input.assignee_group,
      reason: input.reason,
      summary: summaryLines(input.summary).join('\n'),
    });
    return { done: true, note: 'The ticket has been handed to a person.' };
  },
});

export const TOOLS: readonly ToolDefinition[] = [
  getTicket,
  searchTickets,
  getRequesterContext,
  searchKb,
  getKbArticle,
  setTriage,
  proposeResolution,
  postResolution,
  escalate,
];

export const findTool = (name: string): ToolDefinition | undefined =>
  TOOLS.find((tool) => tool.name === name);

// The tools as the model sees them. The list and its order never change between runs, so the
// system prompt and tools can be cached as a prefix.
export function toolDefinitions(): Anthropic.Tool[] {
  return TOOLS.map((tool) => {
    const { $schema: _schema, ...inputSchema } = z.toJSONSchema(tool.schema) as Record<
      string,
      unknown
    >;
    return {
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema as Anthropic.Tool.InputSchema,
    };
  });
}
