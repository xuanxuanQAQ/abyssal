/**
 * Concept Subset Selector — three-dimensional relevance scoring.
 *
 * Selects ≤15 most relevant concepts from the full framework for prompt injection.
 *
 * Three dimensions:
 * 1. Keyword hit (0-10): title/abstract keyword matching
 * 2. Citation network neighbor mapping (0-7.5): how many neighbors map to this concept
 * 3. Maturity bonus (0-3): tentative +3, working +1, established +0
 *
 * See spec: §3
 */

// ─── Types ───

export interface ConceptForScoring {
  id: string;
  nameEn: string;
  nameZh: string;
  definition: string;
  searchKeywords: string[];
  maturity: 'tentative' | 'working' | 'established';
}

export interface PaperForScoring {
  id: string;
  title: string;
  abstract: string | null;
}

export interface SubsetResult {
  concepts: ConceptForScoring[];
  extraInstruction: string | null;
}

export interface ScoredConcept {
  concept: ConceptForScoring;
  keywordScore: number;
  networkScore: number;
  maturityBonus: number;
  totalScore: number;
}

// ─── Database queries interface ───

export interface SubsetSelectorDb {
  /** Get paper IDs that cite or are cited by the given paper (depth=1) */
  getCitationNeighbors: (paperId: string) => string[];
  /** Count how many of the given paper IDs have mappings to this concept */
  countMappingsForConcept: (conceptId: string, paperIds: string[]) => number;
}

// ─── Main selector (§3.3) ───

/**
 * Select the most relevant concept subset for a paper.
 *
 * @param allConcepts - Full concept framework (non-deprecated)
 * @param paper - Current paper being analyzed
 * @param db - Database queries for citation network scoring
 * @param maxSubsetSize - Maximum concepts to select (default 15)
 */
export function selectConceptSubsetEnhanced(
  allConcepts: ConceptForScoring[],
  paper: PaperForScoring,
  db: SubsetSelectorDb | null,
  maxSubsetSize: number = 15,
): SubsetResult {
  if (allConcepts.length <= maxSubsetSize) {
    return { concepts: allConcepts, extraInstruction: null };
  }

  // Score all concepts
  const scored = allConcepts.map((concept) => ({
    concept,
    ...computeConceptRelevance(concept, paper, db),
  }));

  // Sort by total score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // Special case: all scores are 0 (cross-disciplinary terminology gap)
  // Still respect maxSubsetSize to avoid exceeding token budgets
  if (scored[0]!.totalScore === 0) {
    return {
      concepts: allConcepts.slice(0, maxSubsetSize),
      extraInstruction:
        "The paper may use different terminology from your concept framework. " +
        "Please identify semantic equivalences between the paper's terms and the defined concepts.",
    };
  }

  const subset = scored.slice(0, maxSubsetSize).map((s) => s.concept);
  return { concepts: subset, extraInstruction: null };
}

/**
 * Compute scores for all concepts against a paper (for debugging/UI).
 */
export function scoreAllConcepts(
  allConcepts: ConceptForScoring[],
  paper: PaperForScoring,
  db: SubsetSelectorDb | null,
): ScoredConcept[] {
  return allConcepts.map((concept) => ({
    concept,
    ...computeConceptRelevance(concept, paper, db),
  }));
}

// ─── Three-dimensional scoring function (§3.2) ───

function computeConceptRelevance(
  concept: ConceptForScoring,
  paper: PaperForScoring,
  db: SubsetSelectorDb | null,
): { keywordScore: number; networkScore: number; maturityBonus: number; totalScore: number } {
  // ── Dimension 1: Keyword hit (0-10) ──
  let rawKeywordScore = 0;
  const titleLower = paper.title.toLowerCase();
  const abstractLower = (paper.abstract ?? '').toLowerCase();

  for (const keyword of concept.searchKeywords) {
    const kw = keyword.toLowerCase();
    if (titleLower.includes(kw)) rawKeywordScore += 3.0;
    if (abstractLower.includes(kw)) rawKeywordScore += 2.0;
  }

  // Concept name as implicit keyword
  const nameLower = concept.nameEn.toLowerCase();
  if (nameLower && titleLower.includes(nameLower)) rawKeywordScore += 4.0;
  if (nameLower && abstractLower.includes(nameLower)) rawKeywordScore += 3.0;

  const keywordScore = Math.min(rawKeywordScore, 10.0);

  // ── Dimension 2: Citation network neighbor mapping (0-7.5) ──
  let networkScore = 0;
  if (db) {
    try {
      const neighbors = db.getCitationNeighbors(paper.id);
      if (neighbors.length > 0) {
        const neighborMappings = db.countMappingsForConcept(concept.id, neighbors);
        networkScore = Math.min(neighborMappings * 1.5, 7.5);
      }
    } catch {
      // DB query failure → skip network scoring silently
    }
  }

  // ── Dimension 3: Maturity bonus (0-3) ──
  let maturityBonus = 0;
  if (concept.maturity === 'tentative') maturityBonus = 3.0;
  else if (concept.maturity === 'working') maturityBonus = 1.0;
  // established: 0 — already has sufficient mappings

  const totalScore = keywordScore + networkScore + maturityBonus;
  return { keywordScore, networkScore, maturityBonus, totalScore };
}
