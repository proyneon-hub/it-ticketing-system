import { ValidationError } from '../errors';
import {
  listAuditQuerySchema,
  patchUserSchema,
  type ListAuditQuery,
  type PatchUserInput,
} from '../../shared/schemas';
import type { z } from 'zod';

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      message: issue.message,
    }));
    throw new ValidationError(errors[0]?.message ?? 'Invalid request.', errors);
  }
  return result.data;
}

export const parsePatchUser = (body: unknown): PatchUserInput => parse(patchUserSchema, body);
export const parseAuditQuery = (query: unknown): ListAuditQuery =>
  parse(listAuditQuerySchema, query);
