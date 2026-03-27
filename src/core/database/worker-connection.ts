// ═══ Worker Thread 连接管理 ═══
// §4.2-4.4: Worker Thread 独立连接工厂 + SharedArrayBuffer 向量传递协议
//
// 设计决策 (§4.4)：
// - 嵌入器和数据库写入在同一个 Worker Thread 中执行——避免跨 Worker 数据传递
// - Worker Thread 持有 ONNX 模型和数据库连接两个资源
// - 主线程需要嵌入结果时通过 SharedArrayBuffer 传递

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import { openDatabase } from './connection';

// ─── §4.3 Worker 连接工厂 ───

export interface OpenWorkerConnectionOptions {
  dbPath: string;
  config: AbyssalConfig;
  logger: Logger;
  /** 跳过 sqlite-vec 加载 */
  skipVecExtension?: boolean | undefined;
}

/**
 * 为 Worker Thread 创建独立的数据库连接。
 *
 * 初始化序列与主线程相同（openDatabase）但：
 * - 不执行 Schema 迁移——迁移由主线程在 Worker 启动前完成
 * - 不创建文件锁——主线程已持有锁
 * - 不预编译语句——Worker 有自己的语句集
 *
 * §4.1: better-sqlite3 的 Database 对象在 C++ 层持有 sqlite3* 指针，
 *       V8 isolate 边界禁止跨线程共享——每个线程必须独立打开连接。
 */
export function openWorkerConnection(
  options: OpenWorkerConnectionOptions,
): Database.Database {
  const { dbPath, config, logger, skipVecExtension } = options;

  const db = openDatabase({
    dbPath,
    config,
    logger,
    readOnly: false,
    skipVecExtension,
  });

  logger.info('Worker database connection opened', { dbPath });
  return db;
}

/**
 * 关闭 Worker 连接。
 * Worker 完成当前事务后调用此函数释放资源。
 */
export function closeWorkerConnection(
  db: Database.Database,
  logger: Logger,
): void {
  try {
    db.close();
    logger.info('Worker database connection closed');
  } catch (err) {
    logger.warn('Worker connection close error', {
      error: (err as Error).message,
    });
  }
}

// ─── §4.4 SharedArrayBuffer 向量传递协议 ───

/**
 * 计算向量传递所需的 SharedArrayBuffer 参数。
 *
 * SharedArrayBuffer 在主线程分配一次，通过
 * new Worker(path, { workerData: { sab } }) 传递给 Worker。
 *
 * @param maxBatchSize - 单批次最大向量数（默认 64）
 * @param dimension    - 嵌入维度（默认 1536）
 */
export function computeVectorBufferParams(
  maxBatchSize: number = 64,
  dimension: number = 1536,
): VectorBufferParams {
  const bytesPerFloat = 4; // Float32
  const singleVectorBytes = dimension * bytesPerFloat;
  const totalBytes = maxBatchSize * singleVectorBytes;

  return {
    bufferSize: totalBytes,
    singleVectorBytes,
    dimension,
    maxBatchSize,
  };
}

export interface VectorBufferParams {
  /** SharedArrayBuffer 总大小（字节） */
  bufferSize: number;
  /** 单个向量的字节大小 */
  singleVectorBytes: number;
  /** 嵌入维度 */
  dimension: number;
  /** 最大批量大小 */
  maxBatchSize: number;
}

/**
 * Fix #4: SharedArrayBuffer 的 Atomics 标志位协议。
 *
 * 在多核弱内存模型下，Worker 写入 SAB 的数据可能还在 CPU L1/L2 缓存中，
 * 主线程读取可能看到旧数据。虽然 postMessage 在 V8 实现中会触发隐式内存屏障，
 * 但显式使用 Atomics 是更 defensive 的做法。
 *
 * 协议：
 * - SAB 末尾保留 4 字节作为 Int32 标志位（READY_FLAG_OFFSET）
 * - Worker 写完所有向量后，执行 Atomics.store(flag, 0, vectorCount) + Atomics.notify
 * - 主线程收到 postMessage 后，执行 Atomics.load(flag, 0) 读取 vectorCount，
 *   此操作强制 CPU 刷新缓存行，确保后续 Float32Array 读取的一致性
 */

/** SAB 中标志位相对于末尾的偏移（字节） */
const READY_FLAG_BYTES = 4;

/**
 * 计算 SAB 总大小，包含末尾 4 字节 Atomics 标志位。
 */
export function computeVectorBufferParamsWithFlag(
  maxBatchSize: number = 64,
  dimension: number = 1536,
): VectorBufferParams {
  const base = computeVectorBufferParams(maxBatchSize, dimension);
  return {
    ...base,
    // 总大小 = 向量区域 + 4 字节标志位，对齐到 4 字节边界
    bufferSize: base.bufferSize + READY_FLAG_BYTES,
  };
}

/**
 * 获取 SAB 中 Atomics 标志位的 Int32Array 视图。
 */
function getFlagView(sab: SharedArrayBuffer): Int32Array {
  // 标志位在 SAB 最末尾 4 字节
  const flagOffset = sab.byteLength - READY_FLAG_BYTES;
  return new Int32Array(sab, flagOffset, 1);
}

/**
 * 从 SharedArrayBuffer 中读取第 i 个向量。
 *
 * @param sab       - 共享内存
 * @param index     - 向量索引（0-based）
 * @param dimension - 嵌入维度
 */
export function readVectorFromBuffer(
  sab: SharedArrayBuffer,
  index: number,
  dimension: number,
): Float32Array {
  const offset = index * dimension * 4;
  return new Float32Array(sab, offset, dimension);
}

/**
 * 将向量写入 SharedArrayBuffer 的第 i 个位置。
 *
 * @param sab       - 共享内存
 * @param index     - 向量索引（0-based）
 * @param vector    - 源向量数据
 * @param dimension - 嵌入维度
 */
export function writeVectorToBuffer(
  sab: SharedArrayBuffer,
  index: number,
  vector: Float32Array,
  dimension: number,
): void {
  const target = new Float32Array(sab, index * dimension * 4, dimension);
  target.set(vector);
}

/**
 * Worker 端：写完所有向量后调用，设置标志位并触发内存屏障。
 * Atomics.store 保证之前所有写入对其他线程可见。
 */
export function signalVectorsReady(
  sab: SharedArrayBuffer,
  vectorCount: number,
): void {
  const flag = getFlagView(sab);
  Atomics.store(flag, 0, vectorCount);
  Atomics.notify(flag, 0);
}

/**
 * 主线程端：读取向量前调用，触发内存屏障确保缓存一致性。
 * 返回 Worker 写入的向量数量。
 */
export function waitVectorsReady(
  sab: SharedArrayBuffer,
): number {
  const flag = getFlagView(sab);
  return Atomics.load(flag, 0);
}

/**
 * 重置标志位（主线程读取完毕后调用，为下一批准备）。
 */
export function resetVectorFlag(
  sab: SharedArrayBuffer,
): void {
  const flag = getFlagView(sab);
  Atomics.store(flag, 0, 0);
}

// ─── Worker 消息协议 ───

// TODO: Worker Thread 启动与生命周期管理（postMessage 协议）由 Orchestrator 编排层实现
// TODO: ONNX 推理 + DB 写入在同一 Worker 中执行的集成，依赖嵌入器模块

/** 主线程 → Worker 的消息类型 */
export type MainToWorkerMessage =
  | { type: 'embed'; texts: string[]; rowids: number[] }
  | { type: 'shutdown' };

/** Worker → 主线程的消息类型 */
export type WorkerToMainMessage =
  | { type: 'ready'; vectorCount: number }
  | { type: 'error'; message: string }
  | { type: 'shutdown_complete' };
