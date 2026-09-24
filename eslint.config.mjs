import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Three runtimes live in this repo, so each gets its own globals and module
// system: the CommonJS API/scripts (Node), the ESM React client (browser), and
// the test files (Vitest).
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
    files: ['api/**/*.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['src/client/**/*.{js,jsx}', 'vite.config.mjs', 'vitest.config.mjs'],
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
    files: ['src/client/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react/prop-types': 'off', // Plain JavaScript project; prop shapes are covered by tests.
    },
  },
  {
    files: ['src/client/**/*.test.{js,jsx}', 'src/client/test/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.vitest } },
  },
];
