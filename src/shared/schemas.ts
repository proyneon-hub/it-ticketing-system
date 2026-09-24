import { z } from 'zod';
import { priorities, slaFilters, sortFields, statuses } from './ticket-constants';

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

export type ListQuery = z.output<typeof listQuerySchema>;
export type ExportQuery = z.output<typeof exportQuerySchema>;
export type CreateTicketInput = z.output<typeof createTicketSchema>;
export type PatchTicketInput = z.output<typeof patchTicketSchema>;
