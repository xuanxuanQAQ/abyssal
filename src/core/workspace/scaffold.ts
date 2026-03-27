/**
 * Workspace Scaffold — 创建完整的工作区目录结构
 *
 * 类似 `git init`：在用户指定的目录中生成 .abyssal/ 内部目录
 * 和用户可见的子目录（pdfs/、notes/ 等）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ═══ 目录结构定义 ═══

/** .abyssal/ 内部目录（用户不需要直接操作） */
const INTERNAL_DIRS = [
  '.abyssal',
  '.abyssal/snapshots',
  '.abyssal/logs',
] as const;

/** 用户可见的工作子目录 */
const USER_DIRS = [
  'pdfs',
  'texts',
  'figures',
  'analyses',
  'decisions',
  'drafts',
  'matrices',
  'articles',
  'notes',
  'reports',
  'exports',
  'private_docs',
  'csl',
  'csl/styles',
  'csl/locales',
] as const;

/** 标记文件：存在 .abyssal/workspace.json 即为合法工作区 */
const WORKSPACE_MARKER = '.abyssal/workspace.json';

// ═══ 工作区元数据 ═══

export interface WorkspaceMeta {
  /** 工作区名称（默认为目录名） */
  name: string;
  /** 创建时间 */
  createdAt: string;
  /** Abyssal 版本 */
  version: string;
  /** 项目描述 */
  description: string;
}

// ═══ 默认工作区配置 TOML ═══

function defaultConfigToml(name: string): string {
  return `# Abyssal 工作区配置
# 此文件仅包含工作区级别的设置。
# API 密钥等全局配置请在应用设置中管理。

[project]
name = "${name}"
description = ""
mode = "auto"   # anchored | unanchored | auto

[analysis]
maxTokensPerChunk = 1024
overlapTokens = 128
ocrEnabled = true
ocrLanguages = ["eng", "chi_sim"]
vlmEnabled = false
autoSuggestConcepts = true

[discovery]
traversalDepth = 2
concurrency = 5
maxResultsPerQuery = 100

[language]
defaultOutputLanguage = "zh-CN"

[concepts]
additiveChangeLookbackDays = 30
autoSuggestThreshold = 3
`;
}

// ═══ 公共接口 ═══

export interface ScaffoldOptions {
  /** 工作区根目录的绝对路径 */
  rootDir: string;
  /** 工作区名称（默认取目录名） */
  name?: string;
  /** 项目描述 */
  description?: string;
}

export interface ScaffoldResult {
  /** 工作区根目录 */
  rootDir: string;
  /** 工作区元数据 */
  meta: WorkspaceMeta;
  /** 创建的所有目录 */
  createdDirs: string[];
  /** 创建的所有文件 */
  createdFiles: string[];
}

/**
 * 检测给定目录是否已经是一个 Abyssal 工作区。
 */
export function isWorkspace(dir: string): boolean {
  return fs.existsSync(path.join(dir, WORKSPACE_MARKER));
}

/**
 * 读取工作区元数据。如果不是合法工作区，返回 null。
 */
export function readWorkspaceMeta(dir: string): WorkspaceMeta | null {
  const markerPath = path.join(dir, WORKSPACE_MARKER);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const raw = fs.readFileSync(markerPath, 'utf-8');
    return JSON.parse(raw) as WorkspaceMeta;
  } catch {
    return null;
  }
}

/**
 * 在指定目录中创建完整的工作区结构。
 *
 * 幂等操作：已存在的目录和文件不会被覆盖。
 * 如果目录已经是工作区，返回现有元数据。
 */
export function scaffoldWorkspace(options: ScaffoldOptions): ScaffoldResult {
  const { rootDir, description = '' } = options;
  const name = options.name ?? path.basename(rootDir);

  const createdDirs: string[] = [];
  const createdFiles: string[] = [];

  // 1. 创建根目录（如果不存在）
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
    createdDirs.push(rootDir);
  }

  // 2. 如果已经是工作区，直接返回现有元数据
  const existingMeta = readWorkspaceMeta(rootDir);
  if (existingMeta) {
    return { rootDir, meta: existingMeta, createdDirs: [], createdFiles: [] };
  }

  // 3. 创建内部目录
  for (const dir of INTERNAL_DIRS) {
    const fullPath = path.join(rootDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      createdDirs.push(fullPath);
    }
  }

  // 4. 创建用户目录
  for (const dir of USER_DIRS) {
    const fullPath = path.join(rootDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      createdDirs.push(fullPath);
    }
  }

  // 5. 写入工作区标记文件
  const meta: WorkspaceMeta = {
    name,
    createdAt: new Date().toISOString(),
    version: '0.1.0',
    description,
  };
  const markerPath = path.join(rootDir, WORKSPACE_MARKER);
  fs.writeFileSync(markerPath, JSON.stringify(meta, null, 2), 'utf-8');
  createdFiles.push(markerPath);

  // 6. 写入默认配置（不覆盖已有配置）
  const configPath = path.join(rootDir, '.abyssal', 'config.toml');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, defaultConfigToml(name), 'utf-8');
    createdFiles.push(configPath);
  }

  // 7. 写入 .gitignore（忽略 DB 和日志，保留配置和用户文件）
  const gitignorePath = path.join(rootDir, '.abyssal', '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      [
        '# Abyssal internal files',
        '*.db',
        '*.db-wal',
        '*.db-shm',
        'logs/',
        'snapshots/',
        '',
        '# Keep config',
        '!config.toml',
        '!workspace.json',
        '',
      ].join('\n'),
      'utf-8',
    );
    createdFiles.push(gitignorePath);
  }

  // 8. 在用户目录中写入 .gitkeep（确保空目录可以被 Git 跟踪）
  for (const dir of USER_DIRS) {
    const gitkeepPath = path.join(rootDir, dir, '.gitkeep');
    if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, '', 'utf-8');
      createdFiles.push(gitkeepPath);
    }
  }

  return { rootDir, meta, createdDirs, createdFiles };
}

// ═══ 路径工具 ═══

/**
 * 获取工作区内各子目录的绝对路径。
 */
export function getWorkspacePaths(rootDir: string) {
  return {
    root: rootDir,
    internal: path.join(rootDir, '.abyssal'),
    db: path.join(rootDir, '.abyssal', 'abyssal.db'),
    config: path.join(rootDir, '.abyssal', 'config.toml'),
    marker: path.join(rootDir, WORKSPACE_MARKER),
    snapshots: path.join(rootDir, '.abyssal', 'snapshots'),
    logs: path.join(rootDir, '.abyssal', 'logs'),
    pdfs: path.join(rootDir, 'pdfs'),
    texts: path.join(rootDir, 'texts'),
    figures: path.join(rootDir, 'figures'),
    analyses: path.join(rootDir, 'analyses'),
    decisions: path.join(rootDir, 'decisions'),
    drafts: path.join(rootDir, 'drafts'),
    matrices: path.join(rootDir, 'matrices'),
    articles: path.join(rootDir, 'articles'),
    notes: path.join(rootDir, 'notes'),
    reports: path.join(rootDir, 'reports'),
    exports: path.join(rootDir, 'exports'),
    privateDocs: path.join(rootDir, 'private_docs'),
    csl: path.join(rootDir, 'csl'),
    cslStyles: path.join(rootDir, 'csl', 'styles'),
    cslLocales: path.join(rootDir, 'csl', 'locales'),
  } as const;
}
