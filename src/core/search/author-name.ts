// ═══ 作者名解析 ═══
// §2.6: "Erving Goffman" → "Goffman, Erving"

const SURNAME_PREFIXES = new Set([
  'van', 'von', 'de', 'du', 'di', 'del', 'della', 'dos', 'das',
  'den', 'der', 'el', 'al', 'la', 'le', 'ibn', 'ben', 'bin',
  'bint', 'ap', 'ab', 'mac', 'mc',
]);

/** 英文姓名后缀（不是姓的一部分，需要剥离后重新附着到姓上） */
const NAME_SUFFIXES = new Set([
  'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v',
  'esq', 'esq.', 'phd', 'ph.d.', 'md', 'm.d.',
]);

/**
 * 将全名字符串转为 "LastName, FirstName" 格式。
 *
 * 规则：
 * 1. 已含逗号 → 保留原格式
 * 2. 剥离尾部后缀（Jr., Sr., III 等）
 * 3. 单词 → 视为姓
 * 4. 多词 → 最后一词为姓，其余为名
 * 5. 复合姓：最后两词中第一词是小写介词 → 合并为姓
 * 6. 如有后缀，附着到姓后（"King Jr., Martin Luther"）
 */
export function parseAuthorName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return trimmed;

  // 已含逗号
  if (trimmed.includes(',')) return trimmed;

  const parts = trimmed.split(/\s+/);

  // 剥离尾部后缀（Jr., Sr., III 等）
  let suffix = '';
  while (
    parts.length > 1 &&
    NAME_SUFFIXES.has(parts[parts.length - 1]!.toLowerCase())
  ) {
    suffix = suffix ? `${parts.pop()} ${suffix}` : parts.pop()!;
  }

  // 单词
  if (parts.length === 1) {
    const base = parts[0]!;
    return suffix ? `${base} ${suffix}` : base;
  }

  // 复合姓检测
  if (parts.length >= 3) {
    const penultimate = parts[parts.length - 2]!;
    if (SURNAME_PREFIXES.has(penultimate.toLowerCase())) {
      const surnameBase = parts.slice(-2).join(' ');
      const surname = suffix ? `${surnameBase} ${suffix}` : surnameBase;
      const givenNames = parts.slice(0, -2).join(' ');
      return givenNames ? `${surname}, ${givenNames}` : surname;
    }
  }

  // 标准拆分：最后一词为姓
  const surnameBase = parts[parts.length - 1]!;
  const surname = suffix ? `${surnameBase} ${suffix}` : surnameBase;
  const givenNames = parts.slice(0, -1).join(' ');
  return givenNames ? `${surname}, ${givenNames}` : surname;
}

/** 批量解析作者名 */
export function parseAuthorNames(names: string[]): string[] {
  return names.map(parseAuthorName);
}
