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
    testTimeout: 60_000,
    // The first run downloads and starts a MongoDB binary.
    hookTimeout: 300_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/server/**/*.test.js'],
          exclude: ['src/server/**/*.integration.test.js', 'src/server/**/*.contract.test.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/server/**/*.integration.test.js', 'src/server/**/*.contract.test.js'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.js'],
      exclude: ['src/server/**/*.test.js', 'src/server/__tests__/**'],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/server',
      thresholds: { statements: 88, branches: 78, functions: 88, lines: 88 },
    },
  },
});
