import * as path from 'node:path';
import type { PaperId } from '../types/common';
import type { WorkspaceConfig } from '../types/config';
import { ConfigError } from '../types/errors';

// ═══ PathResolver ═══
//
// 将数据库中存储的相对路径与 workspace 根目录拼接为绝对路径，以及反向操作。
// 所有 resolve 操作在返回前检验路径未逃逸出 workspace 目录。

export class PathResolver {
  private readonly baseDir: string;
  private readonly config: Readonly<WorkspaceConfig>;

  constructor(config: Readonly<WorkspaceConfig>) {
    this.config = config;
    this.baseDir = path.resolve(config.baseDir);
  }

  /** 拼接 baseDir + relativePath，返回绝对路径 */
  resolve(relativePath: string): string {
    const resolved = path.resolve(this.baseDir, relativePath);
    this.assertWithinBase(resolved, relativePath);
    return resolved;
  }

  /** 计算 absolutePath 相对于 baseDir 的相对路径 */
  relative(absolutePath: string): string {
    const resolved = path.resolve(absolutePath);
    this.assertWithinBase(resolved, absolutePath);
    return path.relative(this.baseDir, resolved);
  }

  /** 返回数据库文件的绝对路径 */
  resolveDb(): string {
    return this.resolve(this.config.dbFileName);
  }

  /** 返回论文 PDF 的标准存储路径 */
  resolvePdf(paperId: PaperId): string {
    return this.resolve(path.join(this.config.pdfDir, `${paperId}.pdf`));
  }

  /** 返回论文纯文本的标准存储路径 */
  resolveText(paperId: PaperId): string {
    return this.resolve(path.join(this.config.textDir, `${paperId}.txt`));
  }

  /** 返回分析报告的标准存储路径 */
  resolveAnalysis(paperId: PaperId): string {
    return this.resolve(path.join('analyses', `${paperId}.md`));
  }

  /** 返回裁决记录的标准存储路径 */
  resolveDecision(paperId: PaperId): string {
    return this.resolve(path.join('decisions', `${paperId}.md`));
  }

  /** 返回论文图表子目录的绝对路径 */
  resolveFigureDir(paperId: PaperId): string {
    return this.resolve(path.join('figures', paperId));
  }

  /** 返回文章导出子目录的绝对路径 */
  resolveArticleDir(slug: string): string {
    return this.resolve(path.join('articles', slug));
  }

  /** 返回私有文档的绝对路径 */
  resolvePrivateDoc(fileName: string): string {
    return this.resolve(path.join(this.config.privateDocsDir, fileName));
  }

  /** 返回笔记文件的绝对路径 */
  resolveNote(filePath: string): string {
    return this.resolve(path.join(this.config.notesDir, filePath));
  }

  /** 路径遍历检测 + Windows 路径长度检测 */
  private assertWithinBase(resolved: string, input: string): void {
    // Windows 文件系统大小写不敏感；Linux 大小写敏感——仅 win32 做 toLowerCase
    const normalizedResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const normalizedBase = process.platform === 'win32' ? this.baseDir.toLowerCase() : this.baseDir;
    if (
      !normalizedResolved.startsWith(normalizedBase + path.sep) &&
      normalizedResolved !== normalizedBase
    ) {
      throw new ConfigError({
        message: `Path traversal detected: "${input}" resolves outside workspace`,
        code: 'PATH_TRAVERSAL',
        context: { input, resolved, baseDir: this.baseDir },
      });
    }

    // Fix #4: Windows MAX_PATH 限制（260 字符）。
    // 使用 250 作为阈值留出安全余量（文件名 + 扩展名）。
    // 即使 Windows 10/11 支持长路径，不能指望用户修改注册表。
    if (process.platform === 'win32' && resolved.length > 250) {
      throw new ConfigError({
        message: `Path too long for Windows (${resolved.length} chars, max 250): "${input}". ` +
          'Shorten the name or move workspace to a shorter directory path.',
        code: 'PATH_TOO_LONG',
        context: { input, resolved, length: resolved.length, baseDir: this.baseDir },
      });
    }
  }
}
