# ADR 008: TypeScript everywhere, compiled with `tsc`, tested with Vitest

Status: accepted

## Context

The API was JavaScript tested with Jest, and the client was JavaScript too. Types on the request and response shapes were the missing safety net: the bug that all mocks missed (sign-in returned `id`, the client read `sub`) is the kind a shared type catches. Jest could not run TypeScript without an extra transformer, and the toolchain needed to work on Windows, in an Alpine container and on Vercel.

## Decision

- **Strict TypeScript for the API, the client and the tests.** Request and response types, constants and the Zod schemas live in `src/shared/`, imported by both sides.
- **The API is compiled, not interpreted, in production.** `tsc -p tsconfig.server.json` writes CommonJS to `dist-server/`, and that one output is what `npm start`, the Docker image and the Vercel functions run (the `api/*.js` adapters load the compiled app). Development uses `tsx` on the same sources. The package stays CommonJS with `module: nodenext`.
- **Vitest replaces Jest.** It runs TypeScript natively, is already the client's runner, and gives the API two projects: `unit` (no database) and `integration` (a real in-memory MongoDB replica set, and the OpenAPI contract test). Coverage thresholds carry over and are enforced per suite.
- **TypeScript is pinned to 6.x.** `typescript-eslint`, which lints all the TypeScript, does not support TypeScript 7 yet, and an npm `overrides` entry cannot redirect its peer requirement (tried). Dependabot ignores major TypeScript updates until it does.
- **Layer boundaries are checked, not just described.** A test reads the real import statements and fails if a route imports the database, a service imports Mongoose, or the domain imports a framework; an ESLint import restriction reports the domain rule in the editor.
- **Server tests run on worker threads.** With forked workers the Vitest run crashed at start on Windows (exit code `0xC0000409`) in roughly one full run in eight; threads did not crash in twelve runs. Linux CI never showed it, so this is a mitigation, not a diagnosis.

## Consequences

- A build step exists for the API, and a mistake that only shows in compiled output (a path that differs between `src` and `dist-server`) is possible. The real-stack smoke test runs the compiled image for exactly this reason.
- The whole repository type-checks with one command (`npm run typecheck`, covering the API, the client and the Playwright suite), and it is a CI stage.
- Holding TypeScript back is a small, tracked debt.

## Alternatives considered

- **Keep Jest with `ts-jest`.** A second runner and transformer beside Vitest for no gain.
- **Run TypeScript directly in production** (`tsx` or Node's type stripping). Faster to set up, but the deployed artefact would not be what was type-checked and tested, and Vercel would compile per function.
- **ESM output.** The dependency set and the serverless adapters were simpler as CommonJS.
