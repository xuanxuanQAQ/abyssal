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

  /** 返回笔记文件的绝对路径 */
  resolveNote(filePath: string): string {
    return this.resolve(path.join(this.config.notesDir, filePath));
  }

  /** 路径遍历检测：确保 resolved 以 baseDir 为前缀 */
  private assertWithinBase(resolved: string, input: string): void {
    // 归一化比较（处理大小写不敏感的文件系统）
    const normalizedResolved = resolved.toLowerCase();
    const normalizedBase = this.baseDir.toLowerCase();
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
  }
}
