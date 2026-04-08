// ═══ 文件系统完整性检查 ═══
// §4.1: 双向检查——引用断裂（DB→文件）+ 孤儿检测（文件→DB）
// §4.1.3: 笔记 mtime 一致性检测
// §8.2: 磁盘空间统计

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { PaperId, NoteId } from '../types/common';
import type { PathResolver } from '../infra/path-resolver';
import type { Logger } from '../infra/logger';
import { isInternalDbNoteFilePath } from '../database/note-file-path';

// ─── §4.2 FilesystemIntegrityReport ───

export interface FilesystemIntegrityReport {
  // 引用断裂（DB 有引用但文件缺失）
  missingPdfs: PaperId[];
  missingTexts: PaperId[];
  missingAnalyses: PaperId[];
  missingNoteFiles: NoteId[];

  // 孤儿文件（文件存在但 DB 无引用）
  orphanedPdfs: string[];
  orphanedTexts: string[];
  orphanedAnalyses: string[];
  orphanedNoteFiles: string[];
  orphanedFigureDirs: string[];

  // 笔记同步
  staleNoteChunks: NoteId[];

  // 统计
  checkDurationMs: number;
  checkedAt: string;
}

export interface DiskUsage {
  database: {
    fileSize: number;
    walSize: number;
    vectorDataEstimate: number;
  };
  workspace: {
    pdfsSize: number;
    textsSize: number;
    snapshotsSize: number;
    notesSize: number;
    privateDocsSize: number;
    totalSize: number;
  };
}

// ─── §4.1 文件系统完整性检查 ───

/**
 * 双向文件系统完整性检查。
 *
 * 方向 1（DB→文件）：遍历数据库中全部文件路径引用，检查文件是否存在。
 * 方向 2（文件→DB）：扫描 workspace 目录，检查是否有文件在数据库中无引用。
 *
 * 返回报告但不执行修复——修复由上层触发。
 */
export function checkFilesystemIntegrity(
  db: Database.Database,
  resolver: PathResolver,
  workspaceRoot: string,
  logger?: Logger,
): FilesystemIntegrityReport {
  const startMs = Date.now();

  // ── 方向 1：引用断裂检测（DB → 文件） ──

  const missingPdfs: PaperId[] = [];
  const missingTexts: PaperId[] = [];
  const missingAnalyses: PaperId[] = [];
  const missingNoteFiles: NoteId[] = [];

  // PDF 缺失
  const pdfRows = db.prepare(
    'SELECT id, fulltext_path FROM papers WHERE fulltext_path IS NOT NULL',
  ).all() as Array<{ id: string; fulltext_path: string }>;

  for (const row of pdfRows) {
    try {
      if (!fs.existsSync(resolver.resolve(row.fulltext_path))) {
        missingPdfs.push(row.id as PaperId);
      }
    } catch {
      missingPdfs.push(row.id as PaperId);
    }
  }

  // 文本缺失
  const textRows = db.prepare(
    'SELECT id, text_path FROM papers WHERE text_path IS NOT NULL',
  ).all() as Array<{ id: string; text_path: string }>;

  for (const row of textRows) {
    try {
      if (!fs.existsSync(resolver.resolve(row.text_path))) {
        missingTexts.push(row.id as PaperId);
      }
    } catch {
      missingTexts.push(row.id as PaperId);
    }
  }

  // 分析报告缺失
  const analysisRows = db.prepare(
    'SELECT id, analysis_path FROM papers WHERE analysis_path IS NOT NULL',
  ).all() as Array<{ id: string; analysis_path: string }>;

  for (const row of analysisRows) {
    try {
      if (!fs.existsSync(resolver.resolve(row.analysis_path))) {
        missingAnalyses.push(row.id as PaperId);
      }
    } catch {
      missingAnalyses.push(row.id as PaperId);
    }
  }

  // 笔记文件缺失
  const noteRows = db.prepare(
    'SELECT id, file_path FROM research_notes',
  ).all() as Array<{ id: string; file_path: string }>;

  for (const row of noteRows) {
    if (isInternalDbNoteFilePath(row.file_path)) continue;
    try {
      if (!fs.existsSync(resolver.resolveNote(row.file_path))) {
        missingNoteFiles.push(row.id as NoteId);
      }
    } catch {
      missingNoteFiles.push(row.id as NoteId);
    }
  }

  // ── 方向 2：孤儿文件检测（文件 → DB） ──
  // Fix #5: 先一次性取出全部合法 ID 到 Set，再内存集合差集。
  // 比逐文件 DB 查询快两个数量级（10,000 文件 < 1ms vs 2000 次查询 ~2s）。

  const validPaperIds = new Set(
    (db.prepare('SELECT id FROM papers').all() as Array<{ id: string }>)
      .map((r) => r.id),
  );

  const validNoteFiles = new Set(
    (db.prepare('SELECT file_path FROM research_notes').all() as Array<{ file_path: string }>)
      .map((r) => r.file_path)
      .filter((filePath) => !isInternalDbNoteFilePath(filePath)),
  );

  const orphanedPdfs = scanOrphansWithSet(
    path.join(workspaceRoot, 'pdfs'), '.pdf',
    (name) => validPaperIds.has(name.replace(/\.pdf$/, '')),
  );

  const orphanedTexts = scanOrphansWithSet(
    path.join(workspaceRoot, 'texts'), '.txt',
    (name) => validPaperIds.has(name.replace(/\.txt$/, '')),
  );

  const orphanedAnalyses = scanOrphansWithSet(
    path.join(workspaceRoot, 'analyses'), '.md',
    (name) => validPaperIds.has(name.replace(/\.(md|raw\.txt)$/, '')),
  );

  const orphanedNoteFiles = scanOrphansWithSet(
    path.join(workspaceRoot, 'notes'), '.md',
    (name) => validNoteFiles.has(name),
  );

  const orphanedFigureDirs = scanOrphanDirsWithSet(
    path.join(workspaceRoot, 'figures'),
    (dirName) => validPaperIds.has(dirName),
  );

  // ── §4.1.3 笔记 mtime 一致性检测 ──
  // Fix #3: mtime 变化后用 SHA-256 二次验证文件内容是否真正改变，
  // 防止 DST 跳变、Dropbox/OneDrive 同步篡改 mtime 导致的误报。

  const staleNoteChunks: NoteId[] = [];

  // 一次性查出全部笔记的 updated_at 和 file_hash（如果有）
  const noteMetaRows = db.prepare(
    'SELECT id, file_path, updated_at FROM research_notes',
  ).all() as Array<{ id: string; file_path: string; updated_at: string }>;

  for (const row of noteMetaRows) {
    if (isInternalDbNoteFilePath(row.file_path)) continue;
    try {
      const absPath = resolver.resolveNote(row.file_path);
      if (!fs.existsSync(absPath)) continue;

      const fileMtime = fs.statSync(absPath).mtimeMs;
      const dbUpdatedAt = new Date(row.updated_at).getTime();

      // 快速路径：mtime 在容差内——跳过（无需计算 hash）
      if (Math.abs(fileMtime - dbUpdatedAt) <= 5000) continue;

      // mtime 变化——计算文件 SHA-256 与 DB 中记录的 hash 比对
      const fileContent = fs.readFileSync(absPath);
      const fileHash = createHash('sha256').update(fileContent).digest('hex');

      // 查 _meta 或 research_notes 中是否存储了上次的 hash
      // 如果没有 hash 记录（旧数据），则视为 stale
      const hashRow = db.prepare(
        "SELECT value FROM _meta WHERE key = 'note_hash_' || ?",
      ).get(row.id) as { value: string } | undefined;

      if (!hashRow || hashRow.value !== fileHash) {
        staleNoteChunks.push(row.id as NoteId);
        // 更新 hash 记录（下次不再误报）
        db.prepare(
          `INSERT INTO _meta (key, value) VALUES ('note_hash_' || ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run(row.id, fileHash);
      }
      // hash 相同——mtime 变化是虚假的（DST/云盘），不标记为 stale
    } catch {
      // 无法检测——跳过
    }
  }

  const checkDurationMs = Date.now() - startMs;
  logger?.info('Filesystem integrity check completed', {
    checkDurationMs,
    missingPdfs: missingPdfs.length,
    missingTexts: missingTexts.length,
    orphanedPdfs: orphanedPdfs.length,
    staleNotes: staleNoteChunks.length,
  });

  return {
    missingPdfs,
    missingTexts,
    missingAnalyses,
    missingNoteFiles,
    orphanedPdfs,
    orphanedTexts,
    orphanedAnalyses,
    orphanedNoteFiles,
    orphanedFigureDirs,
    staleNoteChunks,
    checkDurationMs,
    checkedAt: new Date().toISOString(),
  };
}

// ─── §8.2 磁盘空间统计 ───

/**
 * 计算 workspace 各目录的磁盘空间占用。
 * 递归遍历——大型 pdfs/ 目录首次计算可能需要 1-2 秒。
 */
export function calculateDiskUsage(
  workspaceRoot: string,
  dbPath: string,
  chunkCount: number,
  embeddingDimension: number,
): DiskUsage {
  const dbFileSize = safeStatSize(dbPath);
  const walSize = safeStatSize(dbPath + '-wal');
  const vectorDataEstimate = Math.round(chunkCount * embeddingDimension * 4 * 1.15);

  return {
    database: {
      fileSize: dbFileSize,
      walSize,
      vectorDataEstimate,
    },
    workspace: {
      pdfsSize: dirSize(path.join(workspaceRoot, 'pdfs')),
      textsSize: dirSize(path.join(workspaceRoot, 'texts')),
      snapshotsSize: dirSize(path.join(workspaceRoot, '.abyssal', 'snapshots')),
      notesSize: dirSize(path.join(workspaceRoot, 'notes')),
      privateDocsSize: dirSize(path.join(workspaceRoot, 'private_docs')),
      totalSize: dirSize(workspaceRoot),
    },
  };
}

// ─── 内部工具 ───

/**
 * Fix #5: 孤儿文件扫描——使用内存 Set 匹配代替逐文件 DB 查询。
 * isValid 回调接收文件名，通过 Set.has() 在 O(1) 内判断。
 */
function scanOrphansWithSet(
  dirPath: string,
  ext: string,
  isValid: (fileName: string) => boolean,
): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const orphans: string[] = [];
  try {
    const files = fs.readdirSync(dirPath);
    for (const f of files) {
      if (!f.endsWith(ext) && !f.endsWith('.raw.txt')) continue;
      if (f.startsWith('.')) continue; // .gitkeep 等
      if (!isValid(f)) {
        orphans.push(f);
      }
    }
  } catch {
    // 目录不可读
  }
  return orphans;
}

function scanOrphanDirsWithSet(
  dirPath: string,
  isValid: (dirName: string) => boolean,
): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const orphans: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (!isValid(entry.name)) {
        orphans.push(entry.name);
      }
    }
  } catch {
    // 目录不可读
  }
  return orphans;
}

function safeStatSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function dirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        total += safeStatSize(fullPath);
      } else if (entry.isDirectory()) {
        total += dirSize(fullPath);
      }
    }
  } catch {
    // 目录不可读
  }
  return total;
}
