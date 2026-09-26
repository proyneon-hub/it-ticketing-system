import type { z } from 'zod';
import { ValidationError } from '../errors';
import { kbSearchQuerySchema, type KbSearchQuery } from '../../shared/schemas';

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

export const parseKbSearch = (query: unknown): KbSearchQuery => parse(kbSearchQuerySchema, query);
