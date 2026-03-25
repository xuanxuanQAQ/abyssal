// ═══ RIS 导出 ═══
// §2.3: PaperMetadata → RIS 字符串

import type { PaperMetadata, PaperType } from '../types/paper';

// ─── PaperType → TY ───

const TYPE_MAP: Record<PaperType, string> = {
  journal: 'JOUR',
  conference: 'CONF',
  book: 'BOOK',
  chapter: 'CHAP',
  preprint: 'RPRT',
  review: 'JOUR',
  unknown: 'GEN',
};

function tag(name: string, value: string): string {
  return `${name}  - ${value}`;
}

export function exportRis(papers: PaperMetadata[]): string {
  const records: string[] = [];

  for (const paper of papers) {
    const lines: string[] = [];
    lines.push(tag('TY', TYPE_MAP[paper.paperType] ?? 'GEN'));
    lines.push(tag('TI', paper.title));

    for (const author of paper.authors) {
      lines.push(tag('AU', author));
    }

    lines.push(tag('PY', `${paper.year}///`));

    if (paper.doi) lines.push(tag('DO', paper.doi));
    if (paper.abstract) lines.push(tag('AB', paper.abstract));
    if (paper.journal) lines.push(tag('JO', paper.journal));
    if (paper.volume) lines.push(tag('VL', paper.volume));
    if (paper.issue) lines.push(tag('IS', paper.issue));

    if (paper.pages) {
      const parts = paper.pages.split(/[-–—]/);
      if (parts[0]) lines.push(tag('SP', parts[0].trim()));
      if (parts[1]) lines.push(tag('EP', parts[1].trim()));
    }

    if (paper.publisher) lines.push(tag('PB', paper.publisher));
    if (paper.isbn) lines.push(tag('SN', paper.isbn));
    else if (paper.issn) lines.push(tag('SN', paper.issn));
    if (paper.url) lines.push(tag('UR', paper.url));

    lines.push(tag('ER', ''));
    records.push(lines.join('\n'));
  }

  return records.join('\n\n') + '\n';
}
