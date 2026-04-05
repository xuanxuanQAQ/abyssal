// ═══ 配置变更检测与影响分析 ═══
// §七: 配置变更影响矩阵

import type { AbyssalConfig } from '../../types/config';

// ─── 变更检测 ───

export type ChangeSeverity = 'none' | 'info' | 'warning' | 'migration_required';

export interface ConfigChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  severity: ChangeSeverity;
}

export interface ChangeImpact {
  requiresMigration: boolean;
  affectsExistingData: boolean;
  autoMigrable: boolean;
  description: string;
}

// ─── 影响规则 ───

interface ImpactRule {
  pattern: string;
  analyze: (oldVal: unknown, newVal: unknown) => ChangeImpact;
}

const IMPACT_RULES: ImpactRule[] = [
  {
    pattern: 'project.name',
    analyze: () => ({
      requiresMigration: false,
      affectsExistingData: false,
      autoMigrable: true,
      description: 'Only affects log and snapshot identifiers',
    }),
  },
  {
    pattern: 'rag.embeddingModel',
    analyze: () => ({
      requiresMigration: true,
      affectsExistingData: true,
      autoMigrable: false,
      description: 'Requires full re-embedding of all chunks',
    }),
  },
  {
    pattern: 'rag.embeddingDimension',
    analyze: () => ({
      requiresMigration: true,
      affectsExistingData: true,
      autoMigrable: false,
      description: 'Requires DROP + CREATE chunks_vec and full re-embedding',
    }),
  },
  {
    pattern: 'analysis.maxTokensPerChunk',
    analyze: () => ({
      requiresMigration: true,
      affectsExistingData: true,
      autoMigrable: false,
      description: 'Requires re-chunking all papers + re-embedding',
    }),
  },
  {
    pattern: 'analysis.overlapTokens',
    analyze: () => ({
      requiresMigration: true,
      affectsExistingData: true,
      autoMigrable: false,
      description: 'Requires re-chunking all papers + re-embedding',
    }),
  },
  {
    pattern: 'rag.rerankerBackend',
    analyze: () => ({
      requiresMigration: false,
      affectsExistingData: false,
      autoMigrable: true,
      description: 'Affects subsequent re-ranking only',
    }),
  },
  {
    pattern: 'rag.defaultTopK',
    analyze: () => ({
      requiresMigration: false,
      affectsExistingData: false,
      autoMigrable: true,
      description: 'Affects subsequent retrieval only',
    }),
  },
];

// 以下路径前缀无需迁移
const NO_MIGRATION_PREFIXES = [
  'llm.',
  'contextBudget.',
  'conceptChange.',
  'advisory.',
  'batch.',
  'discovery.',
  'acquire.',
  'language.',
  'concepts.',
  'workspace.',
  'apiKeys.',
];

// ─── 检测 ───

/**
 * 深度比较两个配置，返回全部变更。
 */
export function detectConfigChanges(
  oldConfig: AbyssalConfig,
  newConfig: AbyssalConfig,
): ConfigChange[] {
  const changes: ConfigChange[] = [];
  collectChanges(
    oldConfig as unknown as Record<string, unknown>,
    newConfig as unknown as Record<string, unknown>,
    '',
    changes,
  );
  return changes;
}

function collectChanges(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  prefix: string,
  changes: ConfigChange[],
): void {
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (oldVal === newVal) continue;

    if (
      oldVal !== null && newVal !== null &&
      typeof oldVal === 'object' && typeof newVal === 'object' &&
      !Array.isArray(oldVal) && !Array.isArray(newVal)
    ) {
      collectChanges(
        oldVal as Record<string, unknown>,
        newVal as Record<string, unknown>,
        path,
        changes,
      );
    } else if (!deepEqual(oldVal, newVal)) {
      changes.push({
        path,
        oldValue: oldVal,
        newValue: newVal,
        severity: classifySeverity(path),
      });
    }
  }
}

/**
 * 分析单个变更的影响。
 */
export function analyzeChangeImpact(change: ConfigChange): ChangeImpact {
  // 精确匹配
  const rule = IMPACT_RULES.find((r) => r.pattern === change.path);
  if (rule) return rule.analyze(change.oldValue, change.newValue);

  // 前缀匹配——无需迁移的路径
  for (const prefix of NO_MIGRATION_PREFIXES) {
    if (change.path.startsWith(prefix)) {
      return {
        requiresMigration: false,
        affectsExistingData: false,
        autoMigrable: true,
        description: 'Affects subsequent operations only',
      };
    }
  }

  return {
    requiresMigration: false,
    affectsExistingData: false,
    autoMigrable: true,
    description: 'Unknown field — no migration impact expected',
  };
}

/**
 * 批量分析全部变更，返回是否需要迁移。
 */
export function analyzeAllChanges(changes: ConfigChange[]): {
  migrationRequired: boolean;
  migrationChanges: Array<{ change: ConfigChange; impact: ChangeImpact }>;
  safeChanges: Array<{ change: ConfigChange; impact: ChangeImpact }>;
} {
  const migrationChanges: Array<{ change: ConfigChange; impact: ChangeImpact }> = [];
  const safeChanges: Array<{ change: ConfigChange; impact: ChangeImpact }> = [];

  for (const change of changes) {
    const impact = analyzeChangeImpact(change);
    if (impact.requiresMigration) {
      migrationChanges.push({ change, impact });
    } else {
      safeChanges.push({ change, impact });
    }
  }

  return {
    migrationRequired: migrationChanges.length > 0,
    migrationChanges,
    safeChanges,
  };
}

// ─── 工具函数 ───

function classifySeverity(path: string): ChangeSeverity {
  const rule = IMPACT_RULES.find((r) => r.pattern === path);
  if (rule) {
    const impact = rule.analyze(undefined, undefined);
    if (impact.requiresMigration) return 'migration_required';
    return 'info';
  }
  return 'info';
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}
