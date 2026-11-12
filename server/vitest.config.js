import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setupEnv.js'],
    environment: 'node',
    // One fork: the sandbox has 2 GB and V8 refuses to reserve a CodeRange per
    // worker when several spawn at once. The API tests share one database anyway.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true, isolate: false } },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
});
