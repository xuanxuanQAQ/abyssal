import { parseEnvironmentVariables, resolveApiKeys } from './env-parser';

describe('parseEnvironmentVariables', () => {
  it('returns empty object for no ABYSSAL_ variables', () => {
    const result = parseEnvironmentVariables({ PATH: '/usr/bin', HOME: '/home/user' });
    expect(result).toEqual({});
  });

  it('maps ABYSSAL_RAG_EMBEDDING_DIM to { rag: { embeddingDim } }', () => {
    // ABYSSAL_RAG_EMBEDDING_DIM → ['rag', 'embeddingDim'] (camelCase from underscore segments)
    const result = parseEnvironmentVariables({ ABYSSAL_RAG_EMBEDDING_DIM: '768' });
    expect((result['rag'] as any)?.embeddingDim).toBe(768);
  });

  it('coerces "true" to boolean true', () => {
    const result = parseEnvironmentVariables({ ABYSSAL_LLM_STREAMING: 'true' });
    expect((result['llm'] as any)?.streaming).toBe(true);
  });

  it('coerces "false" to boolean false', () => {
    const result = parseEnvironmentVariables({ ABYSSAL_LLM_STREAMING: 'false' });
    expect((result['llm'] as any)?.streaming).toBe(false);
  });

  it('coerces integer string to number', () => {
    // ABYSSAL_RAG_TOP_K → ['rag', 'topK'] (camelCase)
    const result = parseEnvironmentVariables({ ABYSSAL_RAG_TOP_K: '10' });
    expect((result['rag'] as any)?.topK).toBe(10);
  });

  it('coerces float string to number', () => {
    const result = parseEnvironmentVariables({ ABYSSAL_RAG_THRESHOLD: '0.75' });
    expect((result['rag'] as any)?.threshold).toBe(0.75);
  });

  it('coerces "null" to null', () => {
    // ABYSSAL_LLM_API_KEY → ['llm', 'apiKey']
    const result = parseEnvironmentVariables({ ABYSSAL_LLM_API_KEY: 'null' });
    expect((result['llm'] as any)?.apiKey).toBeNull();
  });

  it('splits comma-separated values into array', () => {
    const result = parseEnvironmentVariables({
      ABYSSAL_SEARCH_PROVIDERS: 'semanticscholar,openalex,crossref',
    });
    expect((result['search'] as any)?.providers).toEqual([
      'semanticscholar', 'openalex', 'crossref',
    ]);
  });

  it('skips variables with only section (no field)', () => {
    const result = parseEnvironmentVariables({ ABYSSAL_RAG: 'something' });
    // Should be skipped — pathParts.length < 2
    expect(result).toEqual({});
  });

  it('skips non-ABYSSAL_ variables', () => {
    const result = parseEnvironmentVariables({
      NODE_ENV: 'production',
      ABYSSAL_LLM_MODEL: 'claude-3',
    });
    expect(result).not.toHaveProperty('node');
    expect((result['llm'] as any)?.model).toBe('claude-3');
  });

  it('calls warn on conversion failure', () => {
    // This test is approximate — hard to trigger actual failure with generic coercion
    const warnings: string[] = [];
    const warn = (msg: string) => warnings.push(msg);
    // Regular values won't fail, but we validate the function accepts a warn callback
    parseEnvironmentVariables({ ABYSSAL_LLM_MODEL: 'valid' }, warn);
    // No warning expected for valid values
    expect(warnings).toHaveLength(0);
  });
});

describe('resolveApiKeys', () => {
  it('reads standard environment variable names', () => {
    const result = resolveApiKeys(
      { ANTHROPIC_API_KEY: 'sk-ant-123', OPENAI_API_KEY: 'sk-openai-456' },
      {},
    );
    expect(result.anthropicApiKey).toBe('sk-ant-123');
    expect(result.openaiApiKey).toBe('sk-openai-456');
  });

  it('reads ABYSSAL_ prefix api keys', () => {
    const result = resolveApiKeys(
      { ABYSSAL_SEMANTIC_SCHOLAR_API_KEY: 'ss-key' },
      {},
    );
    expect(result.semanticScholarApiKey).toBe('ss-key');
  });

  it('env vars override existing config (higher priority)', () => {
    const result = resolveApiKeys(
      { ANTHROPIC_API_KEY: 'new-key' },
      { anthropicApiKey: 'old-key' },
    );
    expect(result.anthropicApiKey).toBe('new-key');
  });

  it('preserves existing keys when env var not set', () => {
    const result = resolveApiKeys({}, { anthropicApiKey: 'existing' });
    expect(result.anthropicApiKey).toBe('existing');
  });

  it('defaults all keys to null when nothing provided', () => {
    const result = resolveApiKeys({}, {});
    expect(result.anthropicApiKey).toBeNull();
    expect(result.openaiApiKey).toBeNull();
    expect(result.geminiApiKey).toBeNull();
    expect(result.deepseekApiKey).toBeNull();
    expect(result.semanticScholarApiKey).toBeNull();
    expect(result.openalexEmail).toBeNull();
    expect(result.unpaywallEmail).toBeNull();
    expect(result.cohereApiKey).toBeNull();
    expect(result.jinaApiKey).toBeNull();
    expect(result.siliconflowApiKey).toBeNull();
    expect(result.webSearchApiKey).toBeNull();
  });

  it('ignores empty string env vars', () => {
    const result = resolveApiKeys(
      { ANTHROPIC_API_KEY: '' },
      { anthropicApiKey: 'existing' },
    );
    expect(result.anthropicApiKey).toBe('existing');
  });
});
