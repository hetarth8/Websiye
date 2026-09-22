import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests talk to a real Postgres and must not interleave writes
    // against the same tables; unit tests are unaffected by running serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
});
