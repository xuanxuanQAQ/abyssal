// ═══ Acquire Module — 级联全文获取引擎 ═══
// §6: 五级瀑布流数据源 + 幂等性 + 审计日志

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AcquireResult, AcquireAttempt } from '../types';
import type { AbyssalConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import { HttpClient, computeSha256 } from '../infra/http-client';
import { createRateLimiter, type RateLimiter } from '../infra/rate-limiter';
import { validatePdf } from './pdf-validator';
import { deleteFileIfExists } from './downloader';
import { tryUnpaywall } from './sources/unpaywall';
import { tryArxivPdf } from './sources/arxiv';
import { tryPmc } from './sources/pmc';
import { tryInstitutional } from './sources/institutional';
import { tryScihub } from './sources/scihub';

// ─── 类型重导出 ───

export { validatePdf } from './pdf-validator';
export { downloadPdf, computeSha256, deleteFileIfExists } from './downloader';

// ─── 输入参数 ───

export interface AcquireFulltextParams {
  doi: string | null;
  arxivId: string | null;
  pmcid: string | null;
  url: string | null;
  savePath: string;
  enabledSources?: string[] | undefined;
  perSourceTimeoutMs?: number | undefined;
}

// ─── 默认启用的数据源优先级 ───

const DEFAULT_ENABLED_SOURCES = ['unpaywall', 'arxiv', 'pmc'];

// ═══ AcquireService ═══

export class AcquireService {
  private readonly http: HttpClient;
  private readonly logger: Logger;
  private readonly config: AbyssalConfig;
  private readonly unpaywallLimiter: RateLimiter;

  constructor(config: AbyssalConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.http = new HttpClient({
      logger,
      userAgentEmail: config.apiKeys.openalexEmail ?? undefined,
    });
    this.unpaywallLimiter = createRateLimiter('unpaywall');
  }

  /**
   * §6.8 级联全文获取。
   *
   * 幂等性 (§11.2)：如果 savePath 已存在有效 PDF，跳过下载直接返回 success。
   */
  async acquireFulltext(params: AcquireFulltextParams): Promise<AcquireResult> {
    const {
      doi, arxivId, pmcid, savePath,
      perSourceTimeoutMs = this.config.acquire.perSourceTimeoutMs,
    } = params;

    const enabledSources = params.enabledSources ?? [
      ...DEFAULT_ENABLED_SOURCES,
      ...(this.config.acquire.institutionalProxyUrl ? ['institutional'] : []),
      ...(this.config.acquire.enableScihub ? ['scihub'] : []),
    ];

    const attempts: AcquireAttempt[] = [];
    const tempPath = savePath + '.tmp';

    // 幂等性检查：目标路径已存在有效 PDF
    if (fs.existsSync(savePath)) {
      try {
        const validation = await validatePdf(savePath);
        if (validation.valid) {
          const sha256 = await computeSha256(savePath);
          const fileSize = fs.statSync(savePath).size;
          this.logger.debug('PDF already exists, skipping download', { savePath });
          return {
            status: 'success',
            pdfPath: savePath,
            source: 'cached',
            sha256,
            fileSize,
            attempts: [],
          };
        }
      } catch {
        // 校验失败，继续下载
      }
    }

    // ─── Level 1: Unpaywall ───
    if (enabledSources.includes('unpaywall')) {
      if (!doi || !this.config.apiKeys.unpaywallEmail) {
        attempts.push({
          source: 'unpaywall',
          status: 'skipped',
          durationMs: 0,
          failureReason: !doi ? 'No DOI' : 'No Unpaywall email configured',
          httpStatus: null,
        });
      } else {
        const attempt = await tryUnpaywall(
          this.http, this.unpaywallLimiter, doi,
          this.config.apiKeys.unpaywallEmail, tempPath, perSourceTimeoutMs,
        );
        attempts.push(attempt);
        if (attempt.status === 'success') {
          return this.finalize(tempPath, savePath, 'unpaywall', attempts);
        }
      }
    }

    // ─── Level 2: arXiv ───
    if (enabledSources.includes('arxiv')) {
      if (!arxivId) {
        attempts.push({
          source: 'arxiv',
          status: 'skipped',
          durationMs: 0,
          failureReason: 'No arXiv ID',
          httpStatus: null,
        });
      } else {
        const attempt = await tryArxivPdf(this.http, arxivId, tempPath, perSourceTimeoutMs);
        attempts.push(attempt);
        if (attempt.status === 'success') {
          return this.finalize(tempPath, savePath, 'arxiv', attempts);
        }
      }
    }

    // ─── Level 3: PubMed Central ───
    if (enabledSources.includes('pmc')) {
      if (!pmcid && !doi) {
        attempts.push({
          source: 'pmc',
          status: 'skipped',
          durationMs: 0,
          failureReason: 'No PMCID or DOI',
          httpStatus: null,
        });
      } else {
        const attempt = await tryPmc(this.http, doi, pmcid, tempPath, perSourceTimeoutMs);
        attempts.push(attempt);
        if (attempt.status === 'success') {
          return this.finalize(tempPath, savePath, 'pmc', attempts);
        }
      }
    }

    // ─── Level 4: Institutional Proxy ───
    if (enabledSources.includes('institutional')) {
      if (!doi || !this.config.acquire.institutionalProxyUrl) {
        attempts.push({
          source: 'institutional',
          status: 'skipped',
          durationMs: 0,
          failureReason: !doi ? 'No DOI' : 'No proxy URL configured',
          httpStatus: null,
        });
      } else {
        const attempt = await tryInstitutional(
          this.http, doi, this.config.acquire.institutionalProxyUrl,
          tempPath, perSourceTimeoutMs,
        );
        attempts.push(attempt);
        if (attempt.status === 'success') {
          return this.finalize(tempPath, savePath, 'institutional', attempts);
        }
      }
    }

    // ─── Level 5: Sci-Hub ───
    if (enabledSources.includes('scihub')) {
      if (!doi || !this.config.acquire.enableScihub || !this.config.acquire.scihubDomain) {
        attempts.push({
          source: 'scihub',
          status: 'skipped',
          durationMs: 0,
          failureReason: !doi
            ? 'No DOI'
            : !this.config.acquire.enableScihub
              ? 'Sci-Hub disabled'
              : 'No Sci-Hub domain configured',
          httpStatus: null,
        });
      } else {
        const attempt = await tryScihub(
          this.http, doi, this.config.acquire.scihubDomain,
          tempPath, perSourceTimeoutMs,
        );
        attempts.push(attempt);
        if (attempt.status === 'success') {
          return this.finalize(tempPath, savePath, 'scihub', attempts);
        }
      }
    }

    // 全部级联源耗尽
    deleteFileIfExists(tempPath);
    this.logger.error('All acquire sources exhausted', undefined, {
      doi, arxivId, pmcid, attemptCount: attempts.length,
    });

    return {
      status: 'failed',
      pdfPath: null,
      source: null,
      sha256: null,
      fileSize: null,
      attempts,
    };
  }

  // ─── 成功后处理：重命名 + SHA-256 ───

  private async finalize(
    tempPath: string,
    savePath: string,
    source: string,
    attempts: AcquireAttempt[],
  ): Promise<AcquireResult> {
    // 确保目标目录存在（Fix: 使用 path.dirname 兼容 Windows 反斜杠路径）
    const dir = path.dirname(savePath);
    if (dir && dir !== '.' && dir !== savePath) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.renameSync(tempPath, savePath);
    const sha256 = await computeSha256(savePath);
    const fileSize = fs.statSync(savePath).size;

    this.logger.info('PDF acquired', {
      source,
      fileSize,
      sha256: sha256.slice(0, 8),
      savePath,
    });

    return {
      status: 'success',
      pdfPath: savePath,
      source,
      sha256,
      fileSize,
      attempts,
    };
  }
}

// ═══ 工厂函数 ═══

export function createAcquireService(
  config: AbyssalConfig,
  logger: Logger,
): AcquireService {
  return new AcquireService(config, logger);
}
