/**
 * RetrievalExecutor — searches papers, passages, memos, notes, graph evidence.
 */

import type {
  CopilotOperation,
  EvidenceChunk,
  ExecutionStep,
} from '../types';
import type { OperationEventEmitter } from '../event-emitter';

export interface RetrievalExecutorDeps {
  ragSearch: (query: string, topK?: number) => Promise<Array<{
    chunkId: string;
    paperId: string;
    text: string;
    score: number;
  }>>;
}

export interface RetrievalExecutorResult {
  evidence: EvidenceChunk[];
  query: string;
}

export class RetrievalExecutor {
  private deps: RetrievalExecutorDeps;

  constructor(deps: RetrievalExecutorDeps) {
    this.deps = deps;
  }

  async execute(
    operation: CopilotOperation,
    step: ExecutionStep & { kind: 'retrieve' },
    emitter: OperationEventEmitter,
    signal?: AbortSignal,
  ): Promise<RetrievalExecutorResult> {
    emitter.emit({
      type: 'retrieval.started',
      operationId: operation.id,
      query: step.query,
    });

    if (signal?.aborted) {
      return { evidence: [], query: step.query };
    }

    try {
      const results = await this.deps.ragSearch(step.query, 10);

      const evidence: EvidenceChunk[] = results.map((r) => ({
        chunkId: r.chunkId,
        paperId: r.paperId,
        text: r.text,
        score: r.score,
      }));

      emitter.emit({
        type: 'retrieval.finished',
        operationId: operation.id,
        evidenceCount: evidence.length,
      });

      return { evidence, query: step.query };
    } catch (err) {
      emitter.emit({
        type: 'retrieval.finished',
        operationId: operation.id,
        evidenceCount: 0,
      });

      throw err;
    }
  }
}
