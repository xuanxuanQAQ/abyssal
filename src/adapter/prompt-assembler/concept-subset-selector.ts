/**
 * Concept Subset Selector — six-level relevance scoring for prompt injection.
 *
 * §4.1: filterConceptSubset() — select ≤15 most relevant concepts from framework.
 *
 * Six scoring dimensions:
 *   1. Annotation anchoring (+10): researcher already linked concept to paper
 *   2. Keyword matching (0-10, capped): title/abstract term overlap
 *   3. Citation network mapping (0-7.5, capped): neighbor papers mapped to concept
 *   4. Maturity bonus (0-3): tentative +3, working +1, established +0
 *   5. Parent inclusion: ensure selected child's parent is included
 *   6. Semantic neighbor supplement: if < 3 selected, add by embedding similarity
 *
 * Max theoretical score: 30.5
 */

// ─── Types ───

export interface ConceptForSubset {
  id: string;
  nameEn: string;
  nameZh: string;
  definition: string;
  searchKeywords: string[];
  maturity: 'tentative' | 'working' | 'established';
  parentId: string | null;
}

export interface PaperForSubset {
  id: string;
  title: string;
  abstract: string | null;
}

export interface ScoredConceptResult {
  concept: ConceptForSubset;
  annotationScore: number;
  keywordScore: number;
  networkScore: number;
  maturityBonus: number;
  totalScore: number;
}

export interface SubsetResult {
  concepts: ConceptForSubset[];
  extraInstruction: string | null;
  fullInjection: boolean;
}

// ─── Database interface ───

export interface SubsetSelectorDb {
  /** Count annotations linking this concept to this paper */
  countAnnotationsForConcept: (paperId: string, conceptId: string) => number;
  /** Get paper IDs that cite or are cited by the given paper */
  getCitationNeighbors: (paperId: string) => string[];
  /** Count how many of the given paper IDs have mappings to this concept */
  countMappingsForConcept: (conceptId: string, paperIds: string[]) => number;
}

// ─── Embedder interface (for semantic neighbor supplement) ───

import type { EmbedFunction } from '../../core/types/common';

/** @deprecated Use EmbedFunction directly */
export type SubsetEmbedder = EmbedFunction;

// ─── Cross-discipline instruction ───

const CROSS_DISCIPLINE_INSTRUCTION =
  "The paper may use different terminology from your concept framework. " +
  "This is common in cross-disciplinary research. Please:\n" +
  "1. Look for semantic equivalences between the paper's terms and defined concepts.\n" +
  "2. If a concept is discussed under a different name, note the terminological " +
  "mapping in your analysis.\n" +
  "3. If no mapping is found, report the concept as \"irrelevant\" with low confidence " +
  "and explain the terminology gap.";

// ─── §4.1: Main selector ───

/**
 * Select the most relevant concept subset for a paper.
 *
 * If allConcepts ≤ maxSize, return all (no filtering needed).
 * If all scores = 0, return full set with cross-discipline instruction.
 * Otherwise, return top-N by score + parent inclusion + semantic neighbors.
 */
export function filterConceptSubset(
  allConcepts: ConceptForSubset[],
  paper: PaperForSubset,
  db: SubsetSelectorDb | null,
  maxSize: number = 15,
): SubsetResult {
  if (allConcepts.length <= maxSize) {
    return { concepts: allConcepts, extraInstruction: null, fullInjection: true };
  }

  // Six-level scoring
  const scored = allConcepts.map((concept) => ({
    concept,
    ...computeRelevanceScore(concept, paper, db),
  }));

  // Sort by total score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // All scores = 0 → cross-disciplinary scenario
  if (scored[0]!.totalScore === 0) {
    return {
      concepts: allConcepts.slice(0, maxSize),
      extraInstruction: CROSS_DISCIPLINE_INSTRUCTION,
      fullInjection: false,
    };
  }

  // Take top-N
  let selected = scored.slice(0, maxSize).map((s) => s.concept);

  // §4.4: Parent inclusion
  selected = ensureParentInclusion(selected, allConcepts);

  // §4.5: Semantic neighbor supplement (if < 3 selected)
  // NOTE: synchronous version — semantic supplement requires async embedder
  // and is deferred to the async wrapper below
  if (selected.length < 3) {
    // Pad with next-highest-scoring unselected concepts (sync fallback)
    const selectedIds = new Set(selected.map((c) => c.id));
    for (const entry of scored) {
      if (selected.length >= 3) break;
      if (!selectedIds.has(entry.concept.id)) {
        selected.push(entry.concept);
        selectedIds.add(entry.concept.id);
      }
    }
  }

  return { concepts: selected, extraInstruction: null, fullInjection: false };
}

/**
 * Async version with semantic neighbor supplement via embedding similarity.
 *
 * embedder is provided by LlmClient.asEmbedFunction().
 */
export async function filterConceptSubsetAsync(
  allConcepts: ConceptForSubset[],
  paper: PaperForSubset,
  db: SubsetSelectorDb | null,
  embedder: EmbedFunction | null,
  maxSize: number = 15,
): Promise<SubsetResult> {
  // Start with sync selection
  const syncResult = filterConceptSubset(allConcepts, paper, db, maxSize);

  // If we have enough or no embedder, return sync result
  if (syncResult.concepts.length >= 3 || !embedder) {
    return syncResult;
  }

  // Semantic neighbor supplement
  const selected = await supplementWithSemanticNeighbors(
    syncResult.concepts,
    allConcepts,
    paper,
    embedder,
    3,
  );

  return { ...syncResult, concepts: selected };
}

// ─── §4.2: Six-level scoring ───

export function computeRelevanceScore(
  concept: ConceptForSubset,
  paper: PaperForSubset,
  db: SubsetSelectorDb | null,
): {
  annotationScore: number;
  keywordScore: number;
  networkScore: number;
  maturityBonus: number;
  totalScore: number;
} {
  let annotationScore = 0;
  let rawKeywordScore = 0;
  let networkScore = 0;
  let maturityBonus = 0;

  // ═══ Dimension 1: Annotation anchoring (0 or +10) ═══
  if (db) {
    try {
      const count = db.countAnnotationsForConcept(paper.id, concept.id);
      if (count > 0) annotationScore = 10.0;
    } catch {
      // DB failure → skip
    }
  }

  // ═══ Dimension 2: Keyword matching (0-10, capped) ═══
  const titleLower = paper.title.toLowerCase();
  const abstractLower = (paper.abstract ?? '').toLowerCase();

  // Concept name as implicit keyword
  const nameLower = concept.nameEn.toLowerCase();
  if (nameLower && titleLower.includes(nameLower)) rawKeywordScore += 4.0;
  if (nameLower && abstractLower.includes(nameLower)) rawKeywordScore += 3.0;

  // Explicit search keywords
  for (const keyword of concept.searchKeywords) {
    const kw = keyword.toLowerCase();
    if (titleLower.includes(kw)) rawKeywordScore += 3.0;
    if (abstractLower.includes(kw)) rawKeywordScore += 2.0;
  }

  const keywordScore = Math.min(rawKeywordScore, 10.0);

  // ═══ Dimension 3: Citation network mapping (0-7.5, capped) ═══
  if (db) {
    try {
      const neighbors = db.getCitationNeighbors(paper.id);
      if (neighbors.length > 0) {
        const neighborMappings = db.countMappingsForConcept(concept.id, neighbors);
        networkScore = Math.min(neighborMappings * 1.5, 7.5);
      }
    } catch {
      // DB failure → skip
    }
  }

  // ═══ Dimension 4: Maturity bonus (0-3) ═══
  if (concept.maturity === 'tentative') maturityBonus = 3.0;
  else if (concept.maturity === 'working') maturityBonus = 1.0;
  // established: 0

  const totalScore = annotationScore + keywordScore + networkScore + maturityBonus;
  return { annotationScore, keywordScore, networkScore, maturityBonus, totalScore };
}

// ─── §4.4: Parent inclusion ───

/**
 * Ensure that if a child concept is selected, its direct parent is also included.
 * Does NOT recurse to grandparents — if the grandparent is important,
 * its own score should be high enough to enter top-15.
 */
function ensureParentInclusion(
  selected: ConceptForSubset[],
  allConcepts: ConceptForSubset[],
): ConceptForSubset[] {
  const result = [...selected];
  const allMap = new Map(allConcepts.map((c) => [c.id, c]));
  const resultIds = new Set(result.map((c) => c.id));

  for (const concept of selected) {
    if (concept.parentId && !resultIds.has(concept.parentId)) {
      const parent = allMap.get(concept.parentId);
      if (parent) {
        result.push(parent);
        resultIds.add(parent.id);
      }
    }
  }

  return result;
}

// ─── §4.5: Semantic neighbor supplement ───

/** LRU cache for concept definition embeddings (keyed by concept ID). */
interface CachedEmbedding {
  embedding: Float32Array;
  /** Definition text that was embedded — invalidate if definition changes */
  defHash: string;
  createdAt: number;
}
const conceptEmbeddingCache = new Map<string, CachedEmbedding>();
const CONCEPT_CACHE_MAX = 200;
/** Cache entries expire after 1 hour to prevent stale embeddings */
const CONCEPT_CACHE_TTL_MS = 60 * 60 * 1000;

/** Simple string hash for definition change detection */
function quickHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

async function getCachedOrEmbed(
  concepts: ConceptForSubset[],
  embedder: EmbedFunction,
): Promise<Float32Array[]> {
  const now = Date.now();
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];
  const result: (Float32Array | null)[] = new Array(concepts.length).fill(null);

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i]!;
    const cached = conceptEmbeddingCache.get(concept.id);
    const defHash = quickHash(concept.definition);
    // Cache hit only if: entry exists, definition unchanged, and not expired
    if (cached && cached.defHash === defHash && (now - cached.createdAt) < CONCEPT_CACHE_TTL_MS) {
      result[i] = cached.embedding;
    } else {
      if (cached) conceptEmbeddingCache.delete(concept.id); // Invalidate stale entry
      uncachedIndices.push(i);
      uncachedTexts.push(concept.definition);
    }
  }

  if (uncachedTexts.length === 0) {
    return result as Float32Array[];
  }

  const embeddings = await embedder.embed(uncachedTexts);
  for (let j = 0; j < uncachedIndices.length; j++) {
    const idx = uncachedIndices[j]!;
    const emb = embeddings[j]!;
    result[idx] = emb;
    // Evict oldest if cache full
    if (conceptEmbeddingCache.size >= CONCEPT_CACHE_MAX) {
      const firstKey = conceptEmbeddingCache.keys().next().value as string;
      conceptEmbeddingCache.delete(firstKey);
    }
    conceptEmbeddingCache.set(concepts[idx]!.id, {
      embedding: emb,
      defHash: quickHash(concepts[idx]!.definition),
      createdAt: now,
    });
  }
  return result as Float32Array[];
}

/**
 * If fewer than minCount concepts are selected, supplement with
 * semantically similar concepts using embedding cosine similarity.
 *
 * Uses LRU cache for concept definition embeddings to avoid redundant API calls.
 */
async function supplementWithSemanticNeighbors(
  selected: ConceptForSubset[],
  allConcepts: ConceptForSubset[],
  paper: PaperForSubset,
  embedder: EmbedFunction,
  minCount: number,
): Promise<ConceptForSubset[]> {
  if (selected.length >= minCount) return selected;

  const selectedIds = new Set(selected.map((c) => c.id));
  const remaining = allConcepts.filter((c) => !selectedIds.has(c.id));

  if (remaining.length === 0) return selected;

  // Embed paper abstract/title
  const paperText = paper.abstract ?? paper.title;
  const [paperEmbedding] = await embedder.embed([paperText]);
  if (!paperEmbedding) return selected;

  // Embed remaining concept definitions (with cache)
  const conceptEmbeddings = await getCachedOrEmbed(remaining, embedder);

  // Score by cosine similarity
  const scored = remaining.map((concept, i) => ({
    concept,
    similarity: cosineSimilarity(paperEmbedding, conceptEmbeddings[i]!),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  const needed = minCount - selected.length;
  const supplements = scored.slice(0, needed).map((s) => s.concept);

  return [...selected, ...supplements];
}

function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ─── §4.6: Concept subset prompt formatting ───

/**
 * Format the concept subset into a prompt-ready block with maturity instructions.
 */
export function formatConceptSubset(
  subsetResult: SubsetResult,
  totalConceptCount: number,
  tokenCounter: { count: (text: string) => number },
): { text: string; tokens: number; conceptCount: number } {
  const lines: string[] = [];

  if (subsetResult.fullInjection) {
    lines.push(`# Concept Framework (all ${subsetResult.concepts.length} concepts)`);
  } else {
    lines.push(
      `# Concept Framework (${subsetResult.concepts.length} of ${totalConceptCount} concepts, selected by relevance)`,
    );
  }
  lines.push('');

  for (const concept of subsetResult.concepts) {
    lines.push(`### ${concept.nameEn} (${concept.nameZh})`);
    lines.push(`- **ID**: ${concept.id}`);
    lines.push(`- **Definition**: ${concept.definition}`);
    lines.push(`- **Keywords**: ${concept.searchKeywords.join(', ')}`);
    lines.push(`- **Maturity**: ${concept.maturity.toUpperCase()}`);

    if (concept.parentId) {
      lines.push(`- **Parent**: ${concept.parentId}`);
    }

    // Maturity-specific instructions (§4.6)
    if (concept.maturity === 'tentative') {
      lines.push('');
      lines.push('**⚠️ Special Instruction for this concept:**');
      lines.push('This concept is TENTATIVE. Please:');
      lines.push('1. Critically evaluate whether the paper supports this conceptualization.');
      lines.push('2. If a better framing exists, describe it AND add to `suggested_new_concepts`.');
      lines.push('3. Note relationships to different but semantically related terms.');
      lines.push('4. Low confidence (< 0.5) is expected and acceptable.');
    } else if (concept.maturity === 'established') {
      lines.push('');
      lines.push(
        '_This concept is ESTABLISHED. Focus on evidence quality rather than questioning the concept._',
      );
    }

    lines.push('');
  }

  if (subsetResult.extraInstruction) {
    lines.push(subsetResult.extraInstruction);
  }

  const text = lines.join('\n');
  const tokens = tokenCounter.count(text);

  return { text, tokens, conceptCount: subsetResult.concepts.length };
}

// ─── Debug: score all concepts ───

export function scoreAllConcepts(
  allConcepts: ConceptForSubset[],
  paper: PaperForSubset,
  db: SubsetSelectorDb | null,
): ScoredConceptResult[] {
  return allConcepts.map((concept) => ({
    concept,
    ...computeRelevanceScore(concept, paper, db),
  }));
}
