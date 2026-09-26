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
//   agent         the service desk agent: only the ticketing API, never the database, and
//                 never the code that mints its token (docs/adr/009)
//
// (ESLint has a matching import restriction for the domain layer, which reports a
// violation in the editor; this test covers every layer and runs in CI.)

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
    layer: 'agent',
    forbidden: new RegExp(
      String.raw`^(${FRAMEWORKS})$|${DATABASE}|(\.\./)+(services|routes|middleware|security)(/|$)`
    ),
    why: 'the agent reaches the ticketing system only through its API: no database, no layers above it, and no way to mint its own token',
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

// Every way a file can name another module: `from 'x'`, `require('x')`, a bare `import 'x'` and a
// dynamic `import('x')`. The last two matter: a layer rule that only saw `from` could be walked
// around with `await import('../db')`, which this codebase already uses for jose and the SDK.
const IMPORT_SPECIFIER = /(?:\bfrom|\brequire\(|\bimport\(?)\s*['"]([^'"]+)['"]/g;

const specifiersIn = (source: string): string[] =>
  [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] as string);

function importsIn(file: string): string[] {
  return specifiersIn(fs.readFileSync(file, 'utf8'));
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

  test('every form of import is seen, so a rule cannot be walked around', () => {
    expect(
      specifiersIn(
        [
          "import a from '../a';",
          "import { b } from '../b';",
          "import type { c } from '../c';",
          "export { d } from '../d';",
          "import '../e';",
          "const f = await import('../f');",
          "const g = require('../g');",
          'import h from "../h";',
        ].join('\n')
      )
    ).toEqual(['../a', '../b', '../c', '../d', '../e', '../f', '../g', '../h']);
  });

  test('a word that merely contains "import" or "from" is not an import', () => {
    expect(specifiersIn("const important = 'x'; // nothing from 'here' is imported")).toEqual([
      'here',
    ]);
    expect(specifiersIn("const reimport = 'x'; const important = 'y';")).toEqual([]);
  });

  test('the rule patterns catch what they are meant to catch', () => {
    const domain = RULES[0]?.forbidden as RegExp;
    expect(domain.test('mongoose')).toBe(true);
    expect(domain.test('express')).toBe(true);
    expect(domain.test('../models/Ticket')).toBe(true);
    expect(domain.test('../repositories/ticketRepository')).toBe(true);
    expect(domain.test('../errors')).toBe(false);
    expect(domain.test('../../shared/ticket-constants')).toBe(false);

    const agent = RULES.find((rule) => rule.layer === 'agent')?.forbidden as RegExp;
    for (const forbidden of [
      'mongoose',
      'express',
      '../models/Ticket',
      '../repositories/ticketRepository',
      '../db',
      '../services/ticketService',
      '../routes/tickets',
      '../middleware/security',
      '../security/accessToken',
    ]) {
      expect(agent.test(forbidden)).toBe(true);
    }
    for (const allowed of [
      '../domain/agentPolicy',
      '../../shared/ticket-constants',
      '@anthropic-ai/sdk',
      'zod',
      './registry',
      'fs',
    ]) {
      expect(agent.test(allowed)).toBe(false);
    }
  });
});
