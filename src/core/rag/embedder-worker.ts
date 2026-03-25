// ═══ ONNX 嵌入 Worker Thread ═══
// §1.3: 在独立 Worker 中运行 @huggingface/transformers ONNX 推理
//
// 此文件作为 Worker Thread 脚本执行。
// 主线程通过 postMessage 发送文本，Worker 推理后将结果写入 SharedArrayBuffer。
//
// TODO: Worker Thread 路径在 Electron 打包后可能需要调整（__dirname 变化）

import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('embedder-worker.ts must be run as a Worker Thread');
}

// ─── 类型 ───

interface InitMessage {
  type: 'init';
  modelId: string;
  localModelPath: string | null;
  dimension: number;
}

interface EmbedMessage {
  type: 'embed';
  texts: string[];
  batchId: number;
  /** 每次 embed 携带独立的 SAB，避免并发覆写 */
  sharedBuffer: SharedArrayBuffer;
}

interface TerminateMessage {
  type: 'terminate';
}

type WorkerMessage = InitMessage | EmbedMessage | TerminateMessage;

// ─── 状态 ───

let pipeline: ((texts: string[], opts?: { pooling?: string; normalize?: boolean }) => Promise<{ tolist(): number[][] }>) | null = null;
let dimension = 0;

// ─── L2 归一化 ───

function l2Normalize(vec: number[]): Float32Array {
  const result = new Float32Array(vec.length);
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < 1e-12) {
    for (let i = 0; i < vec.length; i++) result[i] = vec[i]!;
    return result;
  }
  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i]! / norm;
  }
  return result;
}

// ─── 消息处理 ───

parentPort.on('message', async (msg: WorkerMessage) => {
  switch (msg.type) {
    case 'init': {
      dimension = msg.dimension;

      try {
        const { pipeline: createPipeline } = await import('@huggingface/transformers');
        const modelSource = msg.localModelPath ?? msg.modelId;
        const pipe = await createPipeline('feature-extraction', modelSource, {
          dtype: 'fp32',
        });
        pipeline = pipe as unknown as typeof pipeline;
        parentPort!.postMessage({ type: 'ready' });
      } catch (err) {
        parentPort!.postMessage({
          type: 'error',
          message: `Model load failed: ${(err as Error).message}`,
        });
      }
      break;
    }

    case 'embed': {
      if (!pipeline) {
        parentPort!.postMessage({
          type: 'error',
          message: 'Worker not initialized',
          batchId: msg.batchId,
        });
        return;
      }

      try {
        const BATCH = 64;
        // 每次 embed 使用消息携带的独立 SAB（Fix #2: 防止并发覆写）
        const view = new Float32Array(msg.sharedBuffer);

        let outputIdx = 0;
        for (let i = 0; i < msg.texts.length; i += BATCH) {
          const batch = msg.texts.slice(i, i + BATCH);
          const output = await pipeline(batch, {
            pooling: 'mean',
            normalize: true,
          });
          const embeddings = output.tolist();

          for (const emb of embeddings) {
            const normalized = l2Normalize(emb);
            const offset = outputIdx * dimension;
            view.set(normalized, offset);
            outputIdx++;
          }
        }

        parentPort!.postMessage({ type: 'done', batchId: msg.batchId, count: outputIdx });
      } catch (err) {
        parentPort!.postMessage({
          type: 'error',
          message: `Embed failed: ${(err as Error).message}`,
          batchId: msg.batchId,
        });
      }
      break;
    }

    case 'terminate': {
      process.exit(0);
    }
  }
});
