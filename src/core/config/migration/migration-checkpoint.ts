// ═══ 断点续传检查点管理 ═══
// §4.4: .migration_checkpoint.json 文件管理

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Checkpoint 接口 ───

export interface MigrationCheckpoint {
  type: 'embedding_migration';
  startedAt: string;
  lastProcessedRowid: number;
  totalChunks: number;
  config: {
    newModel: string;
    newDim: number;
  };
}

const CHECKPOINT_FILENAME = '.migration_checkpoint.json';

// ─── 加载 ───

/**
 * 加载已有检查点，不存在则创建新的。
 */
export function loadOrCreateCheckpoint(
  workspaceDir: string,
  totalChunks: number,
  newModel: string,
  newDim: number,
): MigrationCheckpoint {
  const existing = loadCheckpoint(workspaceDir);
  if (existing) return existing;

  const checkpoint: MigrationCheckpoint = {
    type: 'embedding_migration',
    startedAt: new Date().toISOString(),
    lastProcessedRowid: 0,
    totalChunks,
    config: { newModel, newDim },
  };

  saveCheckpoint(workspaceDir, checkpoint);
  return checkpoint;
}

/**
 * 加载已有检查点，不存在返回 null。
 */
export function loadCheckpoint(workspaceDir: string): MigrationCheckpoint | null {
  const filePath = path.join(workspaceDir, CHECKPOINT_FILENAME);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as MigrationCheckpoint;
  } catch {
    return null;
  }
}

// ─── 保存 ───

export function saveCheckpoint(
  workspaceDir: string,
  checkpoint: MigrationCheckpoint,
): void {
  const filePath = path.join(workspaceDir, CHECKPOINT_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

// ─── 删除 ───

export function deleteCheckpoint(workspaceDir: string): void {
  const filePath = path.join(workspaceDir, CHECKPOINT_FILENAME);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ─── 未完成迁移检测 ───

/**
 * 启动时检测未完成的迁移。
 *
 * - 如果检查点存在且与当前配置一致，返回检查点用于续传
 * - 如果配置已变（模型不同），废弃旧检查点，返回 null
 */
export function detectPendingMigration(
  workspaceDir: string,
  currentModel: string,
  currentDim: number,
): MigrationCheckpoint | null {
  const checkpoint = loadCheckpoint(workspaceDir);
  if (!checkpoint) return null;

  // 配置又变了——废弃旧检查点
  if (
    checkpoint.config.newModel !== currentModel ||
    checkpoint.config.newDim !== currentDim
  ) {
    deleteCheckpoint(workspaceDir);
    return null;
  }

  return checkpoint;
}
