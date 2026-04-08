/**
 * IPC handler: web-reader namespace
 *
 * Contract channels: web:import, fs:openWebArticle
 *
 * 处理网页资料的导入（抓取 + Readability 提取）和读取。
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { HttpClient } from '../../core/infra/http-client';
import { WebReaderService } from '../../core/web-reader';
import { asPaperId } from '../../core/types/common';

export function registerWebReaderHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── web:import ──
  // 抓取网页 → Readability 提取 → 保存 Markdown → 创建 paper 记录
  typedHandler('web:import', logger, async (_e, url) => {
    // Validate URL scheme to prevent SSRF (file://, ftp://, internal addresses)
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported URL scheme: ${parsed.protocol} — only http/https are allowed`);
    }
    // Block requests to private/internal networks
    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      throw new Error(`Blocked request to private network address: ${hostname}`);
    }

    // 1. 抓取 + 提取
    const proxyUrl = ctx.config.acquire?.proxyEnabled ? ctx.config.acquire.proxyUrl : null;
    const http = new HttpClient({ logger, proxyUrl });
    const webReader = new WebReaderService(http, logger);
    const article = await webReader.extract(url);

    // 2. 生成 paper ID
    const { generatePaperId } = await import('../../core/search/paper-id');
    const paperId = generatePaperId(null, null, article.title, url);

    // 3. 保存 Markdown 文件到 workspace/web-articles/{paperId}.md
    const webDir = path.join(ctx.workspaceRoot, 'web-articles');
    await fs.mkdir(webDir, { recursive: true });
    const mdPath = path.join(webDir, `${paperId}.md`);

    // 只存正文 Markdown（元信息由前端源栏和 paper 记录展示，不混入正文）
    await fs.writeFile(mdPath, article.markdown, 'utf-8');

    // 4. 同时保存纯文本文件到 texts/ 目录供 RAG 索引
    const textsDir = path.join(ctx.workspaceRoot, 'texts');
    await fs.mkdir(textsDir, { recursive: true });
    const textPath = path.join(textsDir, `${paperId}.txt`);
    // 纯文本：去掉 markdown 格式标记
    const plainText = article.markdown
      .replace(/^#+\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')    // 去掉图片标记
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    await fs.writeFile(textPath, plainText, 'utf-8');

    // 5. 创建 paper 记录
    const year = article.publishedDate
      ? new Date(article.publishedDate).getFullYear()
      : new Date().getFullYear();

    const authors = article.author
      ? article.author.split(/[,;、]/).map((a) => a.trim()).filter(Boolean)
      : [];

    await ctx.dbProxy.addPaper({
      id: paperId,
      title: article.title,
      authors,
      year: Number.isNaN(year) ? new Date().getFullYear() : year,
      doi: null,
      arxivId: null,
      venue: article.siteName,
      journal: null,
      volume: null,
      issue: null,
      pages: null,
      publisher: article.siteName,
      isbn: null,
      edition: null,
      editors: null,
      bookTitle: null,
      series: null,
      issn: null,
      pmid: null,
      pmcid: null,
      url: url,
      abstract: article.excerpt,
      citationCount: null,
      paperType: 'webpage',
      source: 'web',
      bibtexKey: null,
      biblioComplete: false,
      sourceUrl: url,
    } as any);

    // 6. 更新 fulltext 状态
    await ctx.dbProxy.updatePaper(paperId as any, {
      fulltextStatus: 'available',
      fulltextPath: mdPath,
      fulltextSource: 'web',
      textPath,
    } as any);

    // 7. 通知前端
    ctx.pushManager?.enqueueDbChange(['papers'], 'insert');

    // 8. 自动触发 process 管线（分块 → 嵌入 → RAG 索引）
    if (ctx.orchestrator) {
      try {
        ctx.orchestrator.start('process' as never, { paperIds: [paperId] } as never);
      } catch (err) {
        logger.warn('Auto-process after web import failed', { paperId, error: (err as Error).message });
      }
    }

    logger.info('Web article imported', { paperId, title: article.title, url });
    return { paperId, title: article.title };
  }, { timeoutMs: 60_000 });

  // ── fs:openWebArticle ──
  // 读取已保存的网页文章 Markdown 内容
  typedHandler('fs:openWebArticle', logger, async (_e, paperId) => {
    const paper = await ctx.dbProxy.getPaper(asPaperId(paperId)) as Record<string, unknown> | null;
    if (!paper) {
      const err = new Error('Paper not found');
      (err as any).code = 'PAPER_NOT_FOUND';
      (err as any).recoverable = false;
      throw err;
    }

    const fulltextPath = (paper['fulltextPath'] ?? paper['fulltext_path']) as string | null;
    if (!fulltextPath) {
      const err = new Error('Web article has no content file');
      (err as any).code = 'NO_CONTENT';
      (err as any).recoverable = true;
      throw err;
    }

    const resolvedPath = path.isAbsolute(fulltextPath)
      ? fulltextPath
      : path.join(ctx.workspaceRoot, fulltextPath);

    if (!existsSync(resolvedPath)) {
      const err = new Error(`Web article file missing on disk: ${path.basename(resolvedPath)}`);
      (err as any).code = 'FILE_NOT_FOUND';
      (err as any).recoverable = true;
      throw err;
    }

    const markdown = await fs.readFile(resolvedPath, 'utf-8');
    const sourceUrl = (paper['sourceUrl'] ?? paper['source_url'] ?? '') as string;
    const title = (paper['title'] ?? '') as string;

    return { markdown, sourceUrl, title };
  });
}
