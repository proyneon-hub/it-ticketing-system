import { z } from 'zod';
import { agentEscalationReasons, agentModes, agentOutcomes } from './agent-constants';
import {
  agentCategories,
  assigneeGroups,
  auditTypes,
  commentVisibilities,
  outboxStatuses,
  priorities,
  roles,
  slaFilters,
  sortFields,
  statuses,
} from './ticket-constants';

// Query-string and JSON values arrive untrusted. These schemas are the single
// place where they are trimmed, coerced, bounded, and rejected with a 400. They live
// in shared/ so the API validates with them and the client can use the same types.

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const optionalFilter = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

function integerParam(
  name: string,
  { defaultValue, min, max }: { defaultValue: number; min: number; max: number }
) {
  const error = `${name} must be an integer between ${min} and ${max}.`;
  return z.preprocess((value) => {
    const cleaned = blankToUndefined(value);
    return typeof cleaned === 'string' ? Number(cleaned) : cleaned;
  }, z.number({ error }).int({ error }).min(min, { error }).max(max, { error }).default(defaultValue));
}

export const listQuerySchema = z.object({
  status: optionalFilter(z.enum(statuses, { error: 'Invalid status filter.' })),
  priority: optionalFilter(z.enum(priorities, { error: 'Invalid priority filter.' })),
  sla: optionalFilter(z.enum(slaFilters, { error: 'Invalid SLA filter.' })),
  // No default here: when a search is given and no sort is asked for, results are
  // ranked by relevance, which only the service knows.
  sortBy: optionalFilter(z.enum(sortFields, { error: 'Invalid sortBy field.' })),
  sortOrder: z.preprocess(
    blankToUndefined,
    z.enum(['asc', 'desc'], { error: 'Invalid sortOrder value.' }).default('desc')
  ),
  page: integerParam('page', { defaultValue: 1, min: 1, max: 100000 }),
  limit: integerParam('limit', { defaultValue: 10, min: 1, max: 100 }),
  assignedTo: optionalFilter(
    z.string({ error: 'Invalid assignedTo filter.' }).max(80, {
      error: 'assignedTo must be 80 characters or fewer.',
    })
  ),
  search: optionalFilter(
    z.string({ error: 'Invalid search text.' }).max(100, {
      error: 'Search text must be 100 characters or fewer.',
    })
  ),
  // Tickets raised under one address: what the agent uses to see a requester's recent history.
  // Staff and the agent only; a requester is always limited to their own address whatever this says.
  requesterEmail: optionalFilter(
    z
      .string({ error: 'Invalid requesterEmail filter.' })
      .max(254, { error: 'requesterEmail must be 254 characters or fewer.' })
      .toLowerCase()
  ),
});

// Exports always return the whole filtered set, so paging parameters are ignored.
export const exportQuerySchema = listQuerySchema.omit({ page: true, limit: true });

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(max, { error: `${label} must be ${max} characters or fewer.` });

const ticketFields = {
  title: z
    .string({
      error: (issue) => (issue.input === undefined ? 'Title is required.' : 'Title must be text.'),
    })
    .trim()
    .min(1, { error: 'Title is required.' })
    .max(120, { error: 'Title must be 120 characters or fewer.' }),
  description: text('Description', 2000),
  requesterName: text('Requester name', 80),
  requesterEmail: text('Requester email', 120).refine(
    (value) => value === '' || z.email().safeParse(value).success,
    { error: 'Invalid requester email.' }
  ),
  status: z.enum(statuses, { error: 'Invalid status.' }),
  priority: z.enum(priorities, { error: 'Invalid priority.' }),
  assignee: text('Assignee', 80).transform((value) => value || 'Unassigned'),
  category: text('Category', 80),
  dueAt: z.preprocess(
    (value) => {
      if (typeof value === 'string') return value.trim() === '' ? undefined : new Date(value);
      return typeof value === 'number' ? new Date(value) : value;
    },
    z.date({ error: 'Invalid SLA due date.' }).optional()
  ),
};

// Only whitelisted fields survive parsing, so callers can spread the result
// straight into a database write without leaking arbitrary client input.
export const createTicketSchema = z
  .object(ticketFields)
  .partial()
  .extend({ title: ticketFields.title });
export const patchTicketSchema = z.object(ticketFields).partial();

export const kbSearchQuerySchema = z.object({
  search: optionalFilter(
    z.string({ error: 'Invalid search text.' }).max(100, {
      error: 'Search text must be 100 characters or fewer.',
    })
  ),
  category: optionalFilter(z.enum(agentCategories, { error: 'Invalid category.' })),
  limit: integerParam('limit', { defaultValue: 5, min: 1, max: 25 }),
});

export type ListQuery = z.output<typeof listQuerySchema>;
export type KbSearchQuery = z.output<typeof kbSearchQuerySchema>;
export type ExportQuery = z.output<typeof exportQuerySchema>;
export type CreateTicketInput = z.output<typeof createTicketSchema>;
export type PatchTicketInput = z.output<typeof patchTicketSchema>;

// The trends chart: how many days to look back and which time zone decides where a day ends.
export const trendsQuerySchema = z.object({
  days: integerParam('days', { defaultValue: 30, min: 1, max: 90 }),
  // An IANA name such as America/Toronto. The server checks the name; blank means UTC.
  tz: optionalFilter(
    z.string({ error: 'Invalid time zone.' }).max(64, { error: 'Invalid time zone.' })
  ),
});
export type TrendsQuery = z.output<typeof trendsQuerySchema>;

// --- Comments -------------------------------------------------------------------

export const createCommentSchema = z.object({
  body: z
    .string({
      error: (issue) =>
        issue.input === undefined ? 'Comment is required.' : 'Comment must be text.',
    })
    .trim()
    .min(1, { error: 'Comment is required.' })
    .max(2000, { error: 'Comment must be 2000 characters or fewer.' }),
  visibility: z.enum(commentVisibilities, { error: 'Invalid visibility.' }).default('public'),
});
export type CreateCommentInput = z.output<typeof createCommentSchema>;

// --- Administration -------------------------------------------------------------

// Changing a user's role: the only thing an admin can change about a user.
export const patchUserSchema = z.object({
  role: z.enum(roles, { error: 'Invalid role.' }),
});
export type PatchUserInput = z.output<typeof patchUserSchema>;

export const listAuditQuerySchema = z.object({
  type: optionalFilter(z.enum(auditTypes, { error: 'Invalid audit event type.' })),
  page: integerParam('page', { defaultValue: 1, min: 1, max: 100000 }),
  limit: integerParam('limit', { defaultValue: 25, min: 1, max: 100 }),
});
export type ListAuditQuery = z.output<typeof listAuditQuerySchema>;

export const listOutboxQuerySchema = z.object({
  status: optionalFilter(z.enum(outboxStatuses, { error: 'Invalid outbox status.' })),
  page: integerParam('page', { defaultValue: 1, min: 1, max: 100000 }),
  limit: integerParam('limit', { defaultValue: 25, min: 1, max: 100 }),
});
export type ListOutboxQuery = z.output<typeof listOutboxQuerySchema>;

// --- The service desk agent -----------------------------------------------------

// Approving a proposal: optionally with the reply a person has edited it to. Without one, the
// agent's own reply is posted as it was.
export const approveProposalSchema = z.object({
  replyMarkdown: z
    .string({ error: 'The reply must be text.' })
    .trim()
    .min(20, { error: 'The reply is too short to help.' })
    .max(2000, { error: 'The reply must be 2000 characters or fewer.' })
    .optional(),
});
export type ApproveProposalInput = z.output<typeof approveProposalSchema>;

export const rejectProposalSchema = z.object({
  reason: z
    .string({ error: 'The reason must be text.' })
    .trim()
    .max(200, { error: 'The reason must be 200 characters or fewer.' })
    .optional(),
});
export type RejectProposalInput = z.output<typeof rejectProposalSchema>;

// What the agent sends when it hands a ticket to a person. The ticket id is the run's own; the API
// refuses any other.
export const agentEscalationSchema = z.object({
  ticketId: z.string({ error: 'ticketId is required.' }).regex(/^[a-f\d]{24}$/i, {
    error: 'Invalid ticket id.',
  }),
  assigneeGroup: z.enum(assigneeGroups, { error: 'Invalid assignee group.' }),
  reason: z.enum(agentEscalationReasons, { error: 'Invalid escalation reason.' }),
  summary: z
    .string({ error: 'A summary is required.' })
    .trim()
    .min(1, { error: 'A summary is required.' })
    .max(1800, { error: 'The summary must be 1800 characters or fewer.' }),
});
export type AgentEscalationInput = z.output<typeof agentEscalationSchema>;

// Changing the agent's settings. Only what is sent changes, and nothing else is accepted.
export const updateAgentSettingsSchema = z
  .object({
    killSwitch: z.boolean({ error: 'killSwitch must be true or false.' }),
    defaultMode: z.enum(agentModes, { error: 'Invalid mode.' }),
    modeByCategory: z.record(z.string(), z.enum(agentModes, { error: 'Invalid mode.' })),
    autoAllowlist: z.array(z.string().max(80)).max(20),
    dailyCostCapUsd: z
      .number({ error: 'dailyCostCapUsd must be a number.' })
      .min(0, { error: 'dailyCostCapUsd must be zero or more.' })
      .max(10000, { error: 'dailyCostCapUsd is too large.' }),
    perRequesterHourlyLimit: z
      .number({ error: 'perRequesterHourlyLimit must be a number.' })
      .int({ error: 'perRequesterHourlyLimit must be a whole number.' })
      .min(0, { error: 'perRequesterHourlyLimit must be zero or more.' })
      .max(1000, { error: 'perRequesterHourlyLimit is too large.' }),
  })
  .partial()
  .strict();
export type UpdateAgentSettingsInput = z.output<typeof updateAgentSettingsSchema>;

export const listAgentRunsQuerySchema = z.object({
  outcome: optionalFilter(z.enum(agentOutcomes, { error: 'Invalid outcome.' })),
  page: integerParam('page', { defaultValue: 1, min: 1, max: 100000 }),
  limit: integerParam('limit', { defaultValue: 25, min: 1, max: 100 }),
});
export type ListAgentRunsQuery = z.output<typeof listAgentRunsQuerySchema>;
