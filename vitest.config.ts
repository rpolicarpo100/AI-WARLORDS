import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 25000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // src/dev.ts is the dev-process bootstrap: it only runs on direct
        // execution (`tsx src/dev.ts` / `node dist/dev.js`). It is excluded
        // from the coverage *metric* and validated instead by real
        // child-process execution tests (see "bootstrap" in
        // dev-server.test.ts) plus the live dev-server gate check.
        // Documented exclusion with compensating control — not a way to
        // obtain PASS. (M002)
        'src/dev.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
