// ═══ LogLevel ═══

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ═══ Logger 接口 ═══

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void;
}

// ═══ ConsoleLogger ═══

export class ConsoleLogger implements Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVEL_SEVERITY[level];
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.minLevel > LEVEL_SEVERITY.debug) return;
    this.write('debug', message, undefined, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.minLevel > LEVEL_SEVERITY.info) return;
    this.write('info', message, undefined, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.minLevel > LEVEL_SEVERITY.warn) return;
    this.write('warn', message, undefined, context);
  }

  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void {
    this.write('error', message, error, context);
  }

  private write(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString();
    const ctxStr =
      context && Object.keys(context).length > 0
        ? ' ' + JSON.stringify(context)
        : '';
    const errStr = error ? ` [${error.name}: ${error.message}]` : '';
    process.stderr.write(
      `${ts} [${level.toUpperCase()}] ${message}${errStr}${ctxStr}\n`,
    );
  }
}

// ═══ FileLogger ═══

// TODO: FileLogger 依赖 Node.js fs 和 WorkspaceConfig.logsDir
//       完整实现需在 Electron 主进程初始化阶段创建
//       此处提供接口兼容的实现骨架

export class FileLogger implements Logger {
  private readonly minLevel: number;
  private readonly logDir: string;
  private readonly _fs: typeof import('node:fs');
  private readonly _path: typeof import('node:path');
  private readonly _mirrorToConsole: boolean;

  constructor(logDir: string, level: LogLevel = 'info', mirrorToConsole = false) {
    this.logDir = logDir;
    this.minLevel = LEVEL_SEVERITY[level];
    this._mirrorToConsole = mirrorToConsole;
    this._fs = require('node:fs');
    this._path = require('node:path');
    try {
      this._fs.mkdirSync(this.logDir, { recursive: true });
    } catch { /* ignore — writeLine will fallback to stderr */ }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.minLevel > LEVEL_SEVERITY.debug) return;
    this.writeLine('debug', message, undefined, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.minLevel > LEVEL_SEVERITY.info) return;
    this.writeLine('info', message, undefined, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.minLevel > LEVEL_SEVERITY.warn) return;
    this.writeLine('warn', message, undefined, context);
  }

  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void {
    this.writeLine('error', message, error, context);
  }

  private writeLine(
    level: LogLevel,
    msg: string,
    error?: Error,
    ctx?: Record<string, unknown>,
  ): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(error ? { err: error.message } : {}),
      ...(ctx && Object.keys(ctx).length > 0 ? { ctx } : {}),
    });

    // Mirror to console in dev mode so logs are visible in DevTools / terminal
    if (this._mirrorToConsole) {
      /* eslint-disable no-console */
      const consoleFn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
        : level === 'debug' ? console.debug
        : console.log;
      /* eslint-enable no-console */
      const errStr = error ? ` [${error.name}: ${error.message}]` : '';
      const ctxStr = ctx && Object.keys(ctx).length > 0 ? ' ' + JSON.stringify(ctx) : '';
      consoleFn(`[${level.toUpperCase()}] ${msg}${errStr}${ctxStr}`);
    }

    try {
      const date = new Date().toISOString().slice(0, 10);
      const filePath = this._path.join(this.logDir, `abyssal-${date}.log`);
      this._fs.appendFileSync(filePath, line + '\n', 'utf-8');
    } catch {
      // 日志写入失败不应中断业务流程，降级到 stderr
      process.stderr.write(line + '\n');
    }
  }

  /** 启动时清理过期日志（保留最近 30 天） */
  cleanupOldLogs(): void {
    try {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const files = this._fs.readdirSync(this.logDir) as string[];
      for (const f of files) {
        if (!f.startsWith('abyssal-') || !f.endsWith('.log')) continue;
        const filePath = this._path.join(this.logDir, f);
        const stat = this._fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          this._fs.unlinkSync(filePath);
        }
      }
    } catch {
      // 清理失败不影响启动
    }
  }
}

// ═══ NullLogger ═══

export class NullLogger implements Logger {
  debug(): void {
    /* 静默 */
  }
  info(): void {
    /* 静默 */
  }
  warn(): void {
    /* 静默 */
  }
  error(): void {
    /* 静默 */
  }
}
