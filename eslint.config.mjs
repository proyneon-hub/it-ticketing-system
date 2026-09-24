import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Several runtimes live in this repo, so each gets its own globals and module
// system: the Node API and scripts, the React client (browser), and the test files
// (Vitest, Playwright). TypeScript files get typescript-eslint's recommended rules;
// TypeScript is pinned to 6.x because typescript-eslint does not support 7 yet.
const TS_FILES = ['**/*.ts', '**/*.tsx'];
const CLIENT_FILES = ['src/client/**/*.{js,jsx,ts,tsx}'];

export default [
  {
    ignores: [
      'dist/**',
      'dist-server/**',
      'coverage/**',
      'playwright-report*/**',
      'test-results/**',
      'node_modules/**',
      'Support-Ops-Automation/**', // Python project, linted with its own tooling.
    ],
  },
  js.configs.recommended,
  // Scope typescript-eslint's presets to TypeScript files only.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: config.files ?? TS_FILES })),
  {
    rules: {
      // A leading underscore marks a value that is deliberately unused.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: TS_FILES,
    rules: {
      // The TypeScript version of the rule understands types, type-only names and the
      // same underscore convention.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['server.ts', 'scripts/**/*.ts', 'src/server/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The domain layer is pure business rules: no web framework, no database, and
    // nothing from the layers above it. (architecture.test.ts checks the same rule
    // for every layer; this reports it in the editor.)
    files: ['src/server/domain/**/*.ts'],
    ignores: ['src/server/domain/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'mongoose', 'mongodb', 'zod'],
              message: 'The domain layer has no framework or database dependencies.',
            },
            {
              group: ['**/models/*', '**/repositories/*', '**/services/*', '**/routes/*', '**/db'],
              message: 'The domain layer must not depend on the layers above it.',
            },
          ],
        },
      ],
    },
  },
  {
    // The one lazy require: it keeps 12 MB of Swagger UI assets out of every cold start.
    files: ['src/server/docs.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Tests build deliberately loose objects (forged tokens, partial payloads).
    files: ['**/*.test.{ts,tsx,js,jsx}', 'src/**/__tests__/**', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['src/server/**/*.test.ts', 'src/server/__tests__/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
  {
    // k6 scripts are ES modules that run in k6's own runtime, which provides __ENV.
    files: ['perf/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },
  {
    files: [...CLIENT_FILES, 'vite.config.mjs', 'vitest.config.mjs'],
    plugins: { react },
    rules: {
      // Merged by hand: spreading both presets would let the second replace the first's rules.
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
    },
    languageOptions: {
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: CLIENT_FILES,
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react/prop-types': 'off', // Props are typed with TypeScript.
    },
  },
  {
    files: ['src/client/**/*.test.{js,jsx,ts,tsx}', 'src/client/test/**/*.{js,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.vitest } },
  },
];
