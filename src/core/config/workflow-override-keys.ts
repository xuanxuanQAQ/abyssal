export const WORKFLOW_OVERRIDE_ALIASES: Record<string, string> = {
  discovery: 'discover',
  analysis: 'analyze',
  generate: 'article',
};

export function normalizeWorkflowOverrideKey(key: string): string {
  return WORKFLOW_OVERRIDE_ALIASES[key] ?? key;
}

export function normalizeWorkflowOverrides<T>(
  overrides: Record<string, T> | undefined,
): Record<string, T> {
  if (!overrides) return {};

  const normalized: Record<string, T> = {};

  for (const [rawKey, value] of Object.entries(overrides)) {
    const canonicalKey = normalizeWorkflowOverrideKey(rawKey);
    const existing = normalized[canonicalKey];
    const currentIsCanonical = canonicalKey === rawKey;

    if (!existing || currentIsCanonical) {
      normalized[canonicalKey] = value;
    }
  }

  return normalized;
}