import { applyRepairRules, type RepairResult } from './auto-repair';

describe('applyRepairRules', () => {
  // ── R6: Unicode smart quotes → ASCII ──

  describe('R6 — Unicode smart quotes', () => {
    it('replaces left/right double smart quotes', () => {
      const r = applyRepairRules('key: \u201Cvalue\u201D');
      expect(r.text).toBe('key: "value"');
      expect(r.appliedRules).toContain('R6');
    });

    it('replaces left/right single smart quotes', () => {
      const r = applyRepairRules("key: \u2018value\u2019");
      expect(r.text).toBe("key: 'value'");
      expect(r.appliedRules).toContain('R6');
    });

    it('replaces fullwidth colon', () => {
      const r = applyRepairRules('key\uFF1A value');
      expect(r.text).toBe('key: value');
      expect(r.appliedRules).toContain('R6');
    });

    it('does not trigger when no smart quotes present', () => {
      const r = applyRepairRules('key: "value"');
      expect(r.appliedRules).not.toContain('R6');
    });
  });

  // ── R5: JSON trailing commas ──

  describe('R5 — trailing commas', () => {
    it('removes trailing comma at end of line', () => {
      const r = applyRepairRules('confidence: 0.85,');
      expect(r.text).toBe('confidence: 0.85');
      expect(r.appliedRules).toContain('R5');
    });

    it('removes comma before closing brace', () => {
      const r = applyRepairRules('confidence: 0.85,\n}');
      expect(r.text).toBe('confidence: 0.85\n}');
      expect(r.appliedRules).toContain('R5');
    });
  });

  // ── R7: Missing leading zero in floats ──

  describe('R7 — missing leading zero', () => {
    it('adds leading zero to confidence: .85', () => {
      const r = applyRepairRules('confidence: .85');
      expect(r.text).toBe('confidence: 0.85');
      expect(r.appliedRules).toContain('R7');
    });

    it('does not touch confidence: 0.85', () => {
      const r = applyRepairRules('confidence: 0.85');
      expect(r.appliedRules).not.toContain('R7');
    });
  });

  // ── R2: Tab & indentation normalization ──

  describe('R2 — tab/indentation', () => {
    it('replaces tabs with 2 spaces', () => {
      const r = applyRepairRules('\tkey: value');
      expect(r.text).toBe('  key: value');
      expect(r.appliedRules).toContain('R2');
    });

    it('normalizes odd indentation to even', () => {
      const r = applyRepairRules('   key: value');
      expect(r.text).toBe('    key: value');
      expect(r.appliedRules).toContain('R2');
    });

    it('does not modify even indentation', () => {
      const r = applyRepairRules('    key: value');
      expect(r.appliedRules).not.toContain('R2');
    });
  });

  // ── R3: Boolean confidence → numeric ──

  describe('R3 — boolean confidence', () => {
    it.each([
      ['yes', '0.85'],
      ['true', '0.85'],
      ['no', '0.15'],
      ['false', '0.15'],
    ])('maps confidence: %s → %s', (input, expected) => {
      const r = applyRepairRules(`confidence: ${input}`);
      expect(r.text).toBe(`confidence: ${expected}`);
      expect(r.appliedRules).toContain('R3');
    });

    it('is case-insensitive', () => {
      const r = applyRepairRules('confidence: YES');
      expect(r.text).toBe('confidence: 0.85');
    });
  });

  // ── R4: Missing list item dash prefix ──

  describe('R4 — missing dash prefix', () => {
    it('adds dash to first child under list parent', () => {
      const input = 'items:\n  name: foo';
      const r = applyRepairRules(input);
      expect(r.text).toBe('items:\n- name: foo');
      expect(r.appliedRules).toContain('R4');
    });

    it('does not modify lines already starting with dash', () => {
      const input = 'items:\n  - name: foo';
      const r = applyRepairRules(input);
      expect(r.appliedRules).not.toContain('R4');
    });

    it('does not modify lines inside block scalar', () => {
      const input = 'evidence: |\n  name: this is literal text';
      const r = applyRepairRules(input);
      expect(r.text).toContain('name: this is literal text');
      expect(r.appliedRules).not.toContain('R4');
    });
  });

  // ── R1: Unquoted colons in values ──

  describe('R1 — unquoted colons', () => {
    it('wraps value containing colon in double quotes', () => {
      const r = applyRepairRules('evidence: the paper argues that: affordances are key');
      expect(r.text).toBe('evidence: "the paper argues that: affordances are key"');
      expect(r.appliedRules).toContain('R1');
    });

    it('does not wrap already-quoted values', () => {
      const r = applyRepairRules('evidence: "the paper argues that: affordances"');
      expect(r.appliedRules).not.toContain('R1');
    });

    it('does not wrap ISO dates', () => {
      const r = applyRepairRules('date: 2026-03-25T14:30:00');
      expect(r.appliedRules).not.toContain('R1');
    });

    it('does not wrap URLs', () => {
      const r = applyRepairRules('link: https://example.com/path');
      expect(r.appliedRules).not.toContain('R1');
    });

    it('escapes existing double quotes in value', () => {
      const r = applyRepairRules('evidence: he said "yes": confirmed');
      expect(r.text).toContain('he said \\"yes\\": confirmed');
    });
  });

  // ── Rule ordering / composition ──

  describe('rule ordering', () => {
    it('returns empty appliedRules for clean YAML', () => {
      const r = applyRepairRules('concept_id: theory_of_mind\nrelation: supports\nconfidence: 0.85');
      expect(r.appliedRules).toEqual([]);
      expect(r.text).toBe('concept_id: theory_of_mind\nrelation: supports\nconfidence: 0.85');
    });

    it('applies multiple rules in correct order', () => {
      // smart quote + trailing comma + missing zero
      const input = 'evidence: \u201Cfoo\u201D,\nconfidence: .85';
      const r = applyRepairRules(input);
      expect(r.appliedRules).toContain('R6');
      expect(r.appliedRules).toContain('R5');
      expect(r.appliedRules).toContain('R7');
    });

    it('rules are applied in dependency order (R6 before R5 before R2 etc)', () => {
      const input = '\u201Cfoo\u201D,\n\tconfidence: .85';
      const r = applyRepairRules(input);
      // R6 runs first (tier 1), then R5 (tier 2), R7 (tier 2), R2 (tier 3)
      const r6Idx = r.appliedRules.indexOf('R6');
      const r5Idx = r.appliedRules.indexOf('R5');
      const r2Idx = r.appliedRules.indexOf('R2');
      expect(r6Idx).toBeLessThan(r5Idx);
      expect(r5Idx).toBeLessThan(r2Idx);
    });
  });
});
