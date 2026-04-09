import { fork, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

import type { AbyssalConfig } from '../core/types/config';
import type { RagDiagnosticsSummary, RagServiceLike } from '../core/rag';
import type { RankedChunk, TextChunk } from '../core/types/chunk';
import type { RetrievalRequest, RetrievalResult } from '../core/types/retrieval';
import type { IndexResult } from '../core/rag';
import type {
  RagInitPayload,
  RagLifecycleRequest,
  RagLifecycleResponse,
  RagRequest,
  RagResponse,
  RagRuntimeState,
} from '../rag-process/protocol';
import { isRagLifecycleResponse } from '../rag-process/protocol';

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface RagProxyOptions {
  ragProcessPath?: string;
  nodePath?: string;
  timeoutMs?: number;
}

export interface ManagedRagService extends RagServiceLike {
  start(payload: RagInitPayload): Promise<void>;
  updateConfig(config: AbyssalConfig): Promise<void>;
  close(): Promise<void>;
}

export function createRagProcessProxy(options: RagProxyOptions = {}): ManagedRagService {
  return new RagProcessProxy(options);
}

class RagProcessProxy implements ManagedRagService {
  private child: ChildProcess | null = null;
  private readonly ragProcessPath: string;
  private readonly nodePath: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingCall>();
  private lifecyclePending: {
    resolve: (value: RagLifecycleResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private closed = false;

  degraded = false;
  degradedReason: string | null = null;

  constructor(options: RagProxyOptions) {
    this.ragProcessPath = options.ragProcessPath ?? path.resolve(__dirname, '..', 'rag-process', 'main.js');
    const isElectronPackaged = !!process.versions['electron'] && !(process as unknown as { defaultApp?: boolean }).defaultApp;
    this.nodePath = options.nodePath ?? process.env['ABYSSAL_NODE_PATH'] ?? (isElectronPackaged ? process.execPath : 'node');
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async start(payload: RagInitPayload): Promise<void> {
    this.closed = false;
    await this.spawnChild();
    const response = await this.sendLifecycle({
      type: 'lifecycle',
      action: 'init',
      payload,
    });
    if (!response.success) {
      throw new Error(response.error ?? 'RAG init failed');
    }
    this.applyState(response.state);
  }

  async updateConfig(config: AbyssalConfig): Promise<void> {
    const response = await this.sendLifecycle({
      type: 'lifecycle',
      action: 'update-config',
      payload: { config },
    });
    if (!response.success) {
      throw new Error(response.error ?? 'RAG config update failed');
    }
    this.applyState(response.state);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (!this.child) return;

    try {
      await this.sendLifecycle({ type: 'lifecycle', action: 'close' });
    } catch {
      // ignore shutdown handshake failures
    }

    this.child.kill('SIGTERM');
    this.child = null;
  }

  async embedAndIndexChunks(chunks: TextChunk[]): Promise<IndexResult> {
    return this.call('embedAndIndexChunks', chunks) as Promise<IndexResult>;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    return this.call('retrieve', request) as Promise<RetrievalResult>;
  }

  async searchSemantic(
    queryText: string,
    topK: number = 10,
    filters?: Parameters<RagServiceLike['searchSemantic']>[2],
  ): Promise<RankedChunk[]> {
    return this.call('searchSemantic', queryText, topK, filters) as Promise<RankedChunk[]>;
  }

  async getDiagnosticsSummary(): Promise<RagDiagnosticsSummary> {
    const result = await this.call('getDiagnosticsSummary') as RagDiagnosticsSummary;
    this.degraded = result.degraded;
    this.degradedReason = result.degradedReason;
    return result;
  }

  private applyState(state?: RagRuntimeState): void {
    if (!state) return;
    this.degraded = state.degraded;
    this.degradedReason = state.degradedReason;
  }

  private async spawnChild(): Promise<void> {
    if (this.child) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      this.child = fork(this.ragProcessPath, [], {
        execPath: this.nodePath,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          ...(this.nodePath === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        },
      });

      if (this.child.stdout) {
        this.child.stdout.on('data', (data: Buffer) => {
          const text = data.toString().trim();
          // eslint-disable-next-line no-console
          if (text) console.log(`[rag-subprocess] ${text}`);
        });
      }
      if (this.child.stderr) {
        this.child.stderr.on('data', (data: Buffer) => {
          const text = data.toString().trim();
          if (text) console.error(`[rag-subprocess] ${text}`);
        });
      }

      const onFirstMessage = (message: unknown) => {
        if (!isRagLifecycleResponse(message) || message.action !== 'ready') return;
        this.child?.removeListener('message', onFirstMessage);
        this.setupMessageHandler();
        this.applyState(message.state);
        settle(() => resolve());
      };

      this.child.on('message', onFirstMessage);
      this.child.on('error', (err) => {
        settle(() => reject(err));
        this.handleChildExit(err);
      });
      this.child.on('exit', (code, signal) => {
        if (!this.closed) {
          settle(() => reject(new Error(`RAG subprocess exited unexpectedly: code=${code}, signal=${signal}`)));
          this.handleChildExit(new Error(`RAG subprocess exited unexpectedly: code=${code}, signal=${signal}`));
        }
        this.child = null;
      });

      const timer = setTimeout(() => {
        settle(() => reject(new Error('RAG subprocess start timeout (10s)')));
      }, 10_000);
      if (timer.unref) timer.unref();
    });
  }

  private setupMessageHandler(): void {
    if (!this.child) return;

    this.child.on('message', (message: unknown) => {
      if (isRagLifecycleResponse(message)) {
        if (this.lifecyclePending) {
          clearTimeout(this.lifecyclePending.timer);
          const pending = this.lifecyclePending;
          this.lifecyclePending = null;
          this.applyState(message.state);
          pending.resolve(message);
        }
        return;
      }

      const response = message as RagResponse;
      if (!response?.id) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);

      if (response.error) {
        pending.reject(Object.assign(new Error(response.error.message), { name: response.error.name }));
      } else {
        pending.resolve(response.result);
      }
    });
  }

  private handleChildExit(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`RAG subprocess crashed: ${err.message}`));
    }
    this.pending.clear();

    if (this.lifecyclePending) {
      clearTimeout(this.lifecyclePending.timer);
      this.lifecyclePending.reject(err);
      this.lifecyclePending = null;
    }

    this.child = null;
  }

  private sendLifecycle(request: RagLifecycleRequest): Promise<RagLifecycleResponse> {
    if (!this.child) {
      return Promise.reject(new Error('RAG subprocess not running'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.lifecyclePending) return;
        this.lifecyclePending = null;
        reject(new Error(`RAG lifecycle ${request.action} timeout`));
      }, this.timeoutMs);
      if (timer.unref) timer.unref();

      this.lifecyclePending = { resolve, reject, timer };
      this.child!.send(request);
    });
  }

  private call(method: RagRequest['method'], ...args: unknown[]): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error('RAG subprocess not running'));
    }

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RAG call timeout: ${method}`));
      }, this.timeoutMs);
      if (timer.unref) timer.unref();

      this.pending.set(id, { resolve, reject, timer });
      this.child!.send({ id, method, args } satisfies RagRequest);
    });
  }
}