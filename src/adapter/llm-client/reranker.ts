/**
 * Reranker scheduler — unified interface routing to API or Local ONNX backend.
 *
 * - API backends: delegates to existing src/core/rag/reranker.ts (Cohere/Jina)
 * - Local ONNX: communicates with reranker-worker.ts via Worker Thread
 * - 'none': returns candidates unchanged (no reranking)
 *
 * Graceful degradation: if reranker fails, falls back to vector score ordering.
 *
 * See spec: section 6 — Reranker Scheduler
 */

import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import type { RagConfig, ApiKeysConfig } from '../../core/types/config';
import type { Logger } from '../../core/infra/logger';
import { Reranker as CoreReranker } from '../../core/rag/reranker';
import type { RankedChunk } from '../../core/types/chunk';

// ─── Unified reranker interface ───

export interface RerankResult {
  id: string;
  score: number;
}

// ─── Worker message types ───

interface WorkerRerankResult {
  type: 'rerank_result';
  requestId: string;
  scores: number[];
}

interface WorkerError {
  type: 'error';
  requestId?: string;
  message: string;
}

interface WorkerReady {
  type: 'ready';
}

type WorkerResponse = WorkerRerankResult | WorkerError | WorkerReady;

// ─── Reranker Scheduler ───

export class RerankerScheduler {
  private readonly backend: RagConfig['rerankerBackend'] | 'none';
  private readonly logger: Logger;
  private readonly coreReranker: CoreReranker | null;
  private worker: Worker | null = null;
  private workerReady = false;
  private readonly pendingRequests = new Map<string, {
    resolve: (scores: number[]) => void;
    reject: (err: Error) => void;
  }>();

  constructor(
    config: RagConfig,
    apiKeys: ApiKeysConfig,
    logger: Logger,
  ) {
    this.backend = config.rerankerBackend ?? 'none';
    this.logger = logger;

    // Initialize core reranker for API backends
    if (this.backend === 'api-cohere' || this.backend === 'api-jina') {
      this.coreReranker = new CoreReranker(config, {
        cohereApiKey: apiKeys.cohereApiKey,
        jinaApiKey: apiKeys.jinaApiKey,
      }, logger);
    } else {
      this.coreReranker = null;
    }
  }

  /**
   * Start the Local ONNX Worker Thread (if backend is 'local-bge').
   * Call during bootstrap. Returns a promise that resolves when model is loaded.
   */
  async startWorker(modelPath?: string): Promise<void> {
    if (this.backend !== 'local-bge') return;

    const workerPath = path.resolve(__dirname, 'reranker-worker.js');
    this.worker = new Worker(workerPath, {
      workerData: { modelPath: modelPath ?? 'BAAI/bge-reranker-v2-m3' },
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Reranker worker failed to start within 30s'));
      }, 30_000);

      this.worker!.on('message', (msg: WorkerResponse) => {
        if (msg.type === 'ready') {
          this.workerReady = true;
          clearTimeout(timeout);
          this.logger.info('Local ONNX reranker ready');
          resolve();
        } else if (msg.type === 'rerank_result') {
          const pending = this.pendingRequests.get(msg.requestId);
          if (pending) {
            pending.resolve(msg.scores);
            this.pendingRequests.delete(msg.requestId);
          }
        } else if (msg.type === 'error') {
          if (msg.requestId) {
            const pending = this.pendingRequests.get(msg.requestId);
            if (pending) {
              pending.reject(new Error(msg.message));
              this.pendingRequests.delete(msg.requestId);
            }
          } else {
            this.logger.error('Reranker worker error', new Error(msg.message));
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        }
      });

      this.worker!.on('error', (err) => {
        this.logger.error('Reranker worker crashed', err);
        this.workerReady = false;
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Rerank candidates using the configured backend.
   *
   * Returns candidates sorted by relevance score (descending), limited to topK.
   * On failure, falls back to vector score ordering (§6.5).
   */
  async rerank(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    if (candidates.length === 0) return [];
    if (candidates.length <= topK || this.backend === 'none') {
      return candidates.slice(0, topK);
    }

    try {
      if (this.backend === 'api-cohere' || this.backend === 'api-jina') {
        return await this.rerankViaApi(query, candidates, topK);
      }
      if (this.backend === 'local-bge') {
        return await this.rerankViaWorker(query, candidates, topK);
      }
    } catch (err) {
      // §6.5: Graceful degradation — fall back to vector score ordering
      this.logger.warn('Reranker failed, falling back to vector score', {
        backend: this.backend,
        error: (err as Error).message,
      });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ─── API reranking (delegates to core Reranker) ───

  private async rerankViaApi(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    if (!this.coreReranker) throw new Error('API reranker not initialized');
    return await this.coreReranker.rerank(query, candidates, topK);
  }

  // ─── Local ONNX reranking via Worker Thread ───

  private async rerankViaWorker(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    if (!this.worker || !this.workerReady) {
      throw new Error('Local reranker worker not ready');
    }

    const requestId = crypto.randomUUID();
    const documents = candidates.map((c) => c.text);

    const scores = await new Promise<number[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Reranker worker timeout (30s)'));
      }, 30_000);

      this.pendingRequests.set(requestId, {
        resolve: (s) => { clearTimeout(timeout); resolve(s); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      this.worker!.postMessage({
        type: 'rerank',
        requestId,
        query,
        documents,
        topK,
      });
    });

    // Map scores back to candidates, sort by score desc, take topK
    const scored = candidates.map((c, i) => ({ ...c, score: scores[i] ?? 0 }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  // ─── Lifecycle ───

  async terminate(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: 'shutdown' });
      await new Promise<void>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.worker?.terminate();
          resolve();
        }, 5000);
        this.worker!.once('exit', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer); // Cancel the 5s timeout on normal exit
          resolve();
        });
      });
      this.worker = null;
      this.workerReady = false;
    }
  }
}
