/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    project: 'unit',
  },
  mutate: [
    'src/core/database/validators.ts',
    'src/core/database/transaction-utils.ts',
    'src/core/database/vector-ops.ts',
    'src/core/database/row-mapper.ts',
    'src/core/infra/vector-math.ts',
    'src/core/infra/path-resolver.ts',
  ],
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 90, low: 70, break: 60 },
  timeoutMS: 30000,
  concurrency: 4,
};
