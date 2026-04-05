import { fc, it as fcIt } from '@fast-check/vitest';
import { applyRepairRules } from '../../../src/adapter/output-parser/auto-repair';

describe('auto-repair properties', () => {
  fcIt.prop([fc.string({ minLength: 0, maxLength: 3000 })])(
    'is idempotent across arbitrary YAML-like input',
    (input) => {
      const once = applyRepairRules(input);
      const twice = applyRepairRules(once.text);
      expect(twice.text).toBe(once.text);
      expect(twice.appliedRules).toEqual(applyRepairRules(once.text).appliedRules);
    },
  );
});
