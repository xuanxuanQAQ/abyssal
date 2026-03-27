/**
 * Workspace Manager — 最近工作区管理 + 工作区生命周期
 *
 * 职责：
 * 1. 维护最近打开的工作区列表（存储在 AppData）
 * 2. 验证工作区目录是否合法
 * 3. 提供创建 / 打开工作区的高层接口
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isWorkspace,
  readWorkspaceMeta,
  scaffoldWorkspace,
  getWorkspacePaths,
  type WorkspaceMeta,
  type ScaffoldResult,
} from './scaffold';

// ═══ 最近工作区列表 ═══

export interface RecentWorkspaceEntry {
  /** 工作区根目录绝对路径 */
  path: string;
  /** 工作区名称 */
  name: string;
  /** 最后打开时间 */
  lastOpenedAt: string;
  /** 是否已固定（用户手动置顶） */
  pinned: boolean;
}

interface RecentWorkspacesFile {
  version: 1;
  entries: RecentWorkspaceEntry[];
}

const MAX_RECENT_ENTRIES = 20;

export class WorkspaceManager {
  /** recent-workspaces.json 的绝对路径 */
  private readonly recentFilePath: string;

  constructor(appDataDir: string) {
    this.recentFilePath = path.join(appDataDir, 'recent-workspaces.json');
  }

  // ─── 最近工作区列表 ───

  /**
   * 读取最近工作区列表。
   * 自动剔除已不存在的工作区目录。
   */
  getRecentWorkspaces(): RecentWorkspaceEntry[] {
    const data = this.readRecentFile();
    // 过滤掉已删除的工作区
    const valid = data.entries.filter((e) => fs.existsSync(e.path));
    if (valid.length !== data.entries.length) {
      this.writeRecentFile({ ...data, entries: valid });
    }
    return valid;
  }

  /**
   * 将工作区添加到最近列表（或更新已有条目的打开时间）。
   */
  touchRecent(workspacePath: string, name?: string): void {
    const data = this.readRecentFile();
    const absPath = path.resolve(workspacePath);

    // 移除已有条目（稍后重新插入到顶部）
    const existing = data.entries.find((e) => e.path === absPath);
    data.entries = data.entries.filter((e) => e.path !== absPath);

    // 插入到顶部
    data.entries.unshift({
      path: absPath,
      name: name ?? existing?.name ?? path.basename(absPath),
      lastOpenedAt: new Date().toISOString(),
      pinned: existing?.pinned ?? false,
    });

    // 限制条目数（但始终保留 pinned 条目）
    const pinned = data.entries.filter((e) => e.pinned);
    const unpinned = data.entries.filter((e) => !e.pinned);
    data.entries = [...pinned, ...unpinned.slice(0, MAX_RECENT_ENTRIES - pinned.length)];

    this.writeRecentFile(data);
  }

  /**
   * 从最近列表移除指定工作区。
   */
  removeRecent(workspacePath: string): void {
    const data = this.readRecentFile();
    const absPath = path.resolve(workspacePath);
    data.entries = data.entries.filter((e) => e.path !== absPath);
    this.writeRecentFile(data);
  }

  /**
   * 切换某个工作区的置顶状态。
   */
  togglePin(workspacePath: string): boolean {
    const data = this.readRecentFile();
    const absPath = path.resolve(workspacePath);
    const entry = data.entries.find((e) => e.path === absPath);
    if (!entry) return false;
    entry.pinned = !entry.pinned;
    this.writeRecentFile(data);
    return entry.pinned;
  }

  // ─── 工作区生命周期 ───

  /**
   * 创建新工作区。
   * 在指定目录中生成完整的目录结构和初始配置。
   */
  createWorkspace(options: {
    rootDir: string;
    name?: string;
    description?: string;
  }): ScaffoldResult {
    const result = scaffoldWorkspace(options);
    this.touchRecent(result.rootDir, result.meta.name);
    return result;
  }

  /**
   * 打开已有的工作区。
   * 验证目录合法性，更新最近列表。
   *
   * @returns 工作区元数据；如果不是合法工作区返回 null
   */
  openWorkspace(rootDir: string): WorkspaceMeta | null {
    const absPath = path.resolve(rootDir);

    if (!isWorkspace(absPath)) {
      return null;
    }

    const meta = readWorkspaceMeta(absPath);
    if (meta) {
      this.touchRecent(absPath, meta.name);
    }
    return meta;
  }

  /**
   * 验证给定路径是否为合法工作区。
   */
  validateWorkspace(rootDir: string): {
    valid: boolean;
    meta: WorkspaceMeta | null;
    paths: ReturnType<typeof getWorkspacePaths> | null;
    issues: string[];
  } {
    const absPath = path.resolve(rootDir);
    const issues: string[] = [];

    if (!fs.existsSync(absPath)) {
      return { valid: false, meta: null, paths: null, issues: ['目录不存在'] };
    }

    if (!isWorkspace(absPath)) {
      return { valid: false, meta: null, paths: null, issues: ['不是 Abyssal 工作区（缺少 .abyssal/workspace.json）'] };
    }

    const meta = readWorkspaceMeta(absPath);
    if (!meta) {
      issues.push('工作区元数据文件损坏');
    }

    const paths = getWorkspacePaths(absPath);

    // 检查关键目录
    if (!fs.existsSync(paths.internal)) issues.push('缺少 .abyssal/ 目录');
    if (!fs.existsSync(paths.pdfs)) issues.push('缺少 pdfs/ 目录');
    if (!fs.existsSync(paths.notes)) issues.push('缺少 notes/ 目录');

    return {
      valid: issues.length === 0 && meta !== null,
      meta,
      paths: issues.length === 0 ? paths : null,
      issues,
    };
  }

  // ─── 内部方法 ───

  private readRecentFile(): RecentWorkspacesFile {
    try {
      if (fs.existsSync(this.recentFilePath)) {
        const raw = fs.readFileSync(this.recentFilePath, 'utf-8');
        return JSON.parse(raw) as RecentWorkspacesFile;
      }
    } catch {
      // 文件损坏，重置
    }
    return { version: 1, entries: [] };
  }

  private writeRecentFile(data: RecentWorkspacesFile): void {
    const dir = path.dirname(this.recentFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.recentFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
