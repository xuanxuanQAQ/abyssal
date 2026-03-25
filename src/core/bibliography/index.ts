// ═══ Bibliography Module — 公共接口 ═══
//
// 引文标准化闭环：BibTeX/RIS 导入导出 + CrossRef 补全 + CSL 格式化 + 引文替换

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

// ─── 类型重导出 ───

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
  }

  // ─── CSL Engine 懒加载 ───

  private getEngine(stylePath?: string | undefined, localePath?: string | undefined): CslEngine {
    // TODO: stylePath / localePath 应从 config 或 workspace 解析
    if (!this.cslEngine && stylePath && localePath) {
      this.cslEngine = new CslEngine(stylePath, localePath, 'en-US');
    }
    if (!this.cslEngine) {
      throw new Error('CSL engine not initialized — provide stylePath and localePath');
    }
    return this.cslEngine;
  }

  /** 使用指定的 CSL 样式初始化引擎 */
  initCslEngine(stylePath: string, localePath: string, locale?: string | undefined): void {
    this.cslEngine = new CslEngine(stylePath, localePath, locale ?? 'en-US');
  }

  // ─── §1 BibTeX ───

  importBibtex(input: string): ImportedEntry[] {
    return importBibtex(input);
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
}

// ═══ 工厂函数 ═══

export function createBibliographyService(
  config: AbyssalConfig,
  logger: Logger,
): BibliographyService {
  return new BibliographyService(config, logger);
}
