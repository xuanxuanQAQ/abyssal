// ═══ 启动校验链 ═══
// §二: 十级校验的精确执行顺序

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AbyssalConfig } from '../types/config';
import type { ConceptDefinition } from '../types/concept';
import type { ValidationEntry } from '../types/errors';
import { ConfigValidationError } from '../types/errors';
import type { Logger } from '../infra/logger';
import {
  CONFIG_FIELD_DEFS,
  CROSS_FIELD_CONSTRAINTS,
  getNestedValue,
} from './config-schema';
import { validateConceptFramework, loadConceptsYaml } from './concepts-loader';
import { validateSeeds, loadSeedsYaml } from './seeds-loader';
import { computeFrameworkState, type FrameworkState } from './framework-state';

// ─── 校验选项 ───

export interface ValidateConfigOptions {
  /** 工作区根目录——用于路径可达性检查和 YAML 加载 */
  workspaceRoot?: string;
  /** 是否跳过 Level 8/9（需要数据库连接） */
  skipDatabaseChecks?: boolean;
  /** 数据库维度检查结果（由调用方提供） */
  embeddingCheck?: EmbeddingCheckResult;
  /** 外部提供的概念列表（跳过文件加载） */
  concepts?: ConceptDefinition[];
  logger?: Logger;
}

export interface EmbeddingCheckResult {
  consistent: boolean;
  existingDim?: number;
  configDim?: number;
  existingModel?: string;
  configModel?: string;
  action?: 'embedding_migration_required' | 'embedding_migration_recommended';
  message?: string;
}

// ─── 校验结果 ───

export interface ValidationResult {
  valid: boolean;
  errors: ValidationEntry[];
  warnings: ValidationEntry[];
  frameworkState: FrameworkState;
  concepts: ConceptDefinition[];
}

// ─── 主入口 ───

/**
 * 执行完整的十级配置校验链。
 *
 * Level 1: TOML 语法（在加载阶段已完成）
 * Level 2: 必填字段
 * Level 3: 枚举值范围
 * Level 4: 数值范围 + 关联约束
 * Level 5: 路径可达性
 * Level 6: 概念框架完整性
 * Level 7: 种子论文格式
 * Level 8: 嵌入维度一致性
 * Level 9: Reranker 模型可用性
 * Level 10: frameworkState 推导
 */
export function validateConfig(
  config: AbyssalConfig,
  opts: ValidateConfigOptions = {},
): ValidationResult {
  const errors: ValidationEntry[] = [];
  const warnings: ValidationEntry[] = [];
  const logger = opts.logger;

  // Level 1: TOML 语法——已在 ConfigLoader 阶段完成
  logger?.info('  Level 1: TOML syntax — PASS (checked during load)');

  // Level 2: 必填字段
  validateRequiredFields(config, errors);
  logger?.info('  Level 2: Required fields — ' + (hasErrorsAtLevel(errors, 2) ? 'FAIL' : 'PASS'));

  // Level 3: 枚举值范围
  validateEnumValues(config, errors);
  logger?.info('  Level 3: Enum values — ' + (hasErrorsAtLevel(errors, 3) ? 'FAIL' : 'PASS'));

  // Level 4: 数值范围 + 关联约束
  validateNumericRanges(config, errors);
  validateCrossFieldConstraints(config, errors);
  logger?.info('  Level 4: Numeric ranges — ' + (hasErrorsAtLevel(errors, 4) ? 'FAIL' : 'PASS'));

  // Level 5: 路径可达性
  if (opts.workspaceRoot) {
    validatePaths(config, opts.workspaceRoot, errors, warnings);
    logger?.info('  Level 5: Path accessibility — ' + (hasErrorsAtLevel(errors, 5) ? 'FAIL' : 'PASS'));
  }

  // Level 6: 概念框架完整性
  let concepts: ConceptDefinition[] = opts.concepts ?? [];
  if (!opts.concepts && opts.workspaceRoot) {
    const conceptsPath = path.join(opts.workspaceRoot, 'config', 'concepts.yaml');
    const altPath = path.join(opts.workspaceRoot, '.abyssal', 'concepts.yaml');
    const loadPath = fs.existsSync(conceptsPath)
      ? conceptsPath
      : fs.existsSync(altPath)
        ? altPath
        : null;
    if (loadPath) {
      concepts = loadConceptsYaml(loadPath);
    }
  }
  const conceptResult = validateConceptFramework(concepts);
  for (const e of conceptResult.errors) {
    errors.push({ level: 6, severity: 'error', message: e });
  }
  for (const w of conceptResult.warnings) {
    warnings.push({ level: 6, severity: 'warning', message: w });
  }
  logger?.info(
    `  Level 6: Concept framework — ` +
    (hasErrorsAtLevel(errors, 6) ? 'FAIL' : 'PASS') +
    ` (${concepts.length} concepts, ${conceptResult.errors.length} errors)`,
  );

  // Level 7: 种子论文格式
  if (opts.workspaceRoot) {
    const seedsPath = path.join(opts.workspaceRoot, 'config', 'seeds.yaml');
    const altSeedsPath = path.join(opts.workspaceRoot, '.abyssal', 'seeds.yaml');
    const loadSeedsPath = fs.existsSync(seedsPath)
      ? seedsPath
      : fs.existsSync(altSeedsPath)
        ? altSeedsPath
        : null;
    if (loadSeedsPath) {
      const seeds = loadSeedsYaml(loadSeedsPath);
      const seedResult = validateSeeds(seeds);
      for (const e of seedResult.errors) {
        errors.push({ level: 7, severity: 'error', message: e });
      }
      for (const w of seedResult.warnings) {
        warnings.push({ level: 7, severity: 'warning', message: w });
      }
      logger?.info(
        `  Level 7: Seeds — ` +
        (hasErrorsAtLevel(errors, 7) ? 'FAIL' : 'PASS') +
        ` (${seeds.length} seeds, ${seedResult.errors.length} errors)`,
      );
    } else {
      logger?.info('  Level 7: Seeds — SKIP (no seeds.yaml found)');
    }
  }

  // Level 8: 嵌入维度一致性
  if (!opts.skipDatabaseChecks && opts.embeddingCheck) {
    validateEmbeddingConsistency(opts.embeddingCheck, errors, warnings);
    logger?.info(
      `  Level 8: Embedding consistency — ` +
      (hasErrorsAtLevel(errors, 8) ? 'FAIL' : 'PASS') +
      ` (${config.rag.embeddingDimension}D, ${config.rag.embeddingModel})`,
    );
  } else {
    logger?.info('  Level 8: Embedding consistency — SKIP');
  }

  // Level 9: Reranker 模型可用性
  validateReranker(config, errors, warnings);
  logger?.info('  Level 9: Reranker availability — ' + (hasErrorsAtLevel(errors, 9) ? 'FAIL' : 'PASS'));

  // Level 10: frameworkState 推导
  const frameworkState = computeFrameworkState(concepts);
  const stats = {
    tentative: concepts.filter((c) => !c.deprecated && (c.maturity ?? 'working') === 'tentative').length,
    working: concepts.filter((c) => !c.deprecated && (c.maturity ?? 'working') === 'working').length,
    established: concepts.filter((c) => !c.deprecated && (c.maturity ?? 'working') === 'established').length,
  };
  logger?.info(
    `  Level 10: Framework state — ${frameworkState} ` +
    `(${concepts.length} concepts: ${stats.tentative}t/${stats.working}w/${stats.established}e)`,
  );
  warnings.push({
    level: 10,
    severity: 'info',
    message: `Framework state computed: ${frameworkState}`,
  });

  // 输出汇总
  const fatalErrors = errors.filter((e) => e.severity === 'fatal' || e.severity === 'error');
  const valid = fatalErrors.length === 0;

  logger?.info(
    `Configuration validation completed (${fatalErrors.length} errors, ${warnings.length} warnings)`,
  );

  if (!valid) {
    throw new ConfigValidationError(fatalErrors, warnings);
  }

  return { valid, errors: fatalErrors, warnings, frameworkState, concepts };
}

// ─── Level 2: 必填字段 ───

function validateRequiredFields(
  config: AbyssalConfig,
  errors: ValidationEntry[],
): void {
  const configObj = config as unknown as Record<string, unknown>;

  for (const [fieldPath, def] of Object.entries(CONFIG_FIELD_DEFS)) {
    if (!def.required) continue;

    const value = getNestedValue(configObj, fieldPath);

    if (value === null || value === undefined || value === '') {
      errors.push({
        level: 2,
        severity: 'error',
        field: fieldPath,
        message: `Missing required config field: ${fieldPath}`,
      });
    }
  }

  // 条件必填——仅在需要时才校验（延迟检查）
  for (const [fieldPath, def] of Object.entries(CONFIG_FIELD_DEFS)) {
    if (!def.requiredWhen) continue;
    if (!def.requiredWhen(configObj)) continue;

    const value = getNestedValue(configObj, fieldPath);
    if (value === null || value === undefined || value === '') {
      errors.push({
        level: 2,
        severity: 'error',
        field: fieldPath,
        message: `Conditional required field missing: ${fieldPath}`,
        hint: `This field is required given the current configuration`,
      });
    }
  }
}

// ─── Level 3: 枚举值范围 ───

function validateEnumValues(
  config: AbyssalConfig,
  errors: ValidationEntry[],
): void {
  const configObj = config as unknown as Record<string, unknown>;

  for (const [fieldPath, def] of Object.entries(CONFIG_FIELD_DEFS)) {
    if (def.type !== 'enum' || !def.constraints?.enum) continue;

    const value = getNestedValue(configObj, fieldPath);
    if (value === null || value === undefined) continue;

    if (!def.constraints.enum.includes(value as string)) {
      errors.push({
        level: 3,
        severity: 'error',
        field: fieldPath,
        message: `Invalid enum value for ${fieldPath}: "${value}"`,
        hint: `Allowed: ${def.constraints.enum.join(', ')}`,
      });
    }
  }
}

// ─── Level 4: 数值范围 ───

function validateNumericRanges(
  config: AbyssalConfig,
  errors: ValidationEntry[],
): void {
  const configObj = config as unknown as Record<string, unknown>;

  for (const [fieldPath, def] of Object.entries(CONFIG_FIELD_DEFS)) {
    if (def.type !== 'integer' && def.type !== 'float') continue;
    if (!def.constraints) continue;

    const value = getNestedValue(configObj, fieldPath);
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number') continue;

    const { min, max } = def.constraints;

    if (min !== undefined && value < min) {
      errors.push({
        level: 4,
        severity: 'error',
        field: fieldPath,
        message: `${fieldPath} (${value}) is below minimum (${min})`,
      });
    }

    if (max !== undefined && value > max) {
      errors.push({
        level: 4,
        severity: 'error',
        field: fieldPath,
        message: `${fieldPath} (${value}) exceeds maximum (${max})`,
      });
    }
  }
}

function validateCrossFieldConstraints(
  config: AbyssalConfig,
  errors: ValidationEntry[],
): void {
  const configObj = config as unknown as Record<string, unknown>;

  for (const constraint of CROSS_FIELD_CONSTRAINTS) {
    const violation = constraint.validate(configObj);
    if (violation) {
      errors.push({
        level: 4,
        severity: 'error',
        message: violation,
        hint: constraint.description,
      });
    }
  }
}

// ─── Level 5: 路径可达性 ───

function validatePaths(
  config: AbyssalConfig,
  workspaceRoot: string,
  errors: ValidationEntry[],
  warnings: ValidationEntry[],
): void {
  // 工作区根目录
  if (!fs.existsSync(workspaceRoot)) {
    try {
      fs.mkdirSync(workspaceRoot, { recursive: true });
    } catch {
      errors.push({
        level: 5,
        severity: 'fatal',
        field: 'workspace.baseDir',
        message: `Cannot create workspace directory: ${workspaceRoot}`,
      });
      return;
    }
  }

  // 可写性测试
  const testFile = path.join(workspaceRoot, '.write_test_' + Date.now());
  try {
    fs.writeFileSync(testFile, '', 'utf-8');
    fs.unlinkSync(testFile);
  } catch {
    errors.push({
      level: 5,
      severity: 'fatal',
      field: 'workspace.baseDir',
      message: `Workspace directory is not writable: ${workspaceRoot}`,
    });
    return;
  }

  // 子目录结构——不存在则创建
  const subdirs = ['pdfs', 'texts', 'analyses', 'drafts', 'decisions', 'articles', 'notes', 'reports'];
  for (const sub of subdirs) {
    const fullPath = path.join(workspaceRoot, sub);
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
      } catch {
        warnings.push({
          level: 5,
          severity: 'warning',
          message: `Cannot create subdirectory: ${fullPath}`,
        });
      }
    }
  }

  // .abyssal 内部目录
  const internalDirs = ['.abyssal', '.abyssal/snapshots', '.abyssal/logs'];
  for (const sub of internalDirs) {
    const fullPath = path.join(workspaceRoot, sub);
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
      } catch {
        warnings.push({
          level: 5,
          severity: 'warning',
          message: `Cannot create internal directory: ${fullPath}`,
        });
      }
    }
  }
}

// ─── Level 8: 嵌入维度一致性 ───

function validateEmbeddingConsistency(
  check: EmbeddingCheckResult,
  errors: ValidationEntry[],
  warnings: ValidationEntry[],
): void {
  if (check.consistent) return;

  if (check.action === 'embedding_migration_required') {
    errors.push({
      level: 8,
      severity: 'fatal',
      field: 'rag.embeddingDimension',
      message: check.message ?? `Embedding dimension mismatch: DB=${check.existingDim}, config=${check.configDim}`,
      hint: 'Run embedding migration to rebuild vector index',
    });
  } else if (check.action === 'embedding_migration_recommended') {
    warnings.push({
      level: 8,
      severity: 'warning',
      field: 'rag.embeddingModel',
      message: check.message ?? `Embedding model changed: DB="${check.existingModel}", config="${check.configModel}"`,
      hint: 'Vector search results may be inaccurate. Consider running embedding migration.',
    });
  }
}

// ─── Level 9: Reranker ───

function validateReranker(
  config: AbyssalConfig,
  errors: ValidationEntry[],
  _warnings: ValidationEntry[],
): void {
  const backend = config.rag.rerankerBackend;

  if (backend === 'cohere') {
    if (!config.apiKeys.cohereApiKey) {
      errors.push({
        level: 9,
        severity: 'error',
        field: 'apiKeys.cohereApiKey',
        message: 'Cohere reranker requires API key (apiKeys.cohereApiKey)',
      });
    }
    return;
  }

  if (backend === 'jina') {
    if (!config.apiKeys.jinaApiKey) {
      errors.push({
        level: 9,
        severity: 'error',
        field: 'apiKeys.jinaApiKey',
        message: 'Jina reranker requires API key (apiKeys.jinaApiKey)',
      });
    }
    return;
  }

  if (backend === 'siliconflow') {
    if (!config.apiKeys.siliconflowApiKey) {
      errors.push({
        level: 9,
        severity: 'error',
        field: 'apiKeys.siliconflowApiKey',
        message: 'SiliconFlow reranker requires API key (apiKeys.siliconflowApiKey)',
      });
    }
    return;
  }
}

// ─── 工具函数 ───

function hasErrorsAtLevel(errors: ValidationEntry[], level: number): boolean {
  return errors.some((e) => e.level === level);
}
