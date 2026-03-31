// ═══ BibTeX 导出 ═══
// §1.2: PaperMetadata → BibTeX 字符串

import type { PaperMetadata, PaperType } from '../types/paper';
import { generateBibtexKey } from './bibtex-key';

// ─── §1.2.1 PaperType → BibTeX @type ───

const TYPE_MAP: Record<PaperType, string> = {
  journal: 'article',
  conference: 'inproceedings',
  book: 'book',
  chapter: 'incollection',
  preprint: 'misc',
  review: 'article',
  unknown: 'misc',
};

// ─── §1.2.2 标题大括号保护 ───
// Fix #2: 使用双重大括号包裹整个标题（BibTeX 生态标准做法）
// 无需逐词匹配——直接告诉 Biber/BibTeX 保留原始大小写

function protectTitle(title: string): string {
  return `{${title}}`;
  // 导出时字段值已用外层 {} 包裹，最终效果为 title = {{...}}
}

// ─── 格式化 authors → BibTeX author 字段值 ───

function formatAuthors(authors: string[]): string {
  return authors.join(' and ');
}

// ─── §1.2 exportBibtex ───

export function exportBibtex(papers: PaperMetadata[]): string {
  const existingKeys = new Set<string>();
  const entries: Array<{ key: string; text: string }> = [];

  for (const paper of papers) {
    const key = paper.bibtexKey ?? generateBibtexKey(paper, existingKeys);
    existingKeys.add(key);

    const type = TYPE_MAP[paper.paperType] ?? 'misc';
    const fields: Array<[string, string]> = [];

    const add = (name: string, value: string | null | undefined) => {
      if (value != null && value.trim().length > 0) {
        fields.push([name, value]);
      }
    };

    add('title', protectTitle(paper.title));
    if (paper.authors.length > 0) add('author', formatAuthors(paper.authors));
    add('year', String(paper.year));
    add('doi', paper.doi);
    if (paper.arxivId) {
      add('eprint', paper.arxivId);
      add('eprinttype', 'arxiv');
    }
    add('abstract', paper.abstract);
    add('journal', paper.journal);
    add('volume', paper.volume);
    add('number', paper.issue);
    add('pages', paper.pages?.replace(/-/g, '--'));
    add('publisher', paper.publisher);
    add('isbn', paper.isbn);
    add('issn', paper.issn); // Fix #24
    if (paper.editors && paper.editors.length > 0) {
      add('editor', formatAuthors(paper.editors));
    }
    add('booktitle', paper.bookTitle);
    add('series', paper.series);
    add('url', paper.url);

    const fieldLines = fields
      .map(([name, value]) => `  ${name.padEnd(10)} = {${value}}`)
      .join(',\n');

    entries.push({
      key,
      text: `@${type}{${key},\n${fieldLines}\n}`,
    });
  }

  // §1.2: entry 按 key 字母序排列
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries.map((e) => e.text).join('\n\n') + '\n';
}
