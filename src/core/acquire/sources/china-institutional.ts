// ═══ Level 4.5: China Institutional ═══
// §6.6b: 通过中国高校机构认证（CARSI/Shibboleth）下载论文
// 依赖 BrowserWindow 登录流获取的 session cookies

import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import type { CookieJar } from '../../infra/cookie-jar';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';
import { resolvePublisher, resolvePublisherByDomain, getCookieDomainsForHost } from '../publisher-resolver';

const SOURCE_NAME = 'china-institutional';

/**
 * Attempt to download a PDF using session cookies obtained from institutional login.
 *
 * Flow:
 * 1. Resolve DOI → publisher pattern → candidate PDF URL
 *    (优先使用 Recon 提供的 publisherDomain / pdfUrl)
 * 2. Check CookieJar has cookies for that publisher's domains
 * 3. Download with cookies attached
 * 4. Validate the result is a real PDF (not a login page redirect)
 */
export async function tryChinaInstitutional(
  http: HttpClient,
  doi: string,
  cookieJar: CookieJar,
  tempPath: string,
  timeoutMs: number,
  /** Recon 阶段获得的出版商域名（DOI HEAD 重定向最终 hostname） */
  reconPublisherDomain?: string | null,
  /** Recon 阶段获得的 PDF 下载 URL（来自 OpenAlex/CrossRef） */
  reconPdfUrl?: string | null,
): Promise<AcquireAttempt> {
  const start = Date.now();

  // 优先使用 Recon 域名做反查，回退到 DOI 前缀匹配
  const reconPattern = reconPublisherDomain
    ? resolvePublisherByDomain(reconPublisherDomain)
    : null;
  const publisher = reconPattern ?? resolvePublisher(doi);

  // Cookie 域名：reconPattern → publisher.cookieDomains → 从 hostname 推断
  const cookieDomains = publisher.cookieDomains.length > 0
    ? publisher.cookieDomains
    : reconPublisherDomain
      ? getCookieDomainsForHost(reconPublisherDomain)
      : [];

  // Check if we have cookies for this publisher
  if (!cookieJar.hasCookiesFor(cookieDomains)) {
    return makeAttempt(SOURCE_NAME, 'skipped', Date.now() - start, {
      failureReason: `No active session for ${publisher.name}. Login required.`,
    });
  }

  try {
    // 优先使用 Recon 提供的 PDF URL，回退到 publisher 模板构造
    const pdfUrl = reconPdfUrl ?? publisher.resolvePdfUrl(doi);
    const cookieHeader = cookieJar.getCookieHeader(pdfUrl);

    const headers: Record<string, string> = {
      Accept: 'application/pdf,*/*',
      // Referer helps some publishers accept the request
      Referer: new URL(pdfUrl).origin + '/',
      // Spoof UA: IEEE/Elsevier WAF blocks non-browser User-Agents
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    await downloadPdf(http, pdfUrl, tempPath, timeoutMs, headers);

    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);

      // Detect session expiry: publisher returned an HTML login page instead of PDF
      const reason = validation.reason ?? 'PDF validation failed';
      const isSessionExpired =
        reason.includes('not a PDF') ||
        reason.includes('HTML') ||
        reason.includes('magic') ||
        reason.includes('signature');

      return makeAttempt(SOURCE_NAME, 'failed', Date.now() - start, {
        failureReason: isSessionExpired
          ? `Session expired for ${publisher.name} — institutional re-login required`
          : `${publisher.name}: ${reason}`,
        failureCategory: isSessionExpired ? 'session_expired' : 'invalid_pdf',
      });
    }

    return makeAttempt(SOURCE_NAME, 'success', Date.now() - start, {
      httpStatus: 200,
    });
  } catch (err) {
    deleteFileIfExists(tempPath);
    return makeFailedAttempt(SOURCE_NAME, start, err);
  }
}
