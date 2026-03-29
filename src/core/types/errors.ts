// ═══ 统一错误体系 ═══
//
// 设计原则：
//   1. 类型化判定 — instanceof 是唯一推荐的判定方式
//   2. 可恢复性标记 — recoverable 布尔标记
//   3. 原因链完整 — cause 字段链接原始错误（ES2022）

// ─── 构造器配置对象 ───

export interface AbyssalErrorOptions {
  message: string;
  code: string;
  cause?: Error | undefined;
  context?: Record<string, unknown> | undefined;
  recoverable?: boolean | undefined;
}

// ─── 基类 ───

export class AbyssalError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly timestamp: string;

  constructor(opts: AbyssalErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code;
    this.context = opts.context ?? {};
    this.recoverable = opts.recoverable ?? false;
    this.timestamp = new Date().toISOString();

    // 修正原型链（TypeScript 编译到 ES5 时需要）
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): AbyssalErrorJSON {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }

  /**
   * 跨 Realm 类型判定（IPC / Worker Thread 序列化后 instanceof 失效时使用）。
   * 优先使用 instanceof；仅在跨进程边界时回退到此方法。
   */
  static isAbyssalError(value: unknown): value is AbyssalError {
    if (value instanceof AbyssalError) return true;
    if (
      value !== null &&
      typeof value === 'object' &&
      'code' in value &&
      'recoverable' in value &&
      'timestamp' in value &&
      typeof (value as Record<string, unknown>)['code'] === 'string' &&
      typeof (value as Record<string, unknown>)['recoverable'] === 'boolean'
    ) {
      return true;
    }
    return false;
  }

  /**
   * 从 JSON（IPC / Worker 消息）恢复错误实例。
   * 恢复后的实例支持 instanceof 判定。
   */
  static fromJSON(json: AbyssalErrorJSON): AbyssalError {
    const ErrorClass = ERROR_CLASS_MAP[json.name] ?? AbyssalError;
    return new ErrorClass({
      message: json.message,
      code: json.code,
      context: json.context,
      recoverable: json.recoverable,
    });
  }
}

/** toJSON() 的返回类型，也是 IPC 传输的序列化格式 */
export interface AbyssalErrorJSON {
  name: string;
  code: string;
  message: string;
  context: Record<string, unknown>;
  recoverable: boolean;
  timestamp: string;
  cause: string | undefined;
}

// ═══ 2.3.1 网络错误族 ═══

export class NetworkError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'NETWORK_ERROR',
      recoverable: true,
      ...opts,
    });
  }
}

export class RateLimitedError extends NetworkError {
  readonly retryAfterMs: number;

  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      retryAfterMs?: number | undefined;
    },
  ) {
    super({
      code: 'RATE_LIMITED',
      recoverable: true,
      ...opts,
    });
    this.retryAfterMs = opts.retryAfterMs ?? 60_000;
  }
}

export class ServerError extends NetworkError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'SERVER_ERROR',
      recoverable: true,
      ...opts,
    });
  }
}

export class TimeoutError extends NetworkError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'TIMEOUT',
      recoverable: true,
      ...opts,
    });
  }
}

// ═══ 2.3.2 API 业务错误族 ═══

export class ApiError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'API_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class PaperNotFoundError extends ApiError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'PAPER_NOT_FOUND',
      recoverable: false,
      ...opts,
    });
  }
}

export class AccessDeniedError extends ApiError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'ACCESS_DENIED',
      recoverable: false,
      ...opts,
    });
  }
}

export class QuotaExceededError extends ApiError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'QUOTA_EXCEEDED',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ 2.3.3 处理错误族 ═══

export class ProcessError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'PROCESS_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class PdfCorruptedError extends ProcessError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'PDF_CORRUPTED',
      recoverable: false,
      ...opts,
    });
  }
}

export class OcrFailedError extends ProcessError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'OCR_FAILED',
      recoverable: false,
      ...opts,
    });
  }
}

export class ExtractionEmptyError extends ProcessError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'EXTRACTION_EMPTY',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ 2.3.4 数据库错误族 ═══

export class DatabaseError extends AbyssalError {
  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      context: Record<string, unknown> & { dbPath: string };
    },
  ) {
    super({
      code: 'DATABASE_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class IntegrityError extends DatabaseError {
  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      context: Record<string, unknown> & { dbPath: string };
    },
  ) {
    super({
      code: 'INTEGRITY_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class MigrationError extends DatabaseError {
  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      context: Record<string, unknown> & { dbPath: string };
    },
  ) {
    super({
      code: 'MIGRATION_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class ExtensionLoadError extends DatabaseError {
  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      context: Record<string, unknown> & { dbPath: string };
    },
  ) {
    super({
      code: 'EXTENSION_LOAD_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ 2.3.5 解析错误族 ═══

export class ParseError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'PARSE_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class BibtexParseError extends ParseError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'BIBTEX_PARSE_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class RisParseError extends ParseError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'RIS_PARSE_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class YamlParseError extends ParseError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'YAML_PARSE_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class CslFormatError extends ParseError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'CSL_FORMAT_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ 2.3.6 配置错误 ═══

export class ConfigError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'CONFIG_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class MissingFieldError extends ConfigError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'MISSING_FIELD',
      recoverable: false,
      ...opts,
    });
  }
}

export class ConfigParseError extends ConfigError {
  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      context: Record<string, unknown> & { file: string };
    },
  ) {
    super({
      code: 'CONFIG_PARSE_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

/** Validation entry used by ConfigValidationError */
export interface ValidationEntry {
  level: number;
  severity: 'fatal' | 'error' | 'warning' | 'info';
  field?: string;
  message: string;
  hint?: string;
}

export class ConfigValidationError extends ConfigError {
  readonly errors: ValidationEntry[];
  readonly warnings: ValidationEntry[];

  constructor(errors: ValidationEntry[], warnings: ValidationEntry[]) {
    const summary = errors.map((e) => e.message).join('; ');
    super({
      code: 'CONFIG_VALIDATION_ERROR',
      message: `Configuration validation failed (${errors.length} error(s)): ${summary}`,
      recoverable: false,
      context: { errorCount: errors.length, warningCount: warnings.length },
    });
    this.errors = errors;
    this.warnings = warnings;
  }
}

// ═══ 2.3.6b 概念错误族 ═══

export class ConceptNotFoundError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'CONCEPT_NOT_FOUND',
      recoverable: false,
      ...opts,
    });
  }
}

export class ConceptDeprecatedError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'CONCEPT_DEPRECATED',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ 2.3.7 嵌入错误族 ═══

export class EmbeddingError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'EMBEDDING_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class EmbeddingMigrationError extends EmbeddingError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'EMBEDDING_MIGRATION_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class DimensionMismatchError extends EmbeddingError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'DIMENSION_MISMATCH',
      recoverable: false,
      ...opts,
    });
  }
}

export class ModelLoadError extends EmbeddingError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'MODEL_LOAD_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ 2.3.8 LLM 错误族 ═══

export class LlmClientError extends AbyssalError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'LLM_CLIENT_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class AuthenticationError extends LlmClientError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'AUTHENTICATION_ERROR',
      recoverable: false,
      ...opts,
    });
  }
}

export class ContextOverflowError extends LlmClientError {
  constructor(
    opts: Partial<AbyssalErrorOptions> & {
      message: string;
      context: Record<string, unknown> & { estimatedTokens: number; modelWindow: number };
    },
  ) {
    super({
      code: 'CONTEXT_OVERFLOW',
      recoverable: false,
      ...opts,
    });
  }
}

export class ModelNotAvailableError extends LlmClientError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'MODEL_NOT_AVAILABLE',
      recoverable: true,
      ...opts,
    });
  }
}

export class ContentFilterError extends LlmClientError {
  constructor(opts: Partial<AbyssalErrorOptions> & { message: string }) {
    super({
      code: 'CONTENT_FILTER',
      recoverable: false,
      ...opts,
    });
  }
}

// ═══ fromJSON 反序列化映射表 ═══

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ERROR_CLASS_MAP: Record<string, new (opts: any) => AbyssalError> = {
  AbyssalError,
  NetworkError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  ApiError,
  PaperNotFoundError,
  AccessDeniedError,
  QuotaExceededError,
  ProcessError,
  PdfCorruptedError,
  OcrFailedError,
  ExtractionEmptyError,
  DatabaseError,
  IntegrityError,
  MigrationError,
  ExtensionLoadError,
  ParseError,
  BibtexParseError,
  RisParseError,
  YamlParseError,
  CslFormatError,
  ConfigError,
  MissingFieldError,
  ConfigParseError,
  // ConfigValidationError 省略：其构造器 (errors[], warnings[]) 与标准 (opts) 不兼容，
  // fromJSON 回退到 ConfigError 即可。
  ConceptNotFoundError,
  ConceptDeprecatedError,
  EmbeddingError,
  DimensionMismatchError,
  ModelLoadError,
  EmbeddingMigrationError,
  LlmClientError,
  AuthenticationError,
  ContextOverflowError,
  ModelNotAvailableError,
  ContentFilterError,
};
