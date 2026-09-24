import { defineConfig } from 'vitest/config';

// API tests. Two projects share this config so CI can run the fast ones first:
//   unit         no database: workflow rules, auth, security, config
//   integration  the real app and Mongoose models against an in-memory MongoDB,
//                including the OpenAPI contract test
// Files run one at a time because each integration file starts its own mongod.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    // Worker threads, not forked processes: on Windows the forked workers crashed at
    // start (exit code 0xC0000409) in roughly one full run in eight. Threads did not in
    // twelve runs. Linux CI never showed it, so this is a mitigation, not a diagnosis.
    pool: 'threads',
    testTimeout: 60_000,
    // The first run downloads and starts a MongoDB binary.
    hookTimeout: 300_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/server/**/*.test.ts'],
          exclude: ['src/server/**/*.integration.test.ts', 'src/server/**/*.contract.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/server/**/*.integration.test.ts', 'src/server/**/*.contract.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/**/*.test.ts', 'src/server/__tests__/**', 'src/server/**/*.d.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/server',
      thresholds: { statements: 88, branches: 78, functions: 88, lines: 88 },
    },
  },
});
