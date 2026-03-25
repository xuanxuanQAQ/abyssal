// ═══ 统一 HTTP 客户端 ═══
// §0.2: 原生 https/http 模块，AbortController 超时，流式下载

import * as https from 'node:https';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import type { IncomingMessage } from 'node:http';
import {
  NetworkError,
  ServerError,
  TimeoutError,
  RateLimitedError,
  AccessDeniedError,
} from '../types/errors';
import type { Logger } from './logger';

// ─── 配置 ───

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Abyssal/1.0';

export interface HttpClientOptions {
  logger: Logger;
  userAgentEmail?: string | undefined;
}

export interface RequestOptions {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
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

  constructor(options: HttpClientOptions) {
    this.logger = options.logger;
    this.userAgent = options.userAgentEmail
      ? `Abyssal/1.0 (mailto:${options.userAgentEmail})`
      : USER_AGENT;
  }

  /**
   * 发起 HTTP 请求，返回完整响应体（JSON API 调用场景）。
   * 自动处理重定向。非 2xx 抛出对应错误类型。
   */
  async request(
    url: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
    const method = options.method ?? 'GET';

    let currentUrl = url;
    let redirectCount = 0;
    const startTime = Date.now();

    while (true) {
      const parsed = new URL(currentUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqHeaders: Record<string, string> = {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
        ...options.headers,
      };

      const response = await new Promise<{
        res: IncomingMessage;
        body: string;
      }>((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const req = transport.request(
          currentUrl,
          {
            method,
            headers: reqHeaders,
            signal: controller.signal,
          },
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

      // 成功
      if (status >= 200 && status < 300) {
        return {
          status,
          headers: res.headers as Record<string, string | string[] | undefined>,
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

  /**
   * 流式下载文件。自动处理重定向。
   * 返回下载完成后的文件元信息。
   */
  async streamDownload(
    url: string,
    destPath: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; fileSizeBytes: number; durationMs: number }> {
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

        const req = transport.request(
          currentUrl,
          {
            method: 'GET',
            headers: reqHeaders,
            signal: controller.signal,
          },
          (res) => {
            const status = res.statusCode ?? 0;

            // 重定向
            if ([301, 302, 303, 307, 308].includes(status)) {
              res.resume(); // 消费 body
              clearTimeout(timeoutId);
              const location = res.headers['location'];
              if (!location) {
                reject(
                  new NetworkError({
                    message: `Redirect ${status} without Location: ${currentUrl}`,
                    context: { url: currentUrl, status },
                  }),
                );
                return;
              }
              resolve({
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
                  reject(err);
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
              resolve({
                type: 'done',
                status,
                fileSizeBytes: written,
              });
            });

            writeStream.on('error', (err) => {
              clearTimeout(timeoutId);
              fs.unlink(destPath, () => {}); // 清理碎片文件
              reject(
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
              // 清理中断产生的碎片文件
              fs.unlink(destPath, () => {});
              reject(
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
            reject(
              new TimeoutError({
                message: `Download timed out after ${timeoutMs}ms: ${currentUrl}`,
                context: { url: currentUrl, timeoutMs },
              }),
            );
          } else {
            reject(
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

// 供 throwForStatus 引用
import { RateLimiter } from './rate-limiter';
