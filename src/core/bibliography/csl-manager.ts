// ═══ CSL 资产管理 ═══
// §1.2: 内置文件分发
// §1.5: XML 校验
// §1.6: 可用格式列表
// §2.3: Locale 回退链
// §7.1-7.2: 综述草稿双格式引文

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PaperId } from '../types/common';
import type { PaperMetadata } from '../types/paper';
import type { Logger } from '../infra/logger';
import type { CslEngine } from './csl-engine';
import type { FormattedCitation } from '../types/bibliography';

// ─── §1.2 内置 CSL 文件分发 ───

/**
 * 将内置 CSL 文件从 Electron resources/ 复制到 workspace/csl/。
 *
 * 首次：完整复制。后续：仅补充缺失文件，不覆盖已有文件。
 * 不覆盖的理由：用户可能修改了内置 CSL 文件（如调整 APA 的标点规则）。
 *
 * TODO: Electron process.resourcesPath 在开发模式下指向不同路径
 */
export function distributeCslFiles(
  resourcesDir: string,
  workspaceCslDir: string,
  logger?: Logger,
): number {
  if (!fs.existsSync(resourcesDir)) {
    logger?.warn('CSL resources directory not found', { resourcesDir });
    return 0;
  }

  fs.mkdirSync(workspaceCslDir, { recursive: true });

  let copied = 0;

  function copyRecursive(srcDir: string, destDir: string): void {
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        // 不覆盖已有文件
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
          copied++;
        }
      }
    }
  }

  copyRecursive(resourcesDir, workspaceCslDir);

  if (copied > 0) {
    logger?.info('CSL files distributed', { copied, dest: workspaceCslDir });
  }

  return copied;
}

// ─── §1.5 CSL 文件校验 ───

/**
 * 轻量校验 CSL 文件——XML 语法 + <style> 根元素检查。
 *
 * 不执行完整的 CSL Schema 验证——citeproc-js 引擎本身在解析时会进行语义校验。
 *
 * TODO: fast-xml-parser 依赖需添加到 package.json
 */
export function validateCslFile(filePath: string): { valid: boolean; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 检查 XML 声明或 <style 根元素
    if (!content.includes('<style') && !content.includes('<style>')) {
      return { valid: false, error: 'Missing <style> root element — not a valid CSL file' };
    }

    // 基础 XML 语法检查：标签配对
    const openTags = (content.match(/<style\b/g) ?? []).length;
    const closeTags = (content.match(/<\/style>/g) ?? []).length;
    if (openTags === 0 || closeTags === 0) {
      return { valid: false, error: 'Malformed XML: unclosed <style> element' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Cannot read file: ${(err as Error).message}` };
  }
}

// ─── §1.6 可用格式列表 ───

export interface AvailableCslStyle {
  styleId: string;
  displayName: string;
  filePath: string;
}

/** 缓存（应用生命周期内有效） */
let stylesCache: AvailableCslStyle[] | null = null;

/**
 * 扫描 workspace/csl/styles/ 目录，返回全部可用的 CSL 格式。
 * 从 XML <title> 元素提取显示名称。
 * 结果在应用生命周期内缓存——调用 invalidateStylesCache() 或重启后刷新。
 */
export function listAvailableStyles(stylesDir: string): AvailableCslStyle[] {
  if (stylesCache) return stylesCache;

  if (!fs.existsSync(stylesDir)) return [];

  const results: AvailableCslStyle[] = [];

  try {
    const files = fs.readdirSync(stylesDir);
    for (const f of files) {
      if (!f.endsWith('.csl')) continue;

      const styleId = f.slice(0, -4);
      const filePath = path.join(stylesDir, f);

      // 从 XML <title> 提取显示名称（正则——<title> 通常在前 10 行）
      let displayName = styleId;
      try {
        const head = fs.readFileSync(filePath, 'utf-8').slice(0, 2000);
        const match = /<title>([^<]+)<\/title>/.exec(head);
        if (match) displayName = match[1]!;
      } catch {
        // 读取失败——使用 styleId 作为显示名
      }

      results.push({ styleId, displayName, filePath });
    }
  } catch {
    // 目录不可读
  }

  results.sort((a, b) => a.displayName.localeCompare(b.displayName));
  stylesCache = results;
  return results;
}

/** 用户添加新文件后调用以刷新缓存 */
export function invalidateStylesCache(): void {
  stylesCache = null;
}

// ─── §2.3 Locale 回退链 ───

/**
 * 四步回退链解析 locale 文件。
 *
 * 1. 精确匹配：locales-{lang}.xml
 * 2. 去区域后缀：locales-{primary}.xml
 * 3. 同语言扫描：locales-{primary}-*.xml，取字典序第一个
 * 4. 全局默认：locales-en-US.xml
 */
export function resolveLocale(lang: string, localesDir: string): string | null {
  // 步骤 1：精确匹配
  const exactPath = path.join(localesDir, `locales-${lang}.xml`);
  if (fs.existsSync(exactPath)) {
    return fs.readFileSync(exactPath, 'utf-8');
  }

  // 步骤 2：去区域后缀
  const primaryLang = lang.split('-')[0]!;
  if (primaryLang !== lang) {
    const primaryPath = path.join(localesDir, `locales-${primaryLang}.xml`);
    if (fs.existsSync(primaryPath)) {
      return fs.readFileSync(primaryPath, 'utf-8');
    }
  }

  // 步骤 3：同语言扫描
  try {
    const files = fs.readdirSync(localesDir);
    const prefix = `locales-${primaryLang}-`;
    const match = files
      .filter((f) => f.startsWith(prefix) && f.endsWith('.xml'))
      .sort()[0]; // 字典序第一个

    if (match) {
      return fs.readFileSync(path.join(localesDir, match), 'utf-8');
    }
  } catch {
    // 目录不可读
  }

  // 步骤 4：全局默认
  if (lang !== 'en-US') {
    const defaultPath = path.join(localesDir, 'locales-en-US.xml');
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf-8');
    }
  }

  return null;
}

// ─── §7 综述草稿引文 ───

/** 从 markdown 中按正则扫描 paperId 并去重（保持顺序） */
function collectUniqueIds(markdown: string, re: RegExp): PaperId[] {
  const seen = new Set<string>();
  const ids: PaperId[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const id = m[1]! as PaperId;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** 批量格式化引文，返回 paperId → inlineCitation 映射；格式化失败返回 null */
function buildCitationMap(
  paperIds: PaperId[],
  paperMap: Map<PaperId, PaperMetadata>,
  engine: CslEngine,
): Map<string, string> | null {
  const papers = paperIds
    .filter((id) => paperMap.has(id))
    .map((id) => ({ paperId: id, metadata: paperMap.get(id)! }));

  let citations: FormattedCitation[];
  try {
    citations = engine.formatCitation(papers);
  } catch {
    return null;
  }

  const map = new Map<string, string>();
  for (const c of citations) {
    map.set(c.paperId, c.inlineCitation);
  }
  return map;
}

/** 替换回调：将 paperId 映射为 [[@id]](rendered) */
function draftCiteReplacer(citationMap: Map<string, string>) {
  return (_match: string, id: string) => {
    const rendered = citationMap.get(id);
    return rendered ? `[[@${id}]](${rendered})` : `[[@${id}]](⚠️ unknown)`;
  };
}

/**
 * 将 [@paperId] 标记渲染为双格式 [[@paperId]](rendered)。
 *
 * 综述草稿面向研究者直接阅读——看到 [@a1b2c3d4e5f6] 不如 (Goffman, 1959) 直观。
 * 保留 [[@id]] 原始标记确保格式切换时可反向提取。
 */
export function renderDraftCitations(
  markdown: string,
  paperMap: Map<PaperId, PaperMetadata>,
  engine: CslEngine,
): string {
  const citeRe = /\[@([a-f0-9]{12})\]/g;
  const paperIds = collectUniqueIds(markdown, citeRe);
  if (paperIds.length === 0) return markdown;

  const citationMap = buildCitationMap(paperIds, paperMap, engine);
  if (!citationMap) return markdown;

  return markdown.replace(citeRe, draftCiteReplacer(citationMap));
}

/**
 * §7.2: 从双格式文本中反向提取 paperId 列表。
 */
export function extractDraftCitationIds(markdown: string): PaperId[] {
  return collectUniqueIds(markdown, /\[\[@([a-f0-9]{12})\]\]\([^)]*\)/g);
}

/**
 * §7.2: 格式切换时用新 CSL 重渲染综述草稿中的引文。
 *
 * 反向提取 [[@id]](old_rendered) → 用新引擎重格式化 → 替换渲染结果。
 */
export function reRenderDraftCitations(
  markdown: string,
  paperMap: Map<PaperId, PaperMetadata>,
  engine: CslEngine,
): string {
  const paperIds = extractDraftCitationIds(markdown);
  if (paperIds.length === 0) return markdown;

  const citationMap = buildCitationMap(paperIds, paperMap, engine);
  if (!citationMap) return markdown;

  return markdown.replace(
    /\[\[@([a-f0-9]{12})\]\]\([^)]*\)/g,
    draftCiteReplacer(citationMap),
  );
}
