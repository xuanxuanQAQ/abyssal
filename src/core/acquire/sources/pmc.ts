// ═══ Level 3: PubMed Central ═══
// §6.5: PMCID → OA API → FTP tar.gz → 解压提取 PDF
//
// PMC 于 2025 年启用 PoW 反爬，/pdf/ 端点返回 JS challenge 页面，
// 纯 HTTP 客户端无法直接获取 PDF。改用 OA Web Service 获取 FTP 归档链接，
// 下载 tar.gz 后解压提取其中的 PDF。

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
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
 * tar 格式：每个文件由 512 字节 header + 文件内容（按 512 字节对齐）组成。
 * 这里用手动解析避免引入额外依赖。
 *
 * @param maxExtractBytes 解压后 PDF 文件大小上限，防止 tar bomb
 */
async function extractPdfFromTarGz(
  tgzPath: string,
  destPath: string,
  maxExtractBytes: number = DEFAULT_MAX_EXTRACT_BYTES,
): Promise<boolean> {
  // 解压 gzip
  const rawPath = tgzPath + '.tar';
  const gunzip = zlib.createGunzip();
  const input = fs.createReadStream(tgzPath);
  const output = fs.createWriteStream(rawPath);
  await pipeline(input, gunzip, output);

  // 解析 tar 找 PDF
  try {
    const tarBuf = fs.readFileSync(rawPath);
    let offset = 0;

    while (offset + 512 <= tarBuf.length) {
      // tar header: 前 100 字节是文件名
      const nameBytes = tarBuf.subarray(offset, offset + 100);
      const nameEnd = nameBytes.indexOf(0);
      const name = nameBytes.subarray(0, nameEnd === -1 ? 100 : nameEnd).toString('utf-8');

      if (!name || name.trim().length === 0) break; // 结束标记

      // 文件大小在 offset+124 处，8 进制 ASCII，12 字节
      const sizeStr = tarBuf.subarray(offset + 124, offset + 136).toString('utf-8').trim();
      const fileSize = parseInt(sizeStr, 8) || 0;

      // 类型标志在 offset+156，'0' 或 '\0' 表示普通文件
      const typeFlag = tarBuf[offset + 156];
      const isFile = typeFlag === 0 || typeFlag === 0x30; // '\0' or '0'

      if (isFile && name.toLowerCase().endsWith('.pdf')) {
        // 大小限制检查
        if (fileSize > maxExtractBytes) {
          throw new Error(
            `PDF inside tar exceeds size limit: ${fileSize} bytes > ${maxExtractBytes} bytes`,
          );
        }

        const dataStart = offset + 512;
        // 验证 buffer 边界：确保 tar 内声称的大小不超出实际数据
        if (dataStart + fileSize > tarBuf.length) {
          throw new Error(
            `Truncated tar: header claims ${fileSize} bytes but only ${tarBuf.length - dataStart} available`,
          );
        }

        const pdfData = tarBuf.subarray(dataStart, dataStart + fileSize);
        fs.writeFileSync(destPath, pdfData);
        return true;
      }

      // 跳到下一个文件：header(512) + data(按 512 对齐)
      const dataBlocks = Math.ceil(fileSize / 512);
      offset += 512 + dataBlocks * 512;
    }

    return false;
  } finally {
    deleteFileIfExists(rawPath);
  }
}
