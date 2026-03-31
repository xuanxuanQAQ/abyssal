// ═══ BibTeX Key 自动生成 ═══
// §1.3: 第一作者姓 + 年份 + 标题首实词 + 冲突后缀

import type { PaperMetadata } from '../types/paper';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are',
  'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should',
]);

/**
 * 生成 BibTeX citation key。
 * 格式：第一作者姓小写 + 年份 + 标题第一个实词小写
 */
export function generateBibtexKey(
  paper: Partial<PaperMetadata>,
  existingKeys?: Set<string> | undefined,
): string {
  // 1. 第一作者姓
  let authorPart = 'unknown';
  if (paper.authors && paper.authors.length > 0) {
    const first = paper.authors[0]!;
    const commaIdx = first.indexOf(',');
    const lastName = commaIdx >= 0 ? first.slice(0, commaIdx) : first;
    authorPart = lastName.toLowerCase().replace(/[^a-z]/g, '');
  }
  if (!authorPart) authorPart = 'unknown';

  // 2. 年份
  const yearPart = paper.year ? String(paper.year) : 'nodate';

  // 3. 标题第一个实词
  let titlePart = '';
  if (paper.title) {
    const words = paper.title.split(/\s+/);
    for (const word of words) {
      const clean = word.toLowerCase().replace(/[^a-z]/g, '');
      if (clean.length > 0 && !STOP_WORDS.has(clean)) {
        titlePart = clean;
        break;
      }
    }
  }
  if (!titlePart) titlePart = 'untitled';

  // 4. 拼接 + 特殊字符过滤
  let key = `${authorPart}${yearPart}${titlePart}`.replace(/[^a-z0-9\-_:]/g, '');

  // 5. 冲突处理
  // Fix #20: a-z 耗尽后扩展到数字后缀（aa, ab, ... 或 2, 3, ...）
  if (existingKeys && existingKeys.has(key)) {
    let resolved = false;
    // 先尝试 a-z
    for (let suffix = 97; suffix <= 122; suffix++) {
      const candidate = key + String.fromCharCode(suffix);
      if (!existingKeys.has(candidate)) {
        key = candidate;
        resolved = true;
        break;
      }
    }
    // a-z 耗尽，使用数字后缀 2, 3, 4, ...
    if (!resolved) {
      for (let n = 2; n < 1000; n++) {
        const candidate = key + String(n);
        if (!existingKeys.has(candidate)) {
          key = candidate;
          break;
        }
      }
    }
  }

  return key;
}
