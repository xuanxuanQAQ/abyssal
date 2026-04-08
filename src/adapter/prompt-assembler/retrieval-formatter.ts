/**
 * Retrieval Formatter — RAG passage diversity truncation + prompt formatting.
 *
 * §6.2: truncateRagPassages() — two-pass diversity-aware truncation:
 *   Pass 1: Select highest-score chunk per unique paper
 *   Pass 2: Fill remaining budget with additional chunks
 *
 * §6.3: formatRetrievalResult() — group by paper, annotation/memo sources first.
 */

// ─── Types ───

export interface RagPassage {
  paperId: string;
  paperTitle: string;
  year?: number;
  sectionTitle?: string;
  text: string;
  score: number;
  tokenCount: number;
  positionRatio?: number; // 0.0 (start) to 1.0 (end) within paper
  source: 'paper' | 'annotation' | 'memo' | 'note' | 'private';
  page?: number;
  date?: string;
}

// ─── §6.2: Diversity-aware RAG truncation ───

/**
 * Truncate RAG passages to fit within targetTokens using score-decay diversity.
 *
 * Fix #6: MMR-style score decay instead of hard "one per paper" first pass.
 * Each paper's subsequent chunks get a 0.85^N multiplier on their raw score,
 * so high-quality chunks from the same paper can still beat low-quality chunks
 * from diverse papers.
 *
 * @param decayFactor - Per-paper score decay (default 0.85). Set to 0 for no diversity.
 */
export function truncateRagPassages(
  passages: RagPassage[],
  targetTokens: number,
  decayFactor: number = 0.85,
): RagPassage[] {
  const paperSelectionCount = new Map<string, number>(); // paperId → # already selected
  const result: RagPassage[] = [];
  let totalTokens = 0;

  // Build candidate list with adjusted scores
  const candidates = passages.map((p) => ({ passage: p, selected: false }));

  while (true) {
    // Compute adjusted scores for remaining candidates
    let bestIdx = -1;
    let bestAdjustedScore = -1;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      if (c.selected) continue;
      if (totalTokens + c.passage.tokenCount > targetTokens) continue;

      const n = paperSelectionCount.get(c.passage.paperId) ?? 0;
      const adjustedScore = c.passage.score * Math.pow(decayFactor, n);

      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break; // No more candidates fit

    const selected = candidates[bestIdx]!;
    selected.selected = true;
    result.push(selected.passage);
    totalTokens += selected.passage.tokenCount;
    paperSelectionCount.set(
      selected.passage.paperId,
      (paperSelectionCount.get(selected.passage.paperId) ?? 0) + 1,
    );
  }

  return result;
}

// ─── §6.3: RAG prompt formatting ───

/**
 * Format retrieval result into a prompt-ready block.
 *
 * Order:
 * 1. Annotation-sourced chunks (⭐)
 * 2. Memo-sourced chunks (📝)
 * 3. Paper chunks (grouped by paper, ordered by position within paper)
 */
export function formatRetrievalResult(passages: RagPassage[]): string {
  const blocks: string[] = [];

  // Annotation sources first
  const annotationChunks = passages.filter((p) => p.source === 'annotation');
  for (const chunk of annotationChunks) {
    const pageStr = chunk.page != null ? ` — P${chunk.page}` : '';
    blocks.push(
      `⭐ **[Researcher Annotation]** ${chunk.paperTitle} (${chunk.year ?? '?'})${pageStr}\n> ${chunk.text}`,
    );
  }

  // Memo sources
  const memoChunks = passages.filter((p) => p.source === 'memo');
  for (const chunk of memoChunks) {
    const dateStr = chunk.date ? ` (${chunk.date})` : '';
    blocks.push(`📝 **[Researcher Memo]**${dateStr}\n> ${chunk.text}`);
  }

  // Paper chunks grouped by paper
  const paperChunks = passages.filter(
    (p) => p.source === 'paper' || p.source === 'note' || p.source === 'private',
  );

  const byPaper = new Map<string, RagPassage[]>();
  for (const chunk of paperChunks) {
    const existing = byPaper.get(chunk.paperId) ?? [];
    existing.push(chunk);
    byPaper.set(chunk.paperId, existing);
  }

  for (const [, chunks] of byPaper) {
    // Sort by position within paper
    const sorted = chunks.sort((a, b) => (a.positionRatio ?? 0) - (b.positionRatio ?? 0));

    // Merge adjacent chunks
    const merged = mergeAdjacentChunks(sorted);

    const paperTitle = merged[0]?.paperTitle ?? 'Unknown';
    const year = merged[0]?.year ?? '?';
    blocks.push(`**[Paper] ${paperTitle} (${year})**`);

    for (const chunk of merged) {
      const sectionStr = chunk.sectionTitle ? `§${chunk.sectionTitle} ` : '';
      const sourceStr = `[${chunk.source}]`;
      const scoreStr = `[score: ${chunk.score.toFixed(3)}]`;
      blocks.push(`${sectionStr}${sourceStr} ${scoreStr}\n> ${chunk.text}`);
    }
  }

  return blocks.join('\n\n');
}

// ─── Adjacent chunk merging ───

/**
 * Merge chunks that are adjacent in the source paper (within 5% position gap).
 * This reduces redundant section headers and improves readability.
 */
function mergeAdjacentChunks(chunks: RagPassage[]): RagPassage[] {
  if (chunks.length <= 1) return chunks;

  const merged: RagPassage[] = [chunks[0]!];

  for (let i = 1; i < chunks.length; i++) {
    const prev = merged[merged.length - 1]!;
    const curr = chunks[i]!;

    const gap = Math.abs((curr.positionRatio ?? 0) - (prev.positionRatio ?? 0));
    const sameSection = prev.sectionTitle === curr.sectionTitle;

    if (sameSection && gap < 0.05) {
      // Merge: append text, keep higher score, sum tokens
      merged[merged.length - 1] = {
        ...prev,
        text: prev.text + '\n\n' + curr.text,
        score: Math.max(prev.score, curr.score),
        tokenCount: prev.tokenCount + curr.tokenCount,
      };
    } else {
      merged.push(curr);
    }
  }

  return merged;
}
