import { configDefaults, defineConfig } from 'vitest/config';

// Wall-clock latency gates only, run in a single worker so no sibling test file competes
// for the CPU while samples are taken. The parallel suite (vite.config.ts) excludes them.
export default defineConfig({
  test: {
    include: ['src/**/*.perf.test.ts'],
    exclude: configDefaults.exclude,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
