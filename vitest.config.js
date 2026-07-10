import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Pre-existing obra integration suites are written for node:test (CommonJS,
    // spawn/ws) and are run separately, not under vitest. Exclude them so the
    // fork's vitest specs stay green under `npm test`.
    exclude: [
      'node_modules/**',
      'tests/brainstorm-server/**',
    ],
    environment: 'node',
  },
});
