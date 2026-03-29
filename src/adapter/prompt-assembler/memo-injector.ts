/**
 * Memo Injector — three-mode collection + formatting for researcher's intuitions.
 *
 * §3.1: collectMemos() — three query modes by workflow:
 *   - analyze: getMemosByEntity('paper', paperId)
 *   - synthesize: getMemosByEntity('concept', conceptId)
 *   - article: union of concept + paper + outline memos (dedup by id)
 *
 * §3.2: formatMemos() — bullet list with dates, related concepts/papers, annotation triggers.
 *
 * Memos are ABSOLUTE priority — never trimmed by CBM.
 */

// ─── Types ───

export interface MemoForInjection {
  id: string;
  text: string;
  paperIds: string[];
  conceptIds: string[];
  annotationId: string | null;
  createdAt: string;
}

export interface MemoEntityDb {
  getMemosByEntity: (entityType: string, entityId: string) => MemoForInjection[];
  getConceptName?: (conceptId: string) => string | null;
  getPaperLabel?: (paperId: string) => string | null;
}

export interface CollectMemosParams {
  workflow: 'analyze' | 'synthesize' | 'article';
  paperId?: string;
  conceptId?: string;
  outlineEntry?: {
    id: string;
    conceptIds: string[];
    paperIds: string[];
  };
}

export interface FormattedMemos {
  block: string | null;
  tokens: number;
  count: number;
}

// ─── Token counter interface ───

interface TokenCounter {
  count: (text: string) => number;
}

// ─── §3.1: Memo collection ───

/**
 * Collect memos by workflow mode.
 *
 * - analyze: memos linked to current paper
 * - synthesize: memos linked to target concept
 * - article: union of concept + paper + outline memos (deduped)
 */
export function collectMemos(
  params: CollectMemosParams,
  db: MemoEntityDb,
): MemoForInjection[] {
  switch (params.workflow) {
    case 'analyze':
      if (!params.paperId) return [];
      return db.getMemosByEntity('paper', params.paperId);

    case 'synthesize':
      if (!params.conceptId) return [];
      return db.getMemosByEntity('concept', params.conceptId);

    case 'article': {
      if (!params.outlineEntry) return [];
      const allMemos = new Map<string, MemoForInjection>();

      for (const conceptId of params.outlineEntry.conceptIds) {
        const memos = db.getMemosByEntity('concept', conceptId);
        for (const memo of memos) allMemos.set(memo.id, memo);
      }

      for (const paperId of params.outlineEntry.paperIds) {
        const memos = db.getMemosByEntity('paper', paperId);
        for (const memo of memos) allMemos.set(memo.id, memo);
      }

      const outlineMemos = db.getMemosByEntity('outline', params.outlineEntry.id);
      for (const memo of outlineMemos) allMemos.set(memo.id, memo);

      return Array.from(allMemos.values())
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    default:
      return [];
  }
}

// ─── §3.2: Memo formatting ───

/**
 * Format memos into a prompt-ready block.
 *
 * Format per memo:
 *   - [YYYY-MM-DD] "memo text"
 *     (Related concepts: conceptA, conceptB)
 *     (Also relates to: Smith 2023; Lee 2024)
 *     (Triggered by annotation #ann_id)
 */
export function formatMemos(
  memos: MemoForInjection[],
  tokenCounter: TokenCounter,
  currentPaperId?: string,
  db?: MemoEntityDb,
): FormattedMemos {
  if (memos.length === 0) {
    return { block: null, tokens: 0, count: 0 };
  }

  const lines: string[] = [];

  for (const memo of memos) {
    const dateStr = memo.createdAt.slice(0, 10); // YYYY-MM-DD
    let line = `- [${dateStr}] "${memo.text}"`;

    // Related concepts
    if (memo.conceptIds.length > 0) {
      const conceptNames = memo.conceptIds.map((id) => {
        const name = db?.getConceptName?.(id);
        return name ?? id;
      });
      line += `\n  (Related concepts: ${conceptNames.join(', ')})`;
    }

    // Related papers (exclude current paper)
    const otherPapers = (memo.paperIds ?? []).filter((id) => id !== currentPaperId);
    if (otherPapers.length > 0) {
      const paperLabels = otherPapers.map((id) => {
        const label = db?.getPaperLabel?.(id);
        return label ?? id;
      });
      line += `\n  (Also relates to: ${paperLabels.join('; ')})`;
    }

    // Annotation trigger
    if (memo.annotationId) {
      line += `\n  (Triggered by annotation #${memo.annotationId})`;
    }

    lines.push(line);
  }

  const block =
    "## Researcher's Intuitions & Notes\n\n" +
    'The researcher has recorded the following thoughts:\n\n' +
    lines.join('\n\n');

  const tokens = tokenCounter.count(block);

  return { block, tokens, count: memos.length };
}
