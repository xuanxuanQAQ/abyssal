/**
 * Field-level validation for parsed LLM output.
 *
 * - concept_mappings: concept_id existence, relation legality, confidence
 *   normalization, evidence bilingual structure completion (§9.1-9.2)
 * - Language detection heuristic for evidence fields (§9.2)
 *
 * See spec: §9
 */

// ─── Types ───

export interface RawConceptMapping {
  concept_id?: string;
  relation?: string;
  confidence?: unknown;
  evidence?: unknown;
  [key: string]: unknown;
}

export interface ValidatedMapping {
  concept_id: string;
  relation: string;
  confidence: number;
  evidence: BilingualEvidence;
}

export interface BilingualEvidence {
  en: string;
  original: string;
  original_lang: string;
  chunk_id?: string | null;
  page?: number | null;
  annotation_id?: string | null;
}

/** A mapping whose concept_id was unknown — diverted to suggestions. */
export interface DivertedMapping {
  concept_id: string;
  relation: string;
  confidence: number;
  evidence: BilingualEvidence;
}

export interface ValidationResult {
  mappings: ValidatedMapping[];
  /** Mappings with unknown concept_ids, diverted to suggested_new_concepts. */
  divertedToSuggestions: DivertedMapping[];
  warnings: string[];
}

// ─── Valid relation types ───

const VALID_RELATIONS = ['supports', 'challenges', 'extends', 'operationalizes', 'irrelevant'] as const;

// ─── Confidence text-to-number mapping ───

const CONFIDENCE_TEXT_MAP: Record<string, number> = {
  'very high': 0.95,
  'high': 0.85,
  'medium': 0.55,
  'low': 0.25,
  'very low': 0.15,
};

// ─── Main validator (§9.1) ───

export interface ConceptLookup {
  /** Returns true if concept_id exists in the database. */
  exists: (conceptId: string) => boolean;
}

/**
 * Validate concept_mappings array from parsed frontmatter.
 *
 * Per-field checks:
 * - concept_id: presence check; if DB lookup available, unknown IDs are
 *   **diverted** to divertedToSuggestions (not kept in mappings) to prevent
 *   FOREIGN KEY constraint violations on paper_concept_map writes.
 * - relation: must be one of VALID_RELATIONS, defaults to 'supports'
 * - confidence: text→number mapping, range clamping to [0, 1]
 * - evidence: bilingual structure completion
 */
export function validateConceptMappings(
  mappings: unknown[],
  conceptLookup?: ConceptLookup,
): ValidationResult {
  const validated: ValidatedMapping[] = [];
  const divertedToSuggestions: DivertedMapping[] = [];
  const warnings: string[] = [];

  for (const raw of mappings) {
    if (raw == null || typeof raw !== 'object') {
      warnings.push('Skipped non-object mapping entry');
      continue;
    }

    const m = raw as RawConceptMapping;

    // concept_id: required
    if (!m.concept_id || typeof m.concept_id !== 'string') {
      warnings.push('Missing concept_id in mapping');
      continue;
    }

    // relation: validate against whitelist
    let relation = typeof m.relation === 'string' ? m.relation : 'supports';
    if (!VALID_RELATIONS.includes(relation as typeof VALID_RELATIONS[number])) {
      warnings.push(`Invalid relation "${relation}" for concept ${m.concept_id}, defaulting to "supports"`);
      relation = 'supports';
    }

    // confidence: normalize (§9.1)
    const confidence = normalizeConfidence(m.confidence);

    // evidence: bilingual structure completion (§9.2)
    const evidence = normalizeEvidence(m.evidence);

    // concept_id: existence check — unknown IDs are diverted to suggestions
    // to preserve referential integrity (paper_concept_map has FK to concepts).
    if (conceptLookup && !conceptLookup.exists(m.concept_id)) {
      warnings.push(
        `Unknown concept_id "${m.concept_id}" diverted to suggested_new_concepts`,
      );
      divertedToSuggestions.push({
        concept_id: m.concept_id,
        relation,
        confidence,
        evidence,
      });
      continue; // Do NOT add to validated — would break FK constraint
    }

    validated.push({
      concept_id: m.concept_id,
      relation,
      confidence,
      evidence,
    });
  }

  return { mappings: validated, divertedToSuggestions, warnings };
}

// ─── Confidence normalization ───

function normalizeConfidence(raw: unknown): number {
  if (typeof raw === 'number') {
    return Math.max(0, Math.min(1, raw));
  }

  if (typeof raw === 'string') {
    const lower = raw.toLowerCase().trim();
    if (lower in CONFIDENCE_TEXT_MAP) {
      return CONFIDENCE_TEXT_MAP[lower]!;
    }
    const parsed = parseFloat(lower);
    if (!isNaN(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  // Default fallback
  return 0.50;
}

// ─── Evidence bilingual structure completion (§9.2) ───

function normalizeEvidence(evidence: unknown): BilingualEvidence {
  if (evidence == null) {
    return { en: '', original: '', original_lang: 'unknown' };
  }

  if (typeof evidence === 'string') {
    const lang = detectLanguage(evidence);
    return {
      en: evidence,
      original: evidence,
      original_lang: lang,
    };
  }

  if (typeof evidence === 'object' && !Array.isArray(evidence)) {
    const e = evidence as Record<string, unknown>;
    return {
      en: asString(e['en'] ?? e['original'] ?? ''),
      original: asString(e['original'] ?? e['en'] ?? ''),
      original_lang: asString(e['original_lang'] ?? e['originalLang'] ?? 'unknown'),
      chunk_id: asStringOrNull(e['chunk_id'] ?? e['chunkId']),
      page: asNumberOrNull(e['page']),
      annotation_id: asStringOrNull(e['annotation_id'] ?? e['annotationId']),
    };
  }

  return { en: String(evidence), original: String(evidence), original_lang: 'unknown' };
}

// ─── Language detection heuristic (§9.2) ───

/**
 * Simple heuristic language detection.
 * - CJK character ratio > 30% → zh-CN
 * - Japanese kana > 10 chars → ja
 * - Default → en
 */
export function detectLanguage(text: string): string {
  if (!text || text.length === 0) return 'en';

  const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
  const cjkMatches = text.match(cjkPattern);
  const cjkRatio = (cjkMatches?.length ?? 0) / text.length;

  if (cjkRatio > 0.3) return 'zh-CN';

  // Japanese detection (hiragana/katakana)
  const jpPattern = /[\u3040-\u30ff]/g;
  const jpMatches = text.match(jpPattern);
  if ((jpMatches?.length ?? 0) > 10) return 'ja';

  return 'en';
}

// ─── Helpers ───

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v === 'string') return v;
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
