/**
 * Evidence Normalizer — bilingual evidence structure normalization.
 *
 * §9.1-9.2: Handles five input cases:
 *   Case 1: null/undefined → empty structure
 *   Case 2: plain string → detect language, fill both en + original
 *   Case 3: structured object → field-priority resolution + optional field补全
 *   Case 4: other types (array, number) → stringify fallback
 *
 * Language detection enhanced with Korean support (§9.2).
 */

// ─── Types ───

export interface NormalizedEvidence {
  en: string;
  original: string;
  original_lang: string;
  chunk_id: string | null;
  page: number | null;
  annotation_id: string | null;
}

// ─── §9.1: Main normalizer ───

/**
 * Normalize evidence from any LLM output format into bilingual structure.
 */
export function normalizeEvidence(evidence: unknown): NormalizedEvidence {
  // Case 1: null / undefined
  if (evidence == null) {
    return { en: '', original: '', original_lang: 'unknown', chunk_id: null, page: null, annotation_id: null };
  }

  // Case 2: plain string
  if (typeof evidence === 'string') {
    const lang = detectLanguage(evidence);
    return {
      en: evidence.trim(),
      original: evidence.trim(),
      original_lang: lang,
      chunk_id: null,
      page: null,
      annotation_id: null,
    };
  }

  // Case 3: structured object
  if (typeof evidence === 'object' && !Array.isArray(evidence)) {
    const e = evidence as Record<string, unknown>;

    // en field — priority: en > english > text > ''
    const en = asString(e['en'] ?? e['english'] ?? e['text'] ?? '').trim();

    // original field — priority: original > source > text > en backfill
    let original = asString(e['original'] ?? e['source'] ?? e['text'] ?? '').trim();

    // original_lang — priority: original_lang > originalLang > lang > detect
    const originalLang = asString(
      e['original_lang'] ?? e['originalLang'] ?? e['lang'] ?? '',
    ).trim();

    // Backfill: if en empty but original exists, or vice versa
    const finalEn = en.length > 0 ? en : original;
    const finalOriginal = original.length > 0 ? original : en;
    const finalLang = originalLang.length > 0 ? originalLang : detectLanguage(finalOriginal);

    return {
      en: finalEn,
      original: finalOriginal,
      original_lang: finalLang,
      chunk_id: asStringOrNull(e['chunk_id'] ?? e['chunkId']),
      page: asNumberOrNull(e['page']),
      annotation_id: asStringOrNull(e['annotation_id'] ?? e['annotationId']),
    };
  }

  // Case 4: other types (array, number, boolean)
  const str = String(evidence);
  return {
    en: str,
    original: str,
    original_lang: 'unknown',
    chunk_id: null,
    page: null,
    annotation_id: null,
  };
}

// ─── §9.2: Language detection heuristic (enhanced) ───

/**
 * Simple heuristic language detection.
 * - CJK character ratio > 30% → zh-CN
 * - Japanese kana > 10 chars → ja
 * - Korean Hangul > 10 chars → ko
 * - Default → en
 */
export function detectLanguage(text: string): string {
  if (!text || text.length === 0) return 'unknown';

  // CJK (Chinese)
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const cjkRatio = cjkChars / text.length;
  if (cjkRatio > 0.3) return 'zh-CN';

  // Fix #12: Use ratio threshold instead of absolute count for short texts
  // Japanese (Hiragana + Katakana)
  const jpChars = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) ?? []).length;
  if (jpChars > 0 && (jpChars / text.length > 0.1 || jpChars > 10)) return 'ja';

  // Korean (Hangul)
  const krChars = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
  if (krChars > 0 && (krChars / text.length > 0.1 || krChars > 10)) return 'ko';

  return 'en';
}

// ─── Helpers ───

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

function asNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}
