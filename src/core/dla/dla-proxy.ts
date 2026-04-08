/**
 * DlaProxy — 主进程中的 DLA 子进程代理。
 *
 * 设计与 db-proxy.ts 同构：
 * - child_process.fork() 启动 DLA 子进程
 * - 生命周期管理（init / shutdown）
 * - RPC 消息发送 + 回调匹配
 * - 崩溃自动重启
 *
 * 与 DbProxy 的关键区别：
 * - detect 请求返回多条流式结果（每页一条），而非单个响应
 * - 使用 EventEmitter 模式通知每页完成
 */

import { fork, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  DlaProcessMessage,
  DlaProcessResponse,
  DlaDetectResult,
  DlaDetectProgress,
  DlaDetectError,
  ContentBlock,
} from './types';
import { isDlaLifecycleResponse } from './types';

export interface DlaProxyOptions {
  /** DLA 子进程入口脚本路径 */
  dlaProcessPath: string;
  /** ONNX 模型文件路径 */
  modelPath: string;
  /** Execution provider: 'cpu' | 'dml' */
  executionProvider?: string;
}

export interface PageAnalysisEvent {
  pageIndex: number;
  blocks: ContentBlock[];
  inferenceMs: number;
}

type LifecyclePending = {
  resolve: (value: void) => void;
  reject: (error: Error) => void;
};

/**
 * DLA subprocess proxy.
 *
 * Events:
 * - 'page': Emitted when a page analysis completes
 * - 'progress': Emitted with { completed, total }
 * - 'error': Emitted on per-page or subprocess errors
 */
export class DlaProxy extends EventEmitter {
  private child: ChildProcess | null = null;
  private opts: DlaProxyOptions;
  private lifecyclePending: LifecyclePending | null = null;
  private _initialized = false;
  private _starting = false;
  /** Track active detect request IDs so we can reject them on crash */
  private pendingDetectIds = new Set<string>();

  constructor(opts: DlaProxyOptions) {
    super();
    this.opts = opts;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /** Spawn the subprocess and initialize the ONNX session */
  async start(): Promise<void> {
    if (this._initialized || this._starting) return;
    this._starting = true;

    // eslint-disable-next-line no-console
    console.log('[DLA-Proxy] Starting subprocess…', { modelPath: this.opts.modelPath });
    try {
      this.spawnChild();
      await this.sendLifecycle('init', {
        modelPath: this.opts.modelPath,
        executionProvider: this.opts.executionProvider,
      });
      this._initialized = true;
      // eslint-disable-next-line no-console
      console.log('[DLA-Proxy] Subprocess initialized successfully');
      this.emit('ready');
    } catch (err) {
      console.error('[DLA-Proxy] Subprocess init failed:', (err as Error).message);
      throw err;
    } finally {
      this._starting = false;
    }
  }

  /** Gracefully shut down the subprocess */
  async shutdown(): Promise<void> {
    if (!this.child) return;

    try {
      await this.sendLifecycle('shutdown');
    } catch {
      // Force kill if graceful shutdown fails
      this.child?.kill('SIGTERM');
    }

    this.child = null;
    this._initialized = false;
  }

  /**
   * Request DLA analysis for specific pages.
   *
   * Results are emitted as 'page' events (one per page).
   * Returns a promise that resolves when all pages are done.
   */
  async detect(pdfPath: string, pageIndices: number[], targetSize?: number): Promise<void> {
    if (!this._initialized || !this.child) {
      throw new Error('DLA proxy not initialized');
    }

    const id = crypto.randomUUID();
    // eslint-disable-next-line no-console
    console.log(`[DLA-Proxy] detect request ${id}: pages=[${pageIndices.join(',')}]`);

    return new Promise<void>((resolve, reject) => {
      this.pendingDetectIds.add(id);

      const cleanup = () => {
        this.pendingDetectIds.delete(id);
        this.removeListener(`detect:done:${id}`, onDone);
        this.removeListener(`detect:fatal:${id}`, onFatal);
      };

      const onDone = () => { cleanup(); resolve(); };
      const onFatal = (err: Error) => { cleanup(); reject(err); };

      this.once(`detect:done:${id}`, onDone);
      this.once(`detect:fatal:${id}`, onFatal);

      const msg: DlaProcessMessage = {
        id,
        type: 'detect',
        pdfPath,
        pageIndices,
        ...(targetSize !== undefined && { targetSize }),
      };

      this.child!.send(msg);
    });
  }

  // ─── Internal ───

  private spawnChild(): void {
    this.child = fork(this.opts.dlaProcessPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    });

    this.child.on('message', (msg: DlaProcessResponse) => this.handleMessage(msg));
    this.child.on('exit', (code) => this.handleExit(code));
    this.child.on('error', (err) => this.emit('error', err));
  }

  private handleMessage(msg: DlaProcessResponse): void {
    if (isDlaLifecycleResponse(msg)) {
      if (this.lifecyclePending) {
        if (msg.success) {
          this.lifecyclePending.resolve();
        } else {
          this.lifecyclePending.reject(new Error(msg.error ?? 'DLA lifecycle failed'));
        }
        this.lifecyclePending = null;
      }
      return;
    }

    switch (msg.type) {
      case 'detect:result': {
        const result = msg as DlaDetectResult;
        // eslint-disable-next-line no-console
        console.log(`[DLA-Proxy] Page ${result.pageIndex} done: ${result.blocks.length} blocks in ${result.inferenceMs}ms`);
        this.emit('page', {
          pageIndex: result.pageIndex,
          blocks: result.blocks,
          inferenceMs: result.inferenceMs,
        } satisfies PageAnalysisEvent);
        break;
      }

      case 'detect:progress': {
        const progress = msg as DlaDetectProgress;
        this.emit('progress', { completed: progress.completed, total: progress.total });
        // If all pages done, signal completion
        if (progress.completed >= progress.total) {
          // eslint-disable-next-line no-console
          console.log(`[DLA-Proxy] Detect batch ${msg.id} complete (${progress.total} pages)`);
          this.emit(`detect:done:${msg.id}`);
        }
        break;
      }

      case 'detect:error': {
        const err = msg as DlaDetectError;
        console.warn(`[DLA-Proxy] Page ${err.pageIndex} error: ${err.message}`);
        this.emit('error', new Error(`DLA page ${err.pageIndex}: ${err.message}`));
        break;
      }
    }
  }

  private handleExit(code: number | null): void {
    this._initialized = false;
    this.child = null;

    console.warn(`[DLA-Proxy] Subprocess exited with code ${code}`);

    // Reject any pending lifecycle operation
    if (this.lifecyclePending) {
      this.lifecyclePending.reject(new Error(`DLA subprocess exited unexpectedly (code ${code})`));
      this.lifecyclePending = null;
    }

    // Reject all pending detect promises so callers don't hang forever
    const crashError = new Error(`DLA subprocess crashed (exit code ${code})`);
    for (const id of this.pendingDetectIds) {
      this.emit(`detect:fatal:${id}`, crashError);
    }
    this.pendingDetectIds.clear();

    if (code !== 0 && code !== null) {
      this.emit('error', crashError);
    }
  }

  private sendLifecycle(action: string, payload?: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error('DLA subprocess not running'));
        return;
      }

      this.lifecyclePending = { resolve, reject };

      const timeoutId = setTimeout(() => {
        if (this.lifecyclePending) {
          this.lifecyclePending.reject(new Error(`DLA lifecycle '${action}' timed out`));
          this.lifecyclePending = null;
        }
      }, 30_000);

      const original = this.lifecyclePending;
      this.lifecyclePending = {
        resolve: () => { clearTimeout(timeoutId); original.resolve(); },
        reject: (err) => { clearTimeout(timeoutId); original.reject(err); },
      };

      this.child.send({ type: 'lifecycle', action, payload });
    });
  }
}
