// ═══ 工作区文件操作工具 ═══
// §5.2: tryDelete / tryDeleteDir — 容错删除
// §9.2: atomicWrite — 临时文件 + 原子重命名
// §9.3: cleanTmpFiles — 启动时清理 .tmp 残留
// §2.13: moveToOrphaned — 孤儿文件移动到 _orphaned/

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '../infra/logger';

// ─── §5.2 容错删除 ───

/**
 * 容错删除文件——删除失败仅 warn 不抛异常。
 *
 * 用于 deletePaper 事务成功后的文件清理：
 * 数据库事务已提交，文件删除失败不应回滚事务。
 * 残留文件将被下次 checkIntegrity 检测为孤儿。
 */
export function tryDelete(absolutePath: string, logger?: Logger): void {
  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      logger?.debug('File deleted', { path: absolutePath });
    }
  } catch (err) {
    logger?.warn('File deletion failed', {
      path: absolutePath,
      error: (err as Error).message,
    });
  }
}

/**
 * 容错删除目录及其全部内容。
 * 用于删除 figures/{paperId}/ 等按论文分组的子目录。
 */
export function tryDeleteDir(absolutePath: string, logger?: Logger): void {
  try {
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
      logger?.debug('Directory deleted', { path: absolutePath });
    }
  } catch (err) {
    logger?.warn('Directory deletion failed', {
      path: absolutePath,
      error: (err as Error).message,
    });
  }
}

// ─── §9.2 原子文件写入 ───

/**
 * 原子文件写入——"临时文件 + 原子重命名"模式。
 *
 * fs.renameSync 在同一文件系统内是原子操作——不存在"文件半写入"中间状态。
 * 如果写入过程中断（崩溃/断电），.tmp 文件残留——由 cleanTmpFiles 清理。
 */
export function atomicWrite(
  targetPath: string,
  content: string | Buffer,
  logger?: Logger,
): void {
  const tmpPath = targetPath + '.tmp';
  const encoding = typeof content === 'string' ? 'utf-8' : undefined;

  // 确保目标目录存在
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  // 写入临时文件
  fs.writeFileSync(tmpPath, content, encoding as BufferEncoding | undefined);

  // 如果目标文件已存在，先删除（renameSync 在 Windows 上不覆盖已有文件）
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }

  // 原子重命名
  fs.renameSync(tmpPath, targetPath);
  logger?.debug('File written atomically', { path: targetPath });
}

// ─── §9.3 .tmp 文件清理 ───

/**
 * 启动时递归清理 workspace/ 下的 *.tmp 残留文件。
 * 它们是上次异常退出时未完成的写入操作的产物。
 *
 * 排除目录：.abyssal/（数据库文件等不应被清理）、node_modules/
 */
export function cleanTmpFiles(
  rootDir: string,
  logger?: Logger,
): number {
  let cleaned = 0;

  function scan(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录不可读——跳过
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // 跳过内部目录和 node_modules
        if (entry.name === '.abyssal' || entry.name === 'node_modules') continue;
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.tmp')) {
        try {
          fs.unlinkSync(fullPath);
          cleaned++;
        } catch {
          // 删除失败——忽略
        }
      }
    }
  }

  scan(rootDir);

  if (cleaned > 0) {
    logger?.info('Cleaned residual temp files', { count: cleaned });
  }

  return cleaned;
}

// ─── §2.13 孤儿文件移动 ───

/**
 * 将孤儿文件移动到 _orphaned/ 对应子目录。
 *
 * 目录结构镜像原始位置：
 *   pdfs/a1b2c3d4e5f6.pdf → _orphaned/pdfs/a1b2c3d4e5f6.pdf
 *
 * C4 约束：物理文件不自动删除——移动到 _orphaned/ 供研究者确认。
 */
export function moveToOrphaned(
  srcAbsPath: string,
  workspaceRoot: string,
  logger?: Logger,
): void {
  const relativePath = path.relative(workspaceRoot, srcAbsPath);
  const orphanedPath = path.join(workspaceRoot, '_orphaned', relativePath);

  // 确保目标目录存在
  fs.mkdirSync(path.dirname(orphanedPath), { recursive: true });

  try {
    fs.renameSync(srcAbsPath, orphanedPath);
    logger?.info('Orphaned file moved', { from: relativePath, to: `_orphaned/${relativePath}` });
  } catch (err) {
    logger?.warn('Failed to move orphaned file', {
      from: srcAbsPath,
      error: (err as Error).message,
    });
  }
}

/**
 * 将孤儿目录移动到 _orphaned/。
 * 用于 figures/{paperId}/ 等按论文分组的子目录。
 */
export function moveDirToOrphaned(
  srcAbsPath: string,
  workspaceRoot: string,
  logger?: Logger,
): void {
  const relativePath = path.relative(workspaceRoot, srcAbsPath);
  const orphanedPath = path.join(workspaceRoot, '_orphaned', relativePath);

  fs.mkdirSync(path.dirname(orphanedPath), { recursive: true });

  try {
    fs.renameSync(srcAbsPath, orphanedPath);
    logger?.info('Orphaned directory moved', { from: relativePath });
  } catch (err) {
    logger?.warn('Failed to move orphaned directory', {
      from: srcAbsPath,
      error: (err as Error).message,
    });
  }
}
