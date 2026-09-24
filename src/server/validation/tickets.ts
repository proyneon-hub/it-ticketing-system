import { ValidationError } from '../errors';
import {
  createCommentSchema,
  createTicketSchema,
  exportQuerySchema,
  listQuerySchema,
  patchTicketSchema,
  trendsQuerySchema,
  type CreateCommentInput,
  type CreateTicketInput,
  type ExportQuery,
  type ListQuery,
  type PatchTicketInput,
  type TrendsQuery,
} from '../../shared/schemas';
import type { z } from 'zod';

// Turns untrusted input into a validated, typed value, or a 400 that names the
// offending field. The schemas themselves are in shared/schemas.ts.

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      message: issue.message,
    }));
    throw new ValidationError(errors[0]?.message ?? 'Invalid request.', errors);
  }

  // Optional fields that were not sent come back as undefined; drop them so the
  // result only holds what the caller actually provided.
  return Object.fromEntries(
    Object.entries(result.data as object).filter(([, value]) => value !== undefined)
  ) as z.output<S>;
}

export const parseListQuery = (query: unknown): ListQuery => parseOrThrow(listQuerySchema, query);
export const parseExportQuery = (query: unknown): ExportQuery =>
  parseOrThrow(exportQuerySchema, query);
export const parseCreateTicket = (body: unknown): CreateTicketInput =>
  parseOrThrow(createTicketSchema, body);
export const parseTrendsQuery = (query: unknown): TrendsQuery =>
  parseOrThrow(trendsQuerySchema, query);
export const parseCreateComment = (body: unknown): CreateCommentInput =>
  parseOrThrow(createCommentSchema, body);
export const parsePatchTicket = (body: unknown): PatchTicketInput =>
  parseOrThrow(patchTicketSchema, body);

// If-Match carries the ticket version the client last saw: "3", W/"3" or a bare 3.
// `*` (any current version) and a missing header both mean "no precondition".
export function parseIfMatch(header: string | undefined): number | undefined {
  if (header === undefined || header.trim() === '*') return undefined;

  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!match) throw new ValidationError('If-Match must be a ticket version such as "3".');
  return Number(match[1]);
}
