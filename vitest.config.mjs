import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Frontend unit and component tests. The API is tested separately (vitest.server.config.mjs), and
// the browser flows with Playwright.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/client/test/setup.ts'],
    include: ['src/client/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/client/**/*.{ts,tsx}'],
      exclude: [
        'src/client/main.tsx',
        'src/client/test/**',
        'src/client/**/*.test.*',
        'src/client/**/*.d.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/client',
      thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
  },
});
