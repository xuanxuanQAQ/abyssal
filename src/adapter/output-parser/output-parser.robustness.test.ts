import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, parseAndValidate } from './output-parser';

describe('output-parser robustness', () => {
  it('parses YAML frontmatter surrounded by noisy prefix and suffix text', () => {
    const input = `Model preamble\nSome analysis follows\n---\nconcept_mappings:\n  - concept_id: affordance\n    relation: supports\n    confidence: 0.82\n---\n\nTrailing commentary\nMore notes`;

    const result = parse(input);

    expect(result.success).toBe(true);
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('recovers from a missing closing fence for scalar frontmatter and preserves trailing body', () => {
    const input = `---\nframework_state: analyzing\n## Summary\nRecovered body`;

    const result = parse(input);

    expect(result.success).toBe(true);
    expect(result.frontmatter?.framework_state).toBe('analyzing');
    expect(result.body).toContain('Recovered body');
  });

  it('prefers the YAML-like block when multiple code blocks are present', () => {
    const input = [
      '```ts',
      'const noop = true;',
      '```',
      '```yaml',
      'concept_mappings:',
      '  - concept_id: affordance',
      '    relation: supports',
      '    confidence: 0.9',
      '```',
    ].join('\n');

    const result = parse(input);

    expect(result.success).toBe(true);
    expect(result.strategy).toBe('code_block');
    expect(result.frontmatter?.concept_mappings).toBeDefined();
  });

  it('returns diagnostics and raw archive path on total parse failure', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'abyssal-parser-'));
    try {
      const result = parseAndValidate('just free-form prose with no structure', {
        paperId: 'paper-fail',
        workspaceRoot,
      });

      expect(result.success).toBe(false);
      expect(result.diagnostics).not.toBeNull();
      expect(result.rawPath).toContain('paper-fail');
      expect(result.conceptMappings).toEqual([]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});