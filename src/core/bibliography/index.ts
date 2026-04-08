// ═══ Bibliography Module — 公共接口 ═══
//
// 引文标准化闭环：BibTeX/RIS 导入导出 + CrossRef 补全 + CSL 格式化 + 引文替换

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PaperId } from '../types/common';
import type { PaperMetadata } from '../types/paper';
import type {
  FormattedCitation,
  BiblioCompletenessReport,
  ImportedEntry,
  EnrichResult,
  AnystyleParsedEntry,
  ScanAndReplaceResult,
} from '../types/bibliography';
import type { AbyssalConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import { HttpClient } from '../infra/http-client';
import { createRateLimiter, type RateLimiter } from '../infra/rate-limiter';

import { importBibtex } from './import-bibtex';
import { exportBibtex } from './export-bibtex';
import { importRis } from './import-ris';
import { exportRis } from './export-ris';
import { enrichBibliography } from './enrich';
import { CslEngine } from './csl-engine';
import { checkBiblioCompleteness } from './completeness';
import { parseReferences } from './parse-references';
import { scanAndReplace, exportForLatex, exportForPandoc } from './scan-replace';
import { generateBibtexKey } from './bibtex-key';
import {
  listAvailableStyles,
  invalidateStylesCache,
  validateCslFile,
  renderDraftCitations,
  reRenderDraftCitations,
  type AvailableCslStyle,
} from './csl-manager';

// ─── 子模块重导出（仅 export from，无双重 import） ───

export { importBibtex } from './import-bibtex';
export { exportBibtex } from './export-bibtex';
export { importRis } from './import-ris';
export { exportRis } from './export-ris';
export { enrichBibliography } from './enrich';
export { CslEngine } from './csl-engine';
export { checkBiblioCompleteness } from './completeness';
export { parseReferences } from './parse-references';
export { scanAndReplace, exportForLatex, exportForPandoc } from './scan-replace';
export { generateBibtexKey } from './bibtex-key';
export {
  distributeCslFiles,
  listAvailableStyles,
  invalidateStylesCache,
  validateCslFile,
  renderDraftCitations,
  reRenderDraftCitations,
  extractDraftCitationIds,
  type AvailableCslStyle,
} from './csl-manager';

// ═══ BibliographyService ═══

export class BibliographyService {
  private readonly http: HttpClient;
  private readonly crossRefLimiter: RateLimiter;
  private readonly logger: Logger;
  private cslEngine: CslEngine | null = null;
  private readonly config: AbyssalConfig;

  constructor(config: AbyssalConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.http = new HttpClient({
      logger,
      userAgentEmail: config.apiKeys.openalexEmail ?? undefined,
    });
    this.crossRefLimiter = createRateLimiter('crossRef');

    // 从 config 自动初始化 CSL Engine（需要 cslStylesDir + defaultCslStyleId）
    const writingConfig = config.writing;
    if (writingConfig?.cslStylesDir && writingConfig?.cslLocalesDir) {
      const { cslStylesDir, cslLocalesDir, defaultCslStyleId } = writingConfig;
      const stylePath = path.join(cslStylesDir, `${defaultCslStyleId}.csl`);
      if (fs.existsSync(stylePath) && fs.existsSync(cslLocalesDir)) {
        this.cslEngine = new CslEngine(stylePath, cslLocalesDir);
        logger.debug('CSL engine initialized from config', { stylePath, cslLocalesDir });
      }
    }
  }

  // ─── CSL Engine ───

  private getEngine(): CslEngine {
    if (!this.cslEngine) {
      throw new Error(
        'CSL engine not initialized — ensure config.writing.cslStylesDir and cslLocalesDir are set',
      );
    }
    return this.cslEngine;
  }

  /** 切换 CSL 样式（格式变更时调用） */
  switchCslStyle(styleId: string): void {
    const writingConfig = this.config.writing;
    if (!writingConfig?.cslStylesDir || !writingConfig?.cslLocalesDir) {
      throw new Error('Writing config is missing cslStylesDir/cslLocalesDir');
    }
    const { cslStylesDir, cslLocalesDir } = writingConfig;
    const stylePath = path.join(cslStylesDir, `${styleId}.csl`);
    this.cslEngine = new CslEngine(stylePath, cslLocalesDir);
  }

  get engineReady(): boolean {
    return this.cslEngine !== null;
  }

  // ─── §1 BibTeX ───

  async importBibtex(input: string): Promise<ImportedEntry[]> {
    return await importBibtex(input);
  }

  exportBibtex(papers: PaperMetadata[]): string {
    return exportBibtex(papers);
  }

  // ─── §2 RIS ───

  importRis(input: string): ImportedEntry[] {
    return importRis(input);
  }

  exportRis(papers: PaperMetadata[]): string {
    return exportRis(papers);
  }

  // ─── §3 CrossRef 补全 ───

  async enrichBibliography(paper: PaperMetadata): Promise<EnrichResult> {
    return enrichBibliography(paper, this.http, this.crossRefLimiter);
  }

  // ─── §4 CSL 格式化 ───

  formatCitation(
    papers: Array<{ paperId: PaperId; metadata: PaperMetadata }>,
  ): FormattedCitation[] {
    return this.getEngine().formatCitation(papers);
  }

  formatBibliography(
    papers: Array<{ paperId: PaperId; metadata: PaperMetadata }>,
    format?: 'html' | 'text',
  ): string {
    return this.getEngine().formatBibliography(papers, format);
  }

  // ─── §5 完整度检查 ───

  checkBiblioCompleteness(
    paper: PaperMetadata,
    cslStyleId: string,
  ): BiblioCompletenessReport {
    return checkBiblioCompleteness(paper, cslStyleId, this.getEngine());
  }

  // ─── §6 参考文献解析 ───

  parseReferences(rawTexts: string[]): AnystyleParsedEntry[] {
    return parseReferences(rawTexts);
  }

  // ─── §7 引文替换 ───

  scanAndReplace(
    markdown: string,
    paperMap: Map<PaperId, PaperMetadata>,
  ): ScanAndReplaceResult {
    return scanAndReplace(markdown, paperMap, this.getEngine());
  }

  // ─── §8 导出管线 ───

  exportForLatex(
    markdown: string,
    paperMap: Map<PaperId, PaperMetadata>,
  ): { tex: string; bib: string } {
    return exportForLatex(markdown, paperMap);
  }

  exportForPandoc(
    markdown: string,
    paperMap: Map<PaperId, PaperMetadata>,
  ): { md: string; bib: string } {
    return exportForPandoc(markdown, paperMap);
  }

  // ─── BibTeX Key ───

  generateBibtexKey(
    paper: Partial<PaperMetadata>,
    existingKeys?: Set<string>,
  ): string {
    return generateBibtexKey(paper, existingKeys);
  }

  // ─── §1.6 可用格式列表 ───

  listAvailableStyles(): AvailableCslStyle[] {
    const stylesDir = this.config.writing?.cslStylesDir;
    if (!stylesDir) return [];
    return listAvailableStyles(stylesDir);
  }

  // ─── §1.5 CSL 文件校验 + 添加 ───

  validateAndAddCslFile(
    filePath: string,
  ): { success: boolean; error?: string | undefined } {
    const result = validateCslFile(filePath);
    if (!result.valid) {
      return { success: false, error: result.error };
    }

    const stylesDir = this.config.writing?.cslStylesDir;
    if (!stylesDir) {
      return { success: false, error: 'Writing config is missing cslStylesDir' };
    }
    const fileName = path.basename(filePath);
    const destPath = path.join(stylesDir, fileName);
    try {
      fs.copyFileSync(filePath, destPath);
      invalidateStylesCache();
      return { success: true };
    } catch (err) {
      return { success: false, error: `Copy failed: ${(err as Error).message}` };
    }
  }

  // ─── §7.1 综述草稿引文预格式化 ───

  renderDraftCitations(
    markdown: string,
    paperMap: Map<PaperId, PaperMetadata>,
  ): string {
    return renderDraftCitations(markdown, paperMap, this.getEngine());
  }

  reRenderDraftCitations(
    markdown: string,
    paperMap: Map<PaperId, PaperMetadata>,
  ): string {
    return reRenderDraftCitations(markdown, paperMap, this.getEngine());
  }
}

// ═══ 工厂函数 ═══

export function createBibliographyService(
  config: AbyssalConfig,
  logger: Logger,
): BibliographyService {
  return new BibliographyService(config, logger);
}
