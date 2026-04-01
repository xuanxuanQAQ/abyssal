// ═══ Layer 3: Speculative Executor — Promise.any 投机并行下载 ═══
// 将 top N 候选并行下载，首个成功立即返回并取消其余。
// 每个候选分配独立临时文件，通过 AbortController 实现取消。

import type { HttpClient } from '../infra/http-client';
import type { AcquireAttempt } from '../types';
import type { Logger } from '../infra/logger';
import type { DownloadCandidate } from './strategy';
import { downloadPdf, deleteFileIfExists } from './downloader';
import { validatePdf } from './pdf-validator';
import { makeAttempt, makeFailedAttempt } from './attempt-utils';
import { preflight } from './preflight';

// ─── Types ───

export interface SpeculativeResult {
  /** 获胜候选（全失败时为 null） */
  winner: DownloadCandidate | null;
  /** 获胜候选的临时文件路径 */
  pdfTempPath: string | null;
  /** 所有候选的尝试记录 */
  attempts: AcquireAttempt[];
}

export interface SpeculativeExecuteParams {
  candidates: DownloadCandidate[];
  baseTempPath: string;
  http: HttpClient;
  maxParallel: number;
  perCandidateTimeoutMs: number;
  totalTimeoutMs: number;
  enablePreflight: boolean;
  preflightTimeoutMs: number;
  logger: Logger;
}

// ─── 单候选执行 ───

async function executeCandidate(
  candidate: DownloadCandidate,
  tempPath: string,
  http: HttpClient,
  timeoutMs: number,
  enablePreflight: boolean,
  preflightTimeoutMs: number,
  sharedAbort: AbortSignal,
  logger: Logger,
): Promise<{ attempt: AcquireAttempt; tempPath: string }> {
  const start = Date.now();

  // 检查是否已被取消（另一个候选已成功）
  if (sharedAbort.aborted) {
    throw new Error('Aborted by winning candidate');
  }

  let downloadUrl = candidate.url;

  // ── Preflight ──
  // Skip preflight for candidates flagged as known direct PDF links
  if (enablePreflight && !candidate.skipPreflight) {
    const pf = await preflight({
      url: candidate.url,
      http,
      timeoutMs: preflightTimeoutMs,
      extractHtmlLinks: true,
      headers: candidate.headers,
      logger,
    });

    if (sharedAbort.aborted) throw new Error('Aborted by winning candidate');

    if (!pf.isPdf && pf.extractedPdfUrls.length > 0) {
      // HTML 页面中提取到了 PDF URL → 使用第一个
      downloadUrl = pf.extractedPdfUrls[0]!;
      logger.debug('[SpecExec] Preflight extracted PDF URL', {
        candidate: candidate.source,
        original: candidate.url,
        extracted: downloadUrl,
      });
    } else if (!pf.isPdf && pf.contentType?.includes('text/html')) {
      // HTML 但没提取到 PDF → 仍尝试下载（可能是误判）
      logger.debug('[SpecExec] Preflight detected HTML, no PDF extracted, trying anyway', {
        candidate: candidate.source,
      });
    }
  }

  if (sharedAbort.aborted) throw new Error('Aborted by winning candidate');

  // ── Download ──
  // Pass sharedAbort so the download is truly cancelled when another candidate wins,
  // rather than consuming bandwidth until timeout or completion.
  await downloadPdf(http, downloadUrl, tempPath, timeoutMs, candidate.headers, sharedAbort);

  // ── Validate ──
  const validation = await validatePdf(tempPath);
  if (!validation.valid) {
    deleteFileIfExists(tempPath);
    throw new Error(validation.reason ?? 'PDF validation failed');
  }

  return {
    attempt: makeAttempt(candidate.source, 'success', Date.now() - start, { httpStatus: 200 }),
    tempPath,
  };
}

// ─── 投机执行器 ───

/**
 * Phase A: 对 simpleCandidates 取 top N 并行执行。
 *
 * 使用 Promise.any()：首个成功立即返回，取消其余。
 * 全部失败时收集所有错误记录。
 *
 * 每个候选写入独立临时文件（baseTempPath.spec.0, .spec.1, ...）。
 */
export async function speculativeExecute(
  params: SpeculativeExecuteParams,
): Promise<SpeculativeResult> {
  const {
    candidates, baseTempPath, http,
    maxParallel, perCandidateTimeoutMs, totalTimeoutMs,
    enablePreflight, preflightTimeoutMs, logger,
  } = params;

  if (candidates.length === 0) {
    return { winner: null, pdfTempPath: null, attempts: [] };
  }

  // 取 top N
  const selected = candidates.slice(0, maxParallel);
  const tempPaths = selected.map((_, i) => `${baseTempPath}.spec.${i}`);
  const attempts: AcquireAttempt[] = [];

  // 共享取消控制器
  const sharedController = new AbortController();

  // 总超时
  const totalTimeout = setTimeout(() => {
    sharedController.abort();
  }, totalTimeoutMs);

  logger.info('[SpecExec] Starting speculative execution', {
    candidateCount: selected.length,
    sources: selected.map((c) => `${c.source}(${c.score})`).join(', '),
  });

  try {
    // 为每个候选创建 promise
    const promises = selected.map(async (candidate, index) => {
      const tempPath = tempPaths[index]!;
      try {
        const result = await executeCandidate(
          candidate, tempPath, http,
          perCandidateTimeoutMs, enablePreflight, preflightTimeoutMs,
          sharedController.signal, logger,
        );
        return { ...result, candidate, index };
      } catch (err) {
        // 记录失败但不阻止 Promise.any 继续等待其他候选
        const attempt = sharedController.signal.aborted && (err as Error).message.includes('Aborted')
          ? makeAttempt(candidate.source, 'skipped', Date.now(), { failureReason: 'Aborted by winner' })
          : makeFailedAttempt(candidate.source, Date.now(), err);
        attempts.push(attempt);
        throw err;
      }
    });

    // Promise.any: 第一个成功的 resolve
    const winner = await Promise.any(promises);

    // 成功！取消其余
    sharedController.abort();

    // 清理其他临时文件
    for (let i = 0; i < tempPaths.length; i++) {
      if (i !== winner.index) {
        deleteFileIfExists(tempPaths[i]!);
      }
    }

    // 记录成功的 attempt
    attempts.push(winner.attempt);

    logger.info('[SpecExec] Winner', {
      source: winner.candidate.source,
      score: winner.candidate.score,
      durationMs: winner.attempt.durationMs,
    });

    return {
      winner: winner.candidate,
      pdfTempPath: winner.tempPath,
      attempts,
    };
  } catch (err) {
    // AggregateError: 全部失败
    sharedController.abort();

    // 清理所有临时文件
    for (const tp of tempPaths) {
      deleteFileIfExists(tp);
    }

    // 如果是 AggregateError，attempts 已在各 promise 的 catch 中填充
    // 如果不是（总超时等），补充记录
    if (!(err instanceof AggregateError)) {
      for (const candidate of selected) {
        if (!attempts.some((a) => a.source === candidate.source)) {
          attempts.push(makeAttempt(candidate.source, 'timeout', totalTimeoutMs, {
            failureReason: 'Speculative execution total timeout',
            failureCategory: 'timeout',
          }));
        }
      }
    }

    logger.info('[SpecExec] All candidates failed', {
      attemptCount: attempts.length,
      summary: attempts.map((a) => `${a.source}:${a.status}`).join(', '),
    });

    return { winner: null, pdfTempPath: null, attempts };
  } finally {
    clearTimeout(totalTimeout);
  }
}
