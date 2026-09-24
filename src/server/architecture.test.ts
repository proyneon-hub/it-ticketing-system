import fs from 'fs';
import path from 'path';

// The layers only mean something if they stay separate. These rules are checked
// against the real import statements, so a shortcut fails the build instead of
// quietly eroding the structure:
//
//   routes        HTTP only: call services, never the database
//   services      orchestration: call repositories and the domain, never Mongoose
//   repositories  storage: the only place that queries Mongoose
//   domain        pure business rules: no framework, no database
//
// (typescript-eslint cannot run on TypeScript 7 yet, so this stands in for an
// import-restriction lint rule.)

const SERVER_DIR = __dirname;

interface Rule {
  layer: string;
  forbidden: RegExp;
  why: string;
}

const FRAMEWORKS = 'express|mongoose|mongodb|cors|helmet|express-rate-limit|swagger-ui-express';
const DATABASE = String.raw`(\.\./)+(models|repositories|db)(/|$)`;

const RULES: Rule[] = [
  {
    layer: 'domain',
    forbidden: new RegExp(
      String.raw`^(${FRAMEWORKS}|zod)$|${DATABASE}|(\.\./)+(services|routes|middleware)(/|$)`
    ),
    why: 'domain rules must not depend on a web framework, the database, or the layers above them',
  },
  {
    layer: 'repositories',
    forbidden: new RegExp(String.raw`^express$|(\.\./)+(services|routes|middleware)(/|$)`),
    why: 'repositories only deal with storage',
  },
  {
    layer: 'services',
    forbidden: new RegExp(String.raw`^(${FRAMEWORKS})$|(\.\./)+(models|db|routes|middleware)(/|$)`),
    why: 'services reach the database through repositories, never directly',
  },
  {
    layer: 'routes',
    forbidden: new RegExp(String.raw`^(mongoose|mongodb)$|(\.\./)+(models|repositories|db)(/|$)`),
    why: 'routes call services; they must not query the database',
  },
];

function sourceFiles(layer: string): string[] {
  const dir = path.join(SERVER_DIR, layer);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(dir, name));
}

function importsIn(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const found = [...source.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)];
  return found.map((match) => match[1] as string);
}

describe('layer boundaries', () => {
  test.each(RULES)('$layer: $why', ({ layer, forbidden }) => {
    const files = sourceFiles(layer);
    expect(files.length).toBeGreaterThan(0); // The rule must actually be checking something.

    const violations = files.flatMap((file) =>
      importsIn(file)
        .filter((specifier) => forbidden.test(specifier))
        .map((specifier) => `${path.relative(SERVER_DIR, file)} imports '${specifier}'`)
    );

    expect(violations).toEqual([]);
  });

  test('the rule patterns catch what they are meant to catch', () => {
    const domain = RULES[0]?.forbidden as RegExp;
    expect(domain.test('mongoose')).toBe(true);
    expect(domain.test('express')).toBe(true);
    expect(domain.test('../models/Ticket')).toBe(true);
    expect(domain.test('../repositories/ticketRepository')).toBe(true);
    expect(domain.test('../errors')).toBe(false);
    expect(domain.test('../../shared/ticket-constants')).toBe(false);
  });
});
