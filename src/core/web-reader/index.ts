/**
 * Web Reader Service — 抓取网页 + Readability 提取正文
 *
 * 使用已有 HttpClient 获取 HTML，jsdom + @mozilla/readability 提取正文，
 * 通过 DOM 遍历构建 Markdown，保留段落结构。
 */

// @ts-expect-error jsdom types not installed — runtime works fine
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';

// ─── Types ───

export interface WebArticleResult {
  title: string;
  author: string | null;
  publishedDate: string | null;
  siteName: string | null;
  /** Markdown 正文（不含元信息 header） */
  markdown: string;
  excerpt: string | null;
  sourceUrl: string;
}

// ─── DOM → Markdown（遍历而非 regex） ───

function domToMarkdown(root: Element): string {
  const lines: string[] = [];

  /** 提取文本并清除 &nbsp; / 全角空格等不可见缩进字符 */
  function getTextContent(node: Node): string {
    return (node.textContent ?? '')
      .replace(/[\u00A0\u3000]/g, ' ')   // &nbsp; + 全角空格 → 半角空格
      .replace(/\s+/g, ' ')
      .trim();
  }

  function processNode(node: Node): void {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = (node.textContent ?? '')
        .replace(/[\u00A0\u3000]/g, ' ')
        .replace(/[ \t]+/g, ' ');
      if (text.trim()) lines.push(text.trim());
      return;
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

    const el = node as Element;
    const tag = el.tagName?.toLowerCase() ?? '';

    // 跳过不可见元素
    if (tag === 'style' || tag === 'script' || tag === 'noscript') return;

    switch (tag) {
      case 'h1':
        lines.push('', `# ${getTextContent(el)}`, '');
        return;
      case 'h2':
        lines.push('', `## ${getTextContent(el)}`, '');
        return;
      case 'h3':
        lines.push('', `### ${getTextContent(el)}`, '');
        return;
      case 'h4':
      case 'h5':
      case 'h6':
        lines.push('', `**${getTextContent(el)}**`, '');
        return;

      case 'p': {
        const text = getTextContent(el);
        if (text) lines.push('', text, '');
        return;
      }

      case 'br':
        lines.push('');
        return;

      case 'hr':
        lines.push('', '---', '');
        return;

      case 'strong':
      case 'b': {
        const text = getTextContent(el);
        if (text) lines.push(`**${text}**`);
        return;
      }

      case 'em':
      case 'i': {
        const text = getTextContent(el);
        if (text) lines.push(`*${text}*`);
        return;
      }

      case 'a': {
        const href = el.getAttribute('href') ?? '';
        const text = getTextContent(el);
        if (text && href) lines.push(`[${text}](${href})`);
        else if (text) lines.push(text);
        return;
      }

      case 'img': {
        const src = el.getAttribute('src') ?? '';
        const alt = el.getAttribute('alt') ?? '';
        if (src) lines.push(`![${alt}](${src})`);
        return;
      }

      case 'li': {
        const text = getTextContent(el);
        if (text) lines.push(`- ${text}`);
        return;
      }

      case 'ul':
      case 'ol':
        lines.push('');
        for (const child of Array.from(el.childNodes)) processNode(child);
        lines.push('');
        return;

      case 'blockquote': {
        const text = getTextContent(el);
        if (text) {
          lines.push('');
          for (const line of text.split('\n')) {
            lines.push(`> ${line.trim()}`);
          }
          lines.push('');
        }
        return;
      }

      case 'table': {
        // 简化表格处理：每行一个文本块
        const rows = el.querySelectorAll('tr');
        if (rows.length > 0) {
          lines.push('');
          for (const row of Array.from(rows)) {
            const cells = row.querySelectorAll('th, td');
            const cellTexts = Array.from(cells).map((c) => getTextContent(c));
            lines.push(`| ${cellTexts.join(' | ')} |`);
          }
          lines.push('');
        }
        return;
      }

      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'figure':
      case 'figcaption':
      case 'header':
      case 'footer':
      case 'aside':
      case 'span':
      default:
        // 递归处理子节点
        for (const child of Array.from(el.childNodes)) {
          processNode(child);
        }
        // block 级元素后加空行
        if (tag === 'div' || tag === 'section' || tag === 'article') {
          lines.push('');
        }
        return;
    }
  }

  processNode(root);

  // 后处理：合并连续空行，清理首尾
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 清理 Readability 提取的标题
 */
function cleanTitle(raw: string): string {
  let title = raw;
  title = title.replace(/[\s]*[-|_—–][\s]*[^-|_—–]+$/, '');
  title = title.replace(/^【(.+)】$/, '$1');
  return title.trim() || raw;
}

// ─── Service ───

export class WebReaderService {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly logger: Logger,
  ) {}

  async extract(url: string): Promise<WebArticleResult> {
    this.logger.info('[WebReader] Fetching URL', { url });

    const response = await this.httpClient.request(url, {
      timeoutMs: 30_000,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (response.status >= 400) {
      throw new Error(`Failed to fetch URL: HTTP ${response.status}`);
    }

    const html = response.body;
    this.logger.info('[WebReader] HTML fetched', { url, contentLength: html.length });

    // Readability 提取
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error('Readability failed to extract article content from the page');
    }

    // 用 DOM 遍历构建 Markdown（而非 regex 替换）
    const contentDom = new JSDOM(article.content);
    const markdown = domToMarkdown(contentDom.window.document.body);

    this.logger.info('[WebReader] Article extracted', {
      title: article.title,
      author: article.byline,
      contentLength: markdown.length,
    });

    // 元数据
    const doc = dom.window.document;
    let publishedDate: string | null = null;
    for (const selector of [
      'meta[property="article:published_time"]',
      'meta[name="publishdate"]',
      'meta[name="publish_date"]',
      'meta[name="DC.date"]',
      'time[datetime]',
    ]) {
      const el = doc.querySelector(selector);
      if (el) {
        const v = el.getAttribute('content') ?? el.getAttribute('datetime');
        if (v) { publishedDate = v; break; }
      }
    }

    const siteName =
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? null;

    // 作者提取：Readability byline → meta 标签 → 正文末尾署名
    let author = article.byline ?? null;
    if (!author) {
      for (const sel of [
        'meta[name="author"]',
        'meta[property="article:author"]',
        'meta[name="DC.creator"]',
        'meta[name="source"]',
      ]) {
        const el = doc.querySelector(sel);
        if (el) {
          const v = el.getAttribute('content')?.trim();
          if (v) { author = v; break; }
        }
      }
    }
    // 从正文末尾检测中文署名（常见于政府公文：最后几行短文本为署名机构）
    if (!author && markdown) {
      const lines = markdown.split('\n').filter((l) => l.trim());
      const tail = lines.slice(-5);
      const signatureLines = tail.filter((l) => {
        const t = l.trim();
        return t.length > 2 && t.length <= 30 && !/[。；，、]$/.test(t) && !/^\d/.test(t);
      });
      if (signatureLines.length > 0) {
        author = signatureLines.filter((l) => !/^\d{4}年/.test(l.trim())).join('、') || null;
      }
    }

    const title = cleanTitle(article.title || new URL(url).hostname);
    const excerpt = article.excerpt ?? (article.textContent?.slice(0, 500).trim() ?? null);

    return {
      title,
      author,
      publishedDate,
      siteName,
      markdown,
      excerpt,
      sourceUrl: url,
    };
  }
}
