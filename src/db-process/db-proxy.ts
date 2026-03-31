/**
 * DbProxy — 主进程中的数据库代理
 *
 * 通过 ES6 Proxy 自动将任意方法调用转发到 DB 子进程。
 * 无需手动枚举 DatabaseService 的 60+ 方法——新增方法自动可用。
 *
 * 设计要点：
 * - 所有方法返回 Promise（原 DatabaseService 是同步 API）
 * - Float32Array 参数自动编码为 { __type: 'Float32Array', data: [] }
 * - 请求超时 30 秒（可配置）
 * - 子进程崩溃自动重启
 */

import { fork, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import type {
  DbRequest, DbResponse, DbLifecycleResponse,
  DbInitPayload,
} from './protocol';
import { isLifecycleResponse } from './protocol';
import type { AsyncDbService } from '../core/types/db-service';

export type DbHealthStatus = 'connected' | 'degraded' | 'disconnected';

export interface DbProxyOptions {
  /** DB 子进程入口脚本路径 */
  dbProcessPath?: string;
  /** 系统 Node.js 可执行文件路径（非 Electron 的 Node.js） */
  nodePath?: string;
  /** RPC 调用超时（毫秒），默认 30000 */
  timeoutMs?: number;
  /** Called after each health check with the current status */
  onHealthStatus?: (status: DbHealthStatus) => void;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** DbProxy 自身的实例方法名——不转发到子进程 */
const OWN_METHODS = new Set([
  'start', 'close', 'switchWorkspace',
  // 内部方法（private，但 Proxy get 仍能看到）
  'spawnChild', 'setupMessageHandler', 'handleChildCrash',
  'sendLifecycle', 'call',
]);

/**
 * 创建 DbProxy 实例。
 *
 * 返回的对象是一个 ES6 Proxy：
 * - 访问 DbProxy 自身的方法（start/close/switchWorkspace）→ 直接调用
 * - 访问其他任意属性名（如 addPaper/queryPapers）→ 自动转发到子进程 RPC
 *
 * 这消除了手动维护 60+ 方法镜像的需要。
 */
export function createDbProxy(options: DbProxyOptions = {}): DbProxyInstance {
  const proxy = new DbProxy(options);
  return new Proxy(proxy, {
    get(target, prop, receiver) {
      // symbol / 内部属性 / 自身方法 → 直接返回
      if (typeof prop !== 'string' || OWN_METHODS.has(prop) || prop.startsWith('_')) {
        return Reflect.get(target, prop, receiver);
      }
      // 已有属性（private fields, constructor, etc.）→ 直接返回
      const existing = Reflect.get(target, prop, receiver);
      if (existing !== undefined) {
        return existing;
      }
      // 未知属性 → RPC 转发
      return (...args: unknown[]) => target.call(prop, ...args);
    },
  }) as unknown as DbProxyInstance;
}

/**
 * DbProxy 的对外类型——AsyncDbService 提供编译期方法签名检查，
 * 同时保留 DbProxy 自身的 start/close/switchWorkspace 方法。
 */
export type DbProxyInstance = AsyncDbService & Pick<DbProxy, 'start' | 'close' | 'switchWorkspace'>;

export class DbProxy {
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingCall>();
  private lifecyclePending: {
    resolve: (value: DbLifecycleResponse) => void;
    reject: (error: Error) => void;
  } | null = null;

  private readonly dbProcessPath: string;
  private readonly nodePath: string;
  private readonly timeoutMs: number;
  private readonly onHealthStatus: ((status: DbHealthStatus) => void) | undefined;
  private initPayload: DbInitPayload | null = null;
  private closed = false;

  constructor(options: DbProxyOptions = {}) {
    this.dbProcessPath = options.dbProcessPath
      ?? path.resolve(__dirname, 'main.js');
    this.nodePath = options.nodePath
      ?? process.env['ABYSSAL_NODE_PATH']
      ?? 'node';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.onHealthStatus = options.onHealthStatus;
  }

  // ─── 子进程管理 ───

  async start(payload: DbInitPayload): Promise<void> {
    this.initPayload = payload;
    this.closed = false;
    await this.spawnChild();
    const resp = await this.sendLifecycle('init', payload);
    if (!resp.success) {
      throw new Error(`DB init failed: ${resp.error}`);
    }
    this.startHealthCheck();
  }

  private spawnChild(): Promise<void> {
    if (this.child) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      this.child = fork(this.dbProcessPath, [], {
        execPath: this.nodePath,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env },
      });

      // Forward subprocess stderr to main process for debugging
      if (this.child.stderr) {
        this.child.stderr.on('data', (data: Buffer) => {
          const text = data.toString().trim();
          if (text) console.error(`[db-subprocess] ${text}`);
        });
      }

      const onFirstMessage = (msg: unknown) => {
        const resp = msg as DbLifecycleResponse;
        if (resp?.type === 'lifecycle' && resp.action === 'ready') {
          this.child!.removeListener('message', onFirstMessage);
          this.setupMessageHandler();
          settle(() => resolve());
        }
      };
      this.child.on('message', onFirstMessage);

      this.child.on('error', (err) => {
        settle(() => reject(err));
        this.handleChildCrash(err);
      });

      this.child.on('exit', (code, signal) => {
        if (!this.closed) {
          const err = new Error(`DB subprocess exited unexpectedly: code=${code}, signal=${signal}`);
          settle(() => reject(err));
          this.handleChildCrash(err);
        }
        this.child = null;
      });

      setTimeout(() => {
        settle(() => reject(new Error('DB subprocess start timeout (10s)')));
      }, 10_000);
    });
  }

  private setupMessageHandler(): void {
    if (!this.child) return;

    this.child.on('message', (msg: unknown) => {
      if (isLifecycleResponse(msg)) {
        if (this.lifecyclePending) {
          const p = this.lifecyclePending;
          this.lifecyclePending = null;
          p.resolve(msg as DbLifecycleResponse);
        }
        return;
      }

      const resp = msg as DbResponse;
      if (resp?.id) {
        const p = this.pending.get(resp.id);
        if (!p) return;
        this.pending.delete(resp.id);
        clearTimeout(p.timer);

        if (resp.error) {
          const err = Object.assign(
            new Error(resp.error.message),
            { code: resp.error.code, name: resp.error.name, ...(resp.error.context ? { context: resp.error.context } : {}) },
          );
          p.reject(err);
        } else {
          p.resolve(resp.result);
        }
      }
    });
  }

  private handleChildCrash(err: Error): void {
    // 立即同步地 reject 所有待处理请求并清理 timers
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`DB subprocess crashed: ${err.message}`));
    }
    this.pending.clear();

    if (this.lifecyclePending) {
      this.lifecyclePending.reject(err);
      this.lifecyclePending = null;
    }

    this.child = null;

    // 异步重启（fire-and-forget，后续调用会等待新进程）
    if (!this.closed && this.initPayload) {
      const payload = this.initPayload;
      // 延迟 500ms 重启，避免频繁 crash 循环
      setTimeout(async () => {
        if (this.closed || this.child) return;
        try {
          await this.spawnChild();
          await this.sendLifecycle('init', payload);
        } catch {
          // 重启失败——后续 call() 会收到 'DB subprocess not running'
        }
      }, 500);
    }
  }

  // ─── 生命周期 IPC ───

  private sendLifecycle(
    action: 'init' | 'switch' | 'close',
    payload?: DbInitPayload,
  ): Promise<DbLifecycleResponse> {
    if (!this.child) {
      return Promise.reject(new Error('DB subprocess not running'));
    }

    return new Promise((resolve, reject) => {
      this.lifecyclePending = { resolve, reject };

      const msg = { type: 'lifecycle' as const, action, ...(payload ? { payload } : {}) };
      this.child!.send(msg);

      const timer = setTimeout(() => {
        if (this.lifecyclePending) {
          this.lifecyclePending = null;
          reject(new Error(`Lifecycle ${action} timeout`));
        }
      }, this.timeoutMs);

      // 确保 timer 不阻止进程退出
      if (timer.unref) timer.unref();
    });
  }

  async switchWorkspace(payload: DbInitPayload): Promise<void> {
    this.initPayload = payload;
    if (!this.child) {
      await this.start(payload);
      return;
    }
    const resp = await this.sendLifecycle('switch', payload);
    if (!resp.success) {
      throw new Error(`Workspace switch failed: ${resp.error}`);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopHealthCheck();
    if (!this.child) return;

    try {
      await this.sendLifecycle('close');
    } catch {
      // 子进程可能已退出
    }

    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  // ─── Health check (ping/pong) ───

  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private static readonly HEALTH_CHECK_INTERVAL = 30_000; // 30s
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  /** Start periodic health checks. Call after start(). */
  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.consecutiveFailures = 0;
    this.healthCheckTimer = setInterval(() => {
      void this.ping();
    }, DbProxy.HEALTH_CHECK_INTERVAL);
    if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /** Send a lightweight ping to verify subprocess is responsive. */
  private async ping(): Promise<void> {
    if (this.closed || !this.child) {
      this.onHealthStatus?.('disconnected');
      return;
    }
    try {
      // Use getStats() as a lightweight health probe
      await this.call('getStats');
      this.consecutiveFailures = 0;
      this.onHealthStatus?.(this.consecutiveFailures === 0 ? 'connected' : 'degraded');
    } catch {
      this.consecutiveFailures++;
      const status: DbHealthStatus =
        this.consecutiveFailures >= DbProxy.MAX_CONSECUTIVE_FAILURES ? 'disconnected' : 'degraded';
      this.onHealthStatus?.(status);
      if (this.consecutiveFailures >= DbProxy.MAX_CONSECUTIVE_FAILURES) {
        // Force restart — subprocess is unresponsive
        this.consecutiveFailures = 0;
        if (this.child) {
          this.child.kill('SIGKILL');
          this.child = null;
          // handleChildCrash will trigger auto-restart
        }
      }
    }
  }

  // ─── RPC 调用（由 Proxy 或直接调用） ───

  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('DbProxy is closed'));
    }
    if (!this.child) {
      return Promise.reject(new Error('DB subprocess not running'));
    }

    const id = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      const serializedArgs = args.map(serializeArg);
      const request: DbRequest = { id, method, args: serializedArgs };
      this.child!.send(request);
    });
  }
}

// ─── 参数序列化 ───

function serializeArg(value: unknown): unknown {
  if (value instanceof Float32Array) {
    return { __type: 'Float32Array', data: Array.from(value) };
  }
  if (Array.isArray(value)) {
    return value.map(serializeArg);
  }
  return value;
}
