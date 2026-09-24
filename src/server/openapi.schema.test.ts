import { z } from 'zod';
import { createTicketSchema, patchTicketSchema } from '../shared/schemas';
import spec from './openapi.json';

// The request bodies in the OpenAPI document are written by hand, and the Zod
// schemas are what the API actually enforces. This compares the two, property by
// property, so changing a limit, an enum or a field in one place and not the other
// fails here instead of shipping documentation that lies.

interface JsonSchema {
  type?: string;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  $ref?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

const schemas = (spec as unknown as { components: { schemas: Record<string, JsonSchema> } })
  .components.schemas;

// Follows a $ref such as #/components/schemas/Status to the schema it names.
function resolve(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const target = schemas[schema.$ref.replace('#/components/schemas/', '')];
  if (!target) throw new Error(`Unresolved reference ${schema.$ref}`);
  return target;
}

// Only what validation cares about. `format` and prose are documentation, and dueAt
// is a Date after coercion, which JSON Schema cannot express, so it is compared by name only.
const constraints = ({ type, minLength, maxLength, enum: values }: JsonSchema) => ({
  type,
  minLength,
  maxLength,
  enum: values,
});

describe.each([
  ['TicketCreate', createTicketSchema],
  ['TicketPatch', patchTicketSchema],
] as const)('OpenAPI %s matches the Zod schema the API enforces', (name, schema) => {
  const zod = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  const documented = schemas[name] as JsonSchema;

  test('documents exactly the same fields', () => {
    expect(Object.keys(documented.properties ?? {}).sort()).toEqual(
      Object.keys(zod.properties ?? {}).sort()
    );
  });

  test('marks the same fields as required', () => {
    expect([...(documented.required ?? [])].sort()).toEqual([...(zod.required ?? [])].sort());
  });

  test('agrees on the type, length limits and allowed values of every field', () => {
    for (const [field, enforced] of Object.entries(zod.properties ?? {})) {
      if (field === 'dueAt') continue;
      const published = resolve(documented.properties?.[field] as JsonSchema);
      expect({ field, ...constraints(published) }).toEqual({ field, ...constraints(enforced) });
    }
  });
});

test('the comparison would notice a limit that drifted', () => {
  // Guards the test itself: a schema with a different maximum must not compare equal.
  const drifted = z.toJSONSchema(z.object({ title: z.string().max(121) }), {
    io: 'input',
  }) as JsonSchema;
  const published = schemas.TicketCreate?.properties?.title as JsonSchema;
  expect(constraints(published)).not.toEqual(constraints(drifted.properties?.title as JsonSchema));
});
