/**
 * IPC 契约类型 — 编译时保证前后端类型一致
 *
 * 每个通道的请求参数和返回类型在此定义。
 * 前端 preload.ts 和后端 ipc-registry.ts 都依赖此契约。
 * 类型不匹配时 tsc 会在编译期报错。
 */

import type { IPC_CHANNELS } from './index';
import type {
  Paper, Concept, ConceptFramework, ConceptMapping,
  Annotation, NewAnnotation, HeatmapMatrix, AffectedMappings,
} from '../models';
import type { PaperFilter } from './index';
import type { ImportResult, PaperCounts } from '../models';

// ═══ IPC Handler 类型映射 ═══

/** 核心 IPC 通道的类型契约 */
export interface IPCHandlerContract {
  // ── Papers ──
  [IPC_CHANNELS.DB_PAPERS_LIST]: {
    args: [filter?: PaperFilter];
    result: Paper[];
  };
  [IPC_CHANNELS.DB_PAPERS_GET]: {
    args: [id: string];
    result: Paper;
  };
  [IPC_CHANNELS.DB_PAPERS_IMPORT_BIBTEX]: {
    args: [content: string];
    result: ImportResult;
  };
  [IPC_CHANNELS.DB_PAPERS_COUNTS]: {
    args: [];
    result: PaperCounts;
  };
  [IPC_CHANNELS.DB_PAPERS_DELETE]: {
    args: [id: string];
    result: void;
  };
  [IPC_CHANNELS.DB_PAPERS_BATCH_DELETE]: {
    args: [ids: string[]];
    result: void;
  };

  // ── Concepts ──
  [IPC_CHANNELS.DB_CONCEPTS_LIST]: {
    args: [];
    result: Concept[];
  };
  [IPC_CHANNELS.DB_CONCEPTS_GET_FRAMEWORK]: {
    args: [];
    result: ConceptFramework;
  };

  // ── Mappings ──
  [IPC_CHANNELS.DB_MAPPINGS_GET_FOR_PAPER]: {
    args: [paperId: string];
    result: ConceptMapping[];
  };
  [IPC_CHANNELS.DB_MAPPINGS_GET_HEATMAP_DATA]: {
    args: [];
    result: HeatmapMatrix;
  };

  // ── Annotations ──
  [IPC_CHANNELS.DB_ANNOTATIONS_LIST_FOR_PAPER]: {
    args: [paperId: string];
    result: Annotation[];
  };
}

/** 从契约提取通道名 */
export type IPCChannel = keyof IPCHandlerContract;

/** 从契约提取参数类型 */
export type IPCArgs<K extends IPCChannel> = IPCHandlerContract[K]['args'];

/** 从契约提取返回类型 */
export type IPCResult<K extends IPCChannel> = IPCHandlerContract[K]['result'];
