// ═══ 流式下载器 ═══
// §7: 基于 infra/http-client 的 PDF 下载封装

import * as fs from 'node:fs';
import type { HttpClient } from '../infra/http-client';
import { computeSha256 } from '../infra/http-client';

export { computeSha256 };

export interface DownloadResult {
  fileSizeBytes: number;
  durationMs: number;
}

/**
 * 下载 PDF 到临时路径。
 * 使用 HttpClient.streamDownload 处理重定向和超时。
 */
export async function downloadPdf(
  http: HttpClient,
  url: string,
  destPath: string,
  timeoutMs: number = 30_000,
  headers?: Record<string, string>,
): Promise<DownloadResult> {
  const result = await http.streamDownload(url, destPath, {
    timeoutMs,
    headers,
  });

  return {
    fileSizeBytes: result.fileSizeBytes,
    durationMs: result.durationMs,
  };
}

/** 安全删除文件（不存在时不抛错） */
export function deleteFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // 忽略删除失败
  }
}
