/**
 * Local ONNX Reranker Worker Thread script.
 *
 * Runs BGE-reranker-v2-m3 (INT8 quantized) in a Worker Thread.
 * Receives (query, documents[]) pairs, returns relevance scores.
 *
 * Communication protocol:
 *   Main → Worker: { type: 'rerank', requestId, query, documents, topK }
 *   Worker → Main: { type: 'rerank_result', requestId, scores }
 *   Worker → Main: { type: 'ready' }
 *   Worker → Main: { type: 'error', requestId?, message }
 *   Main → Worker: { type: 'shutdown' }
 *
 * See spec: section 6.3 — Local ONNX Reranker Worker Thread
 */

import { parentPort, workerData } from 'node:worker_threads';

// ─── Types ───

interface RerankRequest {
  type: 'rerank';
  requestId: string;
  query: string;
  documents: string[];
  topK: number;
}

interface ShutdownRequest {
  type: 'shutdown';
}

type WorkerMessage = RerankRequest | ShutdownRequest;

// ─── Sigmoid normalization ───

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ─── Model loading ───

let pipeline: any = null;
let isReady = false;

async function loadModel(): Promise<void> {
  try {
    // @huggingface/transformers provides pipeline() for ONNX inference
    const { pipeline: createPipeline } = await import('@huggingface/transformers');

    const modelPath = (workerData as Record<string, unknown>)?.['modelPath'] as string | undefined
      ?? 'BAAI/bge-reranker-v2-m3';

    pipeline = await createPipeline('text-classification', modelPath, {
      quantized: true, // INT8 quantized — half size, < 1% accuracy loss
    } as Record<string, unknown>);

    isReady = true;
    parentPort?.postMessage({ type: 'ready' });
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      message: `Model load failed: ${(err as Error).message}`,
    });
  }
}

// ─── Rerank handler ───

async function handleRerank(req: RerankRequest): Promise<void> {
  if (!isReady || !pipeline) {
    parentPort?.postMessage({
      type: 'error',
      requestId: req.requestId,
      message: 'Reranker model not loaded',
    });
    return;
  }

  try {
    const pairs = req.documents.map((doc) => [req.query, doc]);
    const allLogits: number[] = [];

    // Batch processing: max 32 pairs per batch (WASM memory limit)
    const BATCH_SIZE = 32;
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const results = await pipeline(batch, {
        padding: true,
        truncation: true,
        max_length: 512, // Cross-encoder limit: [CLS] query [SEP] doc [SEP]
      });

      for (const r of results as Array<{ score: number }>) {
        allLogits.push(r.score);
      }
    }

    // Sigmoid normalization: logit → [0, 1] relevance score
    const scores = allLogits.map(sigmoid);

    parentPort?.postMessage({
      type: 'rerank_result',
      requestId: req.requestId,
      scores,
    });
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      requestId: req.requestId,
      message: `Rerank failed: ${(err as Error).message}`,
    });
  }
}

// ─── Message handler ───

parentPort?.on('message', (msg: WorkerMessage) => {
  if (msg.type === 'rerank') {
    handleRerank(msg);
  } else if (msg.type === 'shutdown') {
    process.exit(0);
  }
});

// ─── Start ───

loadModel();
