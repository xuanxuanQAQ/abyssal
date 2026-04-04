/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    project: 'unit',
  },
  mutate: [
    // database
    'src/core/database/validators.ts',
    'src/core/database/transaction-utils.ts',
    'src/core/database/vector-ops.ts',
    'src/core/database/row-mapper.ts',
    // infra
    'src/core/infra/vector-math.ts',
    'src/core/infra/path-resolver.ts',
    // output-parser
    'src/adapter/output-parser/auto-repair.ts',
    'src/adapter/output-parser/diagnostics.ts',
    'src/adapter/output-parser/evidence-normalizer.ts',
    'src/adapter/output-parser/field-validator.ts',
    'src/adapter/output-parser/suggestion-parser.ts',
    'src/adapter/output-parser/output-parser.ts',
    // prompt-assembler
    'src/adapter/prompt-assembler/annotation-injector.ts',
    'src/adapter/prompt-assembler/compact-mode.ts',
    'src/adapter/prompt-assembler/retrieval-formatter.ts',
    'src/adapter/prompt-assembler/truncation-engine.ts',
    'src/adapter/prompt-assembler/fulltext-compressor.ts',
    'src/adapter/prompt-assembler/section-formatter.ts',
    // config
    'src/core/config/framework-state.ts',
    'src/core/config/env-parser.ts',
    // event-bus
    'src/core/event-bus/event-bus.ts',
    // copilot-runtime
    'src/copilot-runtime/recipe-registry.ts',
    'src/copilot-runtime/tool-call-governor.ts',
    'src/copilot-runtime/budget-tracker.ts',
    'src/copilot-runtime/operation-scoring.ts',
  ],
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 90, low: 70, break: 60 },
  timeoutMS: 30000,
  concurrency: 4,
};
