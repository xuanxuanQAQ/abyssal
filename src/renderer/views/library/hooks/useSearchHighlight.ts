/**
 * useSearchHighlight — 搜索高亮计算（§13）
 *
 * token 分割 → 子串匹配 → 区间合并 → [普通段, 高亮段] 交替数组。
 * useMemo([title, searchQuery])。
 */

import { useMemo } from 'react';

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * 计算高亮分段
 */
export function computeHighlightSegments(
  text: string,
  query: string
): HighlightSegment[] {
  if (!query.trim()) {
    return [{ text, highlighted: false }];
  }

  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return [{ text, highlighted: false }];
  }

  // 收集所有匹配区间
  const intervals: Array<[number, number]> = [];
  const lowerText = text.toLowerCase();

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    let pos = 0;
    while (pos < lowerText.length) {
      const idx = lowerText.indexOf(lowerToken, pos);
      if (idx === -1) break;
      intervals.push([idx, idx + lowerToken.length]);
      pos = idx + 1;
    }
  }

  if (intervals.length === 0) {
    return [{ text, highlighted: false }];
  }

  // 合并重叠区间
  intervals.sort((a, b) => a[0] - b[0]);
  const first = intervals[0];
  if (!first) return [{ text, highlighted: false }];
  const merged: Array<[number, number]> = [first];
  for (let i = 1; i < intervals.length; i++) {
    const curr = intervals[i];
    const last = merged[merged.length - 1];
    if (!curr || !last) continue;
    if (curr[0] <= last[1]) {
      last[1] = Math.max(last[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }

  // 构建交替数组
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (cursor < start) {
      segments.push({ text: text.slice(cursor, start), highlighted: false });
    }
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

  return segments;
}

export function useSearchHighlight(title: string, searchQuery: string): HighlightSegment[] {
  return useMemo(
    () => computeHighlightSegments(title, searchQuery),
    [title, searchQuery]
  );
}
