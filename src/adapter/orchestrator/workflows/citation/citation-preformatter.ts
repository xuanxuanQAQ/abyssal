/**
 * Citation Preformatter — dual-preserve [[@id]](rendered) formatting.
 *
 * Converts [@paper_id] markers to [[@paper_id]](formatted citation)
 * which preserves both the machine-readable ID and the human-readable
 * rendered citation in a single Markdown link.
 *
 * Also detects multi-citation clusters (adjacent [@id][@id]) for
 * merged rendering via citeproc-js.
 *
 * See spec: §2.5.2, §2.6
 */

// ─── Types ───

export interface PreformatResult {
  text: string;
  formattedCount: number;
  failedCount: number;
}

export interface CitationFormatter {
  /** Format a single inline citation for the given paper ID */
  formatInline: (paperId: string) => string | null;
  /** Format a cluster of paper IDs as a merged citation */
  formatCluster?: (paperIds: string[]) => string | null;
}

// ─── Patterns ───

const CITATION_PATTERN = /\[@([a-f0-9]{12})\]/g;

// ─── Preformat (§2.5.2) ───

/**
 * Convert all [@paper_id] markers to dual-preserve format [[@id]](rendered).
 *
 * If a CitationFormatter is provided, renders each citation using CSL.
 * Otherwise, uses the raw paper ID as the display text.
 */
export function preformatCitations(
  text: string,
  formatter: CitationFormatter | null,
): PreformatResult {
  let formattedCount = 0;
  let failedCount = 0;

  // First: detect and handle multi-citation clusters (§2.6)
  let result = text;
  if (formatter?.formatCluster) {
    result = handleClusters(result, formatter);
  }

  // Then: handle remaining single citations
  result = result.replace(CITATION_PATTERN, (fullMatch, paperId: string) => {
    if (!formatter) {
      formattedCount++;
      return `[[@${paperId}]](${paperId})`;
    }

    try {
      const rendered = formatter.formatInline(paperId);
      if (rendered) {
        formattedCount++;
        return `[[@${paperId}]](${rendered})`;
      }
    } catch { /* fall through */ }

    failedCount++;
    return fullMatch; // Keep original on failure
  });

  return { text: result, formattedCount, failedCount };
}

// ─── Multi-citation cluster detection (§2.6) ───

interface CitationCluster {
  paperIds: string[];
  startIndex: number;
  endIndex: number;
  fullMatch: string;
}

/**
 * Detect adjacent [@id][@id][@id] clusters (separated only by whitespace).
 */
export function detectCitationClusters(text: string): CitationCluster[] {
  const matches = [...text.matchAll(CITATION_PATTERN)];
  if (matches.length < 2) return [];

  const clusters: CitationCluster[] = [];
  let currentCluster: RegExpMatchArray[] = [matches[0]!];

  for (let i = 1; i < matches.length; i++) {
    const prev = matches[i - 1]!;
    const curr = matches[i]!;

    const prevEnd = prev.index! + prev[0].length;
    const between = text.slice(prevEnd, curr.index!);

    if (/^\s*$/.test(between)) {
      currentCluster.push(curr);
    } else {
      if (currentCluster.length > 1) {
        clusters.push(buildCluster(currentCluster, text));
      }
      currentCluster = [curr];
    }
  }

  if (currentCluster.length > 1) {
    clusters.push(buildCluster(currentCluster, text));
  }

  return clusters;
}

function buildCluster(matches: RegExpMatchArray[], text: string): CitationCluster {
  const first = matches[0]!;
  const last = matches[matches.length - 1]!;
  return {
    paperIds: matches.map((m) => m[1]!),
    startIndex: first.index!,
    endIndex: last.index! + last[0].length,
    fullMatch: text.slice(first.index!, last.index! + last[0].length),
  };
}

function handleClusters(text: string, formatter: CitationFormatter): string {
  const clusters = detectCitationClusters(text);
  if (clusters.length === 0) return text;

  // Replace clusters from end to start (reverse) to preserve indices
  let result = text;
  for (let i = clusters.length - 1; i >= 0; i--) {
    const cluster = clusters[i]!;
    if (!formatter.formatCluster) continue;

    const rendered = formatter.formatCluster(cluster.paperIds);
    if (rendered) {
      // Build dual-preserve for cluster: [[@id1;@id2]](rendered)
      const idPart = cluster.paperIds.map((id) => `@${id}`).join(';');
      const replacement = `[[${idPart}]](${rendered})`;
      result = result.slice(0, cluster.startIndex) + replacement + result.slice(cluster.endIndex);
    }
  }

  return result;
}
