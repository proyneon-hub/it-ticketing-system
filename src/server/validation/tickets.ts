import { ValidationError } from '../errors';
import {
  agentEscalationSchema,
  approveProposalSchema,
  listAgentRunsQuerySchema,
  rejectProposalSchema,
  updateAgentSettingsSchema,
  createCommentSchema,
  createTicketSchema,
  exportQuerySchema,
  listQuerySchema,
  patchTicketSchema,
  trendsQuerySchema,
  type AgentEscalationInput,
  type ApproveProposalInput,
  type ListAgentRunsQuery,
  type RejectProposalInput,
  type UpdateAgentSettingsInput,
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
export const parseApproveProposal = (body: unknown): ApproveProposalInput =>
  parseOrThrow(approveProposalSchema, body ?? {});
export const parseRejectProposal = (body: unknown): RejectProposalInput =>
  parseOrThrow(rejectProposalSchema, body ?? {});
export const parseAgentEscalation = (body: unknown): AgentEscalationInput =>
  parseOrThrow(agentEscalationSchema, body);
export const parseUpdateAgentSettings = (body: unknown): UpdateAgentSettingsInput => {
  const changes = parseOrThrow(updateAgentSettingsSchema, body);
  if (Object.keys(changes).length === 0) {
    throw new ValidationError('No supported settings were provided.');
  }
  return changes;
};
export const parseListAgentRunsQuery = (query: unknown): ListAgentRunsQuery =>
  parseOrThrow(listAgentRunsQuerySchema, query);

// The ticket version a header carries: "3", W/"3" or a bare 3. `*` (any current version) and a
// missing header both mean "no precondition".
function parseVersionHeader(header: string | undefined, name: string): number | undefined {
  if (header === undefined || header.trim() === '*') return undefined;

  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!match) throw new ValidationError(`${name} must be a ticket version such as "3".`);
  return Number(match[1]);
}

// If-Match carries the ticket version the client last saw.
export const parseIfMatch = (header: string | undefined): number | undefined =>
  parseVersionHeader(header, 'If-Match');

// The version an edit was made against. `X-Ticket-Version` is the same thing as `If-Match`, for
// callers behind a CDN that answers If-Match itself: Vercel compares it with the response's ETag,
// so a successful edit (whose ETag is the new version) came back as 412 after it had been saved.
// The web app sends X-Ticket-Version; if both are sent, it wins.
export const parseExpectedVersion = (
  ifMatch: string | undefined,
  ticketVersion: string | undefined
): number | undefined =>
  ticketVersion !== undefined
    ? parseVersionHeader(ticketVersion, 'X-Ticket-Version')
    : parseIfMatch(ifMatch);
