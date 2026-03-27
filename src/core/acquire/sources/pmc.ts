// ═══ Level 3: PubMed Central ═══
// §6.5: PMCID → OA API → FTP tar.gz → 解压提取 PDF
//
// PMC 于 2025 年启用 PoW 反爬，/pdf/ 端点返回 JS challenge 页面，
// 纯 HTTP 客户端无法直接获取 PDF。改用 OA Web Service 获取 FTP 归档链接，
// 下载 tar.gz 后解压提取其中的 PDF。

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { AcquireAttempt } from '../../types';
import type { HttpClient } from '../../infra/http-client';
import { downloadPdf, deleteFileIfExists } from '../downloader';
import { validatePdf } from '../pdf-validator';

const ID_CONVERTER = 'https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/';
const OA_SERVICE = 'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi';

export async function tryPmc(
  http: HttpClient,
  doi: string | null,
  pmcid: string | null,
  tempPath: string,
  timeoutMs: number,
): Promise<AcquireAttempt> {
  const start = Date.now();

  try {
    let effectivePmcid = pmcid;

    // DOI → PMCID 转换
    if (!effectivePmcid && doi) {
      const converterUrl = `${ID_CONVERTER}?ids=${encodeURIComponent(doi)}&format=json`;
      const data = await http.requestJson<{
        records?: Array<{ pmcid?: string | undefined }> | undefined;
      }>(converterUrl, { timeoutMs });

      effectivePmcid = data.records?.[0]?.pmcid ?? null;
    }

    if (!effectivePmcid) {
      return {
        source: 'pmc',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: 'No PMCID available',
        httpStatus: null,
      };
    }

    // 通过 OA Web Service 获取 FTP 归档链接
    const oaUrl = `${OA_SERVICE}?id=${encodeURIComponent(effectivePmcid)}`;
    const oaResponse = await http.request(oaUrl, { timeoutMs });
    const tgzMatch = oaResponse.body.match(/href="((?:https?|ftp):\/\/[^"]+\.tar\.gz)"/);

    if (!tgzMatch) {
      return {
        source: 'pmc',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: 'No tar.gz link in OA response (article may not be OA)',
        httpStatus: null,
      };
    }

    // FTP 链接转 HTTPS（NCBI 同时提供 HTTPS 镜像）
    let tgzUrl = tgzMatch[1]!;
    tgzUrl = tgzUrl.replace(/^ftp:\/\/ftp\.ncbi\.nlm\.nih\.gov\//, 'https://ftp.ncbi.nlm.nih.gov/');

    // 下载 tar.gz
    const tgzPath = tempPath + '.tar.gz';
    await downloadPdf(http, tgzUrl, tgzPath, timeoutMs);

    // 解压并提取 PDF
    const extracted = await extractPdfFromTarGz(tgzPath, tempPath);
    deleteFileIfExists(tgzPath);

    if (!extracted) {
      deleteFileIfExists(tempPath);
      return {
        source: 'pmc',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: 'No PDF found inside tar.gz archive',
        httpStatus: null,
      };
    }

    const validation = await validatePdf(tempPath);

    if (!validation.valid) {
      deleteFileIfExists(tempPath);
      return {
        source: 'pmc',
        status: 'failed',
        durationMs: Date.now() - start,
        failureReason: validation.reason ?? 'PDF validation failed',
        httpStatus: null,
      };
    }

    return {
      source: 'pmc',
      status: 'success',
      durationMs: Date.now() - start,
      failureReason: null,
      httpStatus: 200,
    };
  } catch (err) {
    deleteFileIfExists(tempPath);
    deleteFileIfExists(tempPath + '.tar.gz');
    return {
      source: 'pmc',
      status: 'failed',
      durationMs: Date.now() - start,
      failureReason: (err as Error).message,
      httpStatus: null,
    };
  }
}

/**
 * 从 tar.gz 归档中提取第一个 .pdf 文件。
 *
 * tar 格式：每个文件由 512 字节 header + 文件内容（按 512 字节对齐）组成。
 * 这里用手动解析避免引入额外依赖。
 */
async function extractPdfFromTarGz(
  tgzPath: string,
  destPath: string,
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
        const dataStart = offset + 512;
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
