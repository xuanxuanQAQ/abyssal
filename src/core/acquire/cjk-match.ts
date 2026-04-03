// ═══ CJK 标题标准化 & 相似度匹配 ═══
// 供 CNKI / Wanfang 等中文源共享使用

/**
 * 标准化 CJK 标题：去空白、去中英标点、小写化。
 */
export function normalizeCjk(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、；：？！\u201c\u201d\u2018\u2019（）【】《》\u3000]/g, '')
    .replace(/[,.\-;:?!'"()[\]<>{}]/g, '')
    .trim();
}

/**
 * CJK 感知的标题相似度（字符级 Jaccard 系数）。
 * 返回 0~1，1 = 完全匹配。
 */
export function cjkTitleMatch(query: string, candidate: string): number {
  const q = normalizeCjk(query);
  const c = normalizeCjk(candidate);
  if (q === c) return 1.0;
  if (q.length === 0 || c.length === 0) return 0;

  const setQ = new Set([...q]);
  const setC = new Set([...c]);
  const intersection = [...setQ].filter((ch) => setC.has(ch)).length;
  const union = new Set([...setQ, ...setC]).size;
  return union > 0 ? intersection / union : 0;
}
