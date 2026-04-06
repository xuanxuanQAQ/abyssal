export interface DynamicRagServiceAccessor<T> {
  ragService?: T | null;
  getRagService?: (() => T | null) | undefined;
}

export function resolveCurrentRagService<T>(accessor: DynamicRagServiceAccessor<T>): T | null {
  return accessor.getRagService?.() ?? accessor.ragService ?? null;
}