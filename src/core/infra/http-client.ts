// ═══ 统一 HTTP 客户端 ═══
// §0.2: 原生 https/http 模块，AbortController 超时，流式下载，代理支持

import * as https from 'node:https';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import type { IncomingMessage, Agent } from 'node:http';
import {
  NetworkError,
  ServerError,
  TimeoutError,
  RateLimitedError,
  AccessDeniedError,
} from '../types/errors';
import type { Logger } from './logger';
import { RateLimiter } from './rate-limiter';

// ─── 配置 ───

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Abyssal/1.0';

export interface HttpClientOptions {
  logger: Logger;
  userAgentEmail?: string | undefined;
  /** 代理 URL（http://, https://, socks5://） */
  proxyUrl?: string | null | undefined;
}

export interface RequestOptions {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  timeoutMs?: number | undefined;
  maxRedirects?: number | undefined;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  url: string;
  durationMs: number;
}

// ─── HttpClient ───

export class HttpClient {
  private readonly logger: Logger;
  private readonly userAgent: string;
  private proxyAgent: Agent | null = null;
  /** Resolves when proxy agent is ready (or immediately if no proxy) */
  private proxyReady: Promise<void> = Promise.resolve();

  constructor(options: HttpClientOptions) {
    this.logger = options.logger;
    this.userAgent = options.userAgentEmail
      ? `Abyssal/1.0 (mailto:${options.userAgentEmail})`
      : USER_AGENT;
    if (options.proxyUrl) {
      this.proxyReady = this.setProxy(options.proxyUrl);
    }
  }

  /**
   * 设置/更改代理。支持 http://, https://, socks5:// 协议。
   * 传入 null 关闭代理。
   * 使用 dynamic import() 因为 proxy-agent 包是 ESM-only。
   */
  async setProxy(proxyUrl: string | null): Promise<void> {
    if (!proxyUrl) {
      this.proxyAgent = null;
      this.logger.info('[HttpClient] Proxy disabled');
      return;
    }
    try {
      const url = new URL(proxyUrl);
      const proto = url.protocol.replace(':', '');

      if (proto === 'socks5' || proto === 'socks5h' || proto === 'socks4') {
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        this.proxyAgent = new SocksProxyAgent(proxyUrl) as unknown as Agent;
      } else if (proto === 'http' || proto === 'https') {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        this.proxyAgent = new HttpsProxyAgent(proxyUrl) as unknown as Agent;
      } else {
        this.logger.warn('[HttpClient] Unknown proxy protocol, ignoring', { proxyUrl });
        return;
      }
      this.logger.info('[HttpClient] Proxy configured', { protocol: proto, host: url.hostname, port: url.port });
    } catch (err) {
      this.logger.error('[HttpClient] Failed to create proxy agent', undefined, {
        proxyUrl, error: (err as Error).message,
      });
    }
  }

  /**
   * 发起 HTTP 请求，返回完整响应体（JSON API 调用场景）。
   * 自动处理重定向。非 2xx 抛出对应错误类型。
   */
  async request(
    url: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse> {
    await this.proxyReady;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
    const method = options.method ?? 'GET';

    let currentUrl = url;
    let redirectCount = 0;
    const startTime = Date.now();
    // Accumulate Set-Cookie headers across redirects (like requests.Session in Python)
    const accumulatedSetCookies: string[] = [];

    while (true) {
      const parsed = new URL(currentUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqHeaders: Record<string, string> = {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
        ...options.headers,
      };

      // Inject accumulated cookies from previous redirects into the request
      if (accumulatedSetCookies.length > 0) {
        const redirectCookies = accumulatedSetCookies
          .map((sc) => { const semi = sc.indexOf(';'); return semi > 0 ? sc.slice(0, semi).trim() : sc.trim(); })
          .filter((c) => c.includes('='));
        if (redirectCookies.length > 0) {
          const existing = reqHeaders['Cookie'] ?? '';
          const merged = existing ? `${existing}; ${redirectCookies.join('; ')}` : redirectCookies.join('; ');
          reqHeaders['Cookie'] = merged;
        }
      }

      const response = await new Promise<{
        res: IncomingMessage;
        body: string;
      }>((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const reqOpts: Record<string, unknown> = {
          method,
          headers: reqHeaders,
          signal: controller.signal,
        };
        if (this.proxyAgent) {
          reqOpts['agent'] = this.proxyAgent;
        }

        const req = transport.request(
          currentUrl,
          reqOpts,
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              clearTimeout(timeoutId);
              resolve({
                res,
                body: Buffer.concat(chunks).toString('utf-8'),
              });
            });
            res.on('error', (err) => {
              clearTimeout(timeoutId);
              reject(err);
            });
          },
        );

        req.on('error', (err) => {
          clearTimeout(timeoutId);
          if (controller.signal.aborted) {
            reject(
              new TimeoutError({
                message: `Request timed out after ${timeoutMs}ms: ${currentUrl}`,
                context: { url: currentUrl, timeoutMs },
              }),
            );
          } else {
            reject(
              new NetworkError({
                message: `Request failed: ${(err as Error).message}`,
                context: { url: currentUrl },
                cause: err as Error,
              }),
            );
          }
        });

        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });

      const { res, body } = response;
      const status = res.statusCode ?? 0;

      this.logger.debug('HTTP response', {
        url: currentUrl,
        status,
        bodySize: body.length,
        durationMs: Date.now() - startTime,
      });

      // Collect Set-Cookie from every response (including redirects)
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
        accumulatedSetCookies.push(...arr);
      }

      // 重定向
      if ([301, 302, 303, 307, 308].includes(status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new NetworkError({
            message: `Too many redirects (${maxRedirects}): ${url}`,
            context: { url, redirectCount: maxRedirects },
          });
        }
        const location = res.headers['location'];
        if (!location) {
          throw new NetworkError({
            message: `Redirect ${status} without Location header: ${currentUrl}`,
            context: { url: currentUrl, status },
          });
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      // 成功 — merge accumulated Set-Cookie into final response headers
      if (status >= 200 && status < 300) {
        const finalHeaders = res.headers as Record<string, string | string[] | undefined>;
        if (accumulatedSetCookies.length > 0) {
          // Ensure all Set-Cookie headers from redirects are included
          const existing = finalHeaders['set-cookie'];
          const existingArr = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
          const allCookies = [...new Set([...accumulatedSetCookies, ...existingArr])];
          finalHeaders['set-cookie'] = allCookies;
        }
        return {
          status,
          headers: finalHeaders,
          body,
          url: currentUrl,
          durationMs: Date.now() - startTime,
        };
      }

      // 错误处理
      this.throwForStatus(status, currentUrl, body, res.headers);
    }
  }

  /** 发起请求并解析 JSON 响应 */
  async requestJson<T>(
    url: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.request(url, options);
    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new NetworkError({
        message: `Invalid JSON response from ${url}`,
        context: { url, bodyPreview: response.body.slice(0, 200) },
      });
    }
  }

  /** POST JSON 并解析 JSON 响应 */
  async postJson<T>(
    url: string,
    payload: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const body = JSON.stringify(payload);
    return this.requestJson<T>(url, {
      ...options,
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        ...options.headers,
      },
    });
  }

  /**
   * 流式下载文件。自动处理重定向。
   * 返回下载完成后的文件元信息。
   */
  async streamDownload(
    url: string,
    destPath: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; fileSizeBytes: number; durationMs: number }> {
    await this.proxyReady;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

    let currentUrl = url;
    let redirectCount = 0;
    const startTime = Date.now();

    while (true) {
      const parsed = new URL(currentUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqHeaders: Record<string, string> = {
        'User-Agent': this.userAgent,
        Accept: 'application/pdf, */*',
        'Accept-Encoding': 'identity',
        ...options.headers,
      };

      const result = await new Promise<
        | { type: 'redirect'; location: string; status: number }
        | { type: 'done'; status: number; fileSizeBytes: number }
      >((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        // 防止 abort + writeStream.error 双重 reject
        let settled = false;
        const safeReject = (err: Error) => { if (!settled) { settled = true; reject(err); } };
        const safeResolve = (v: { type: 'redirect'; location: string; status: number } | { type: 'done'; status: number; fileSizeBytes: number }) => { if (!settled) { settled = true; resolve(v); } };

        const dlOpts: Record<string, unknown> = {
          method: 'GET',
          headers: reqHeaders,
          signal: controller.signal,
        };
        if (this.proxyAgent) {
          dlOpts['agent'] = this.proxyAgent;
        }

        const req = transport.request(
          currentUrl,
          dlOpts,
          (res) => {
            const status = res.statusCode ?? 0;

            // 重定向
            if ([301, 302, 303, 307, 308].includes(status)) {
              res.resume(); // 消费 body
              clearTimeout(timeoutId);
              const location = res.headers['location'];
              if (!location) {
                safeReject(
                  new NetworkError({
                    message: `Redirect ${status} without Location: ${currentUrl}`,
                    context: { url: currentUrl, status },
                  }),
                );
                return;
              }
              safeResolve({
                type: 'redirect',
                location: new URL(location, currentUrl).toString(),
                status,
              });
              return;
            }

            // 非 200
            if (status < 200 || status >= 300) {
              const chunks: Buffer[] = [];
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () => {
                clearTimeout(timeoutId);
                const body = Buffer.concat(chunks).toString('utf-8');
                try {
                  this.throwForStatus(status, currentUrl, body, res.headers);
                } catch (err) {
                  safeReject(err as Error);
                }
              });
              return;
            }

            // 流式写入
            const writeStream = fs.createWriteStream(destPath);
            let written = 0;

            res.on('data', (chunk: Buffer) => {
              written += chunk.length;
            });

            res.pipe(writeStream);

            writeStream.on('finish', () => {
              clearTimeout(timeoutId);
              safeResolve({
                type: 'done',
                status,
                fileSizeBytes: written,
              });
            });

            writeStream.on('error', (err) => {
              clearTimeout(timeoutId);
              fs.unlink(destPath, () => {}); // 清理碎片文件
              safeReject(
                new NetworkError({
                  message: `Write stream error: ${err.message}`,
                  context: { url: currentUrl, destPath },
                  cause: err,
                }),
              );
            });

            controller.signal.addEventListener('abort', () => {
              res.destroy();
              writeStream.destroy();
              fs.unlink(destPath, () => {});
              safeReject(
                new TimeoutError({
                  message: `Download timed out after ${timeoutMs}ms: ${currentUrl}`,
                  context: { url: currentUrl, timeoutMs },
                }),
              );
            });
          },
        );

        req.on('error', (err) => {
          clearTimeout(timeoutId);
          if (controller.signal.aborted) {
            safeReject(
              new TimeoutError({
                message: `Download timed out after ${timeoutMs}ms: ${currentUrl}`,
                context: { url: currentUrl, timeoutMs },
              }),
            );
          } else {
            safeReject(
              new NetworkError({
                message: `Download failed: ${(err as Error).message}`,
                context: { url: currentUrl },
                cause: err as Error,
              }),
            );
          }
        });

        req.end();
      });

      if (result.type === 'redirect') {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new NetworkError({
            message: `Too many redirects (${maxRedirects}): ${url}`,
            context: { url, redirectCount: maxRedirects },
          });
        }
        currentUrl = result.location;
        continue;
      }

      return {
        status: result.status,
        fileSizeBytes: result.fileSizeBytes,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ─── 错误映射 ───

  private throwForStatus(
    status: number,
    url: string,
    body: string,
    headers: Record<string, string | string[] | undefined>,
  ): never {
    if (status === 429) {
      const retryAfter = headers['retry-after'];
      throw new RateLimitedError({
        message: `Rate limited (429): ${url}`,
        context: { url, retryAfter: String(retryAfter ?? '') },
        retryAfterMs: RateLimiter.parseRetryAfter(
          typeof retryAfter === 'string' ? retryAfter : undefined,
          60_000,
        ),
      });
    }
    if (status === 403) {
      throw new AccessDeniedError({
        message: `Access denied (403): ${url}`,
        context: { url },
      });
    }
    if (status >= 500) {
      throw new ServerError({
        message: `Server error (${status}): ${url}`,
        context: { url, status, bodyPreview: body.slice(0, 200) },
      });
    }
    throw new NetworkError({
      message: `HTTP ${status}: ${url}`,
      context: { url, status, bodyPreview: body.slice(0, 200) },
    });
  }
}

// ─── 工具函数 ───

/** 流式计算文件 SHA-256 */
export function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// RateLimiter import 已移至文件顶部
