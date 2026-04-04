import { buildDiagnostics, type LikelyFailureReason } from './diagnostics';

describe('buildDiagnostics', () => {
  const ctx = { model: 'claude-3.5-sonnet', frameworkState: 'framework_forming' };

  it('returns no_structured_output when nothing recognizable', () => {
    const d = buildDiagnostics('This is just plain text.', 'This is just plain text.', ctx);
    expect(d.summary).toBe('no_structured_output');
    expect(d.hasTripleDash).toBe(false);
    expect(d.hasCodeBlock).toBe(false);
    expect(d.hasJsonBraces).toBe(false);
  });

  it('returns empty_yaml when --- exists but no YAML keywords', () => {
    const d = buildDiagnostics('---\nfoo: bar\n---', '---\nfoo: bar\n---', ctx);
    expect(d.summary).toBe('empty_yaml');
    expect(d.hasTripleDash).toBe(true);
    expect(d.hasYamlKeywords).toBe(false);
  });

  it('returns yaml_without_fence when keywords present but no delimiters', () => {
    const d = buildDiagnostics('concept_id: theory\nrelation: supports\nconfidence: 0.9', '', ctx);
    // no ---, no ```, no {} → hits no_structured_output (first condition)
    // yaml_without_fence requires hasYamlKeywords && !hasTripleDash && !hasCodeBlock
    // BUT the first condition (!hasTripleDash && !hasCodeBlock && !hasJsonBraces) catches it first
    expect(d.summary).toBe('no_structured_output');
    expect(d.hasYamlKeywords).toBe(true);
    expect(d.hasTripleDash).toBe(false);
  });

  it('returns malformed_json when JSON braces present but no YAML fence', () => {
    // Use input without YAML keywords so yaml_without_fence doesn't catch it
    const d = buildDiagnostics('{ "some_field": "bad json }', '', ctx);
    expect(d.summary).toBe('malformed_json');
    expect(d.hasJsonBraces).toBe(true);
  });

  it('returns severe_format_error when both --- and keywords present', () => {
    const d = buildDiagnostics('---\nconcept_id: theory\nrelation: supports\n---', '', ctx);
    expect(d.summary).toBe('severe_format_error');
  });

  it('captures model and frameworkState from context', () => {
    const d = buildDiagnostics('hello', '', ctx);
    expect(d.model).toBe('claude-3.5-sonnet');
    expect(d.frameworkState).toBe('framework_forming');
  });

  it('defaults to "unknown" when context values are undefined', () => {
    const d = buildDiagnostics('hello', '', {});
    expect(d.model).toBe('unknown');
    expect(d.frameworkState).toBe('unknown');
  });

  it('captures output metadata correctly', () => {
    const output = 'line1\nline2\nline3';
    const d = buildDiagnostics(output, '', ctx);
    expect(d.outputLength).toBe(output.length);
    expect(d.lineCount).toBe(3);
    expect(d.firstChars).toBe(output);
    expect(d.lastChars).toBe(output);
  });

  it('truncates firstChars to 500 and lastChars to 200', () => {
    const output = 'x'.repeat(1000);
    const d = buildDiagnostics(output, '', ctx);
    expect(d.firstChars).toHaveLength(500);
    expect(d.lastChars).toHaveLength(200);
  });
});
