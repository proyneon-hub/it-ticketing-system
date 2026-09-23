const { z } = require('zod');
const {
  statuses,
  priorities,
  slaFilters,
  sortFields,
} = require('../../shared/ticket-constants.json');
const { badRequest } = require('../errors');

// Query-string and JSON values arrive untrusted. These schemas are the single
// place where they are trimmed, coerced, bounded, and rejected with a 400.

const blankToUndefined = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const optionalFilter = (schema) => z.preprocess(blankToUndefined, schema.optional());

function integerParam(name, { defaultValue, min, max }) {
  const error = `${name} must be an integer between ${min} and ${max}.`;
  return z.preprocess((value) => {
    const cleaned = blankToUndefined(value);
    return typeof cleaned === 'string' ? Number(cleaned) : cleaned;
  }, z.number({ error }).int({ error }).min(min, { error }).max(max, { error }).default(defaultValue));
}

const listQuerySchema = z.object({
  status: optionalFilter(z.enum(statuses, { error: 'Invalid status filter.' })),
  priority: optionalFilter(z.enum(priorities, { error: 'Invalid priority filter.' })),
  sla: optionalFilter(z.enum(slaFilters, { error: 'Invalid SLA filter.' })),
  sortBy: z.preprocess(
    blankToUndefined,
    z.enum(sortFields, { error: 'Invalid sortBy field.' }).default('createdAt')
  ),
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
});

// Exports always return the whole filtered set, so paging parameters are ignored.
const exportQuerySchema = listQuerySchema.omit({ page: true, limit: true });

const text = (label, max) =>
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
const createTicketSchema = z.object(ticketFields).partial().extend({ title: ticketFields.title });
const patchTicketSchema = z.object(ticketFields).partial();

function parseOrThrow(schema, input) {
  const result = schema.safeParse(input);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      message: issue.message,
    }));
    throw badRequest(errors[0].message, errors);
  }

  return Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== undefined));
}

module.exports = {
  parseListQuery: (query) => parseOrThrow(listQuerySchema, query),
  parseExportQuery: (query) => parseOrThrow(exportQuerySchema, query),
  parseCreateTicket: (body) => parseOrThrow(createTicketSchema, body),
  parsePatchTicket: (body) => parseOrThrow(patchTicketSchema, body),
};
