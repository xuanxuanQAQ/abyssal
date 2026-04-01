// ═══ Level 3: PubMed Central ═══
// §6.5: PMCID → OA API → FTP tar.gz → 解压提取 PDF
//
// PMC 于 2025 年启用 PoW 反爬，/pdf/ 端点返回 JS challenge 页面，
// 纯 HTTP 客户端无法直接获取 PDF。改用 OA Web Service 获取 FTP 归档链接，
// 下载 tar.gz 后解压提取其中的 PDF。

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';
import { makeAttempt, makeFailedAttempt } from '../attempt-utils';

const ID_CONVERTER = 'https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/';
const OA_SERVICE = 'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi';

/** 默认 200MB 解压上限 */
const DEFAULT_MAX_EXTRACT_BYTES = 200 * 1024 * 1024;

export async function tryPmc(
  http: HttpClient,
  doi: string | null,
  pmcid: string | null,
  tempPath: string,
  timeoutMs: number,
  tarMaxExtractBytes: number = DEFAULT_MAX_EXTRACT_BYTES,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    let effectivePmcid = pmcid;

    // DOI → PMCID 转换（子步骤超时：用总超时的 1/4）
    if (!effectivePmcid && doi) {
      const converterTimeout = Math.min(timeoutMs, Math.floor(timeoutMs / 4) + 5000);
      const converterUrl = `${ID_CONVERTER}?ids=${encodeURIComponent(doi)}&format=json`;
      const data = await http.requestJson<{
        records?: Array<{ pmcid?: string | undefined }> | undefined;
      }>(converterUrl, { timeoutMs: converterTimeout });

      effectivePmcid = data.records?.[0]?.pmcid ?? null;
    }

    if (!effectivePmcid) {
      return makeAttempt('pmc', 'failed', Date.now() - start, {
        failureReason: 'No PMCID available',
        failureCategory: 'no_pdf_url',
      });
    }

    // 通过 OA Web Service 获取 FTP 归档链接（子步骤超时：用总超时的 1/4）
    const oaTimeout = Math.min(timeoutMs, Math.floor(timeoutMs / 4) + 5000);
    const oaUrl = `${OA_SERVICE}?id=${encodeURIComponent(effectivePmcid)}`;
    const oaResponse = await http.request(oaUrl, { timeoutMs: oaTimeout });
    const tgzMatch = oaResponse.body.match(/href="((?:https?|ftp):\/\/[^"]+\.tar\.gz)"/);

    if (!tgzMatch) {
      return makeAttempt('pmc', 'failed', Date.now() - start, {
        failureReason: 'No tar.gz link in OA response (article may not be OA)',
        failureCategory: 'no_pdf_url',
      });
    }

    // FTP 链接转 HTTPS（NCBI 同时提供 HTTPS 镜像）
    let tgzUrl = tgzMatch[1]!;
    tgzUrl = tgzUrl.replace(/^ftp:\/\/ftp\.ncbi\.nlm\.nih\.gov\//, 'https://ftp.ncbi.nlm.nih.gov/');

    // 下载 tar.gz（使用剩余超时时间）
    const tgzPath = tempPath + '.tar.gz';
    const remainingMs = Math.max(5000, timeoutMs - (Date.now() - start));
    await downloadPdf(http, tgzUrl, tgzPath, remainingMs);

    // 解压并提取 PDF（带大小限制）
    const extracted = await extractPdfFromTarGz(tgzPath, tempPath, tarMaxExtractBytes);
    deleteFileIfExists(tgzPath);

    if (!extracted) {
      deleteFileIfExists(tempPath);
      return makeAttempt('pmc', 'failed', Date.now() - start, {
        failureReason: 'No PDF found inside tar.gz archive',
        failureCategory: 'parse_error',
      });
    }

    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return makeAttempt('pmc', 'failed', Date.now() - start, {
        failureReason: validation.reason ?? 'PDF validation failed',
        failureCategory: 'invalid_pdf',
      });
    }

    return makeAttempt('pmc', 'success', Date.now() - start, { httpStatus: 200 });
  } catch (err) {
    deleteFileIfExists(tempPath);
    deleteFileIfExists(tempPath + '.tar.gz');
    return makeFailedAttempt('pmc', start, err);
  }
}

/**
 * 从 tar.gz 归档中提取第一个 .pdf 文件。
 *
 * 流式解析：gzip 解压 → 逐 512 字节读取 tar header → 只有命中 PDF 时才缓冲文件内容。
 * 不写入中间 .tar 文件，内存占用 ≈ PDF 文件大小（而非整个 tar 大小）。
 *
 * @param maxExtractBytes 解压后 PDF 文件大小上限，防止 tar bomb
 */
async function extractPdfFromTarGz(
  tgzPath: string,
  destPath: string,
  maxExtractBytes: number = DEFAULT_MAX_EXTRACT_BYTES,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const input = fs.createReadStream(tgzPath);

    let buf = Buffer.alloc(0);
    let state: 'header' | 'skip' | 'collect' = 'header';
    let currentFileSize = 0;
    let currentPaddedSize = 0;
    let skipped = 0;
    let collected: Buffer[] = [];
    let collectedBytes = 0;
    let found = false;
    let settled = false;

    const finish = (result: boolean, error?: Error) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    const stream = input.pipe(gunzip);

    stream.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      while (buf.length > 0) {
        if (state === 'header') {
          if (buf.length < 512) return; // need full header

          const header = buf.subarray(0, 512);
          buf = buf.subarray(512);

          // Parse name
          const nameBytes = header.subarray(0, 100);
          const nameEnd = nameBytes.indexOf(0);
          const name = nameBytes.subarray(0, nameEnd === -1 ? 100 : nameEnd).toString('utf-8');

          if (!name || name.trim().length === 0) {
            // End-of-archive marker
            finish(false);
            return;
          }

          // Parse size (octal ASCII at offset 124, 12 bytes)
          const sizeStr = header.subarray(124, 136).toString('utf-8').trim();
          currentFileSize = parseInt(sizeStr, 8) || 0;
          currentPaddedSize = Math.ceil(currentFileSize / 512) * 512;

          // Type flag at offset 156: '0' or '\0' = regular file
          const typeFlag = header[156];
          const isFile = typeFlag === 0 || typeFlag === 0x30;

          if (isFile && name.toLowerCase().endsWith('.pdf')) {
            if (currentFileSize > maxExtractBytes) {
              finish(false, new Error(
                `PDF inside tar exceeds size limit: ${currentFileSize} bytes > ${maxExtractBytes} bytes`,
              ));
              return;
            }
            state = 'collect';
            collected = [];
            collectedBytes = 0;
          } else {
            state = 'skip';
            skipped = 0;
          }
        } else if (state === 'skip') {
          const remaining = currentPaddedSize - skipped;
          const consume = Math.min(remaining, buf.length);
          buf = buf.subarray(consume);
          skipped += consume;
          if (skipped >= currentPaddedSize) {
            state = 'header';
          }
        } else if (state === 'collect') {
          // Collect only the actual file bytes (not padding)
          const dataRemaining = currentFileSize - collectedBytes;
          const paddingRemaining = currentPaddedSize - collectedBytes;

          if (dataRemaining > 0) {
            const take = Math.min(dataRemaining, buf.length);
            collected.push(buf.subarray(0, take));
            collectedBytes += take;
            buf = buf.subarray(take);
          }

          // Skip padding bytes after file content
          if (collectedBytes >= currentFileSize) {
            const paddingLeft = currentPaddedSize - collectedBytes;
            if (paddingLeft > 0) {
              const skipPad = Math.min(paddingLeft, buf.length);
              buf = buf.subarray(skipPad);
              collectedBytes += skipPad;
            }
          }

          if (collectedBytes >= currentPaddedSize) {
            // Write collected PDF to disk
            found = true;
            try {
              fs.writeFileSync(destPath, Buffer.concat(collected));
            } catch (err) {
              finish(false, err as Error);
              return;
            }
            finish(true);
            return;
          }
        }
      }
    });

    stream.on('end', () => {
      if (!found) finish(false);
    });

    stream.on('error', (err) => {
      finish(false, err);
    });
  });
}
