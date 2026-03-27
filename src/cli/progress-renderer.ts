/**
 * CLI terminal progress output — non-interactive format supporting pipe redirection.
 *
 * Per-item: ✓ success / ✗ failure / ⊘ skipped / ⟳ retry
 * Summary: completion stats, token usage, cost breakdown, failure reasons,
 *          acquisition source distribution, concept suggestions.
 *
 * See spec: §6
 */

// ─── Types ───

export interface ItemResult {
  id: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped' | 'retry';
  durationMs: number;
  failureReason?: string;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface BatchSummary {
  stageName: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tokenUsage: Array<{ model: string; inputTokens: number; outputTokens: number; cost: number }>;
  failureReasons: Record<string, number>;
  conceptSuggestions: Array<{ term: string; paperCount: number }>;
  acquisitionSources: Record<string, number>;
}

// ─── Per-item output (§6.1) ───

export function renderItemResult(item: ItemResult): string {
  const timestamp = new Date().toISOString();
  const dur = (item.durationMs / 1000).toFixed(1);
  const titlePreview = item.title.length > 50 ? item.title.slice(0, 47) + '...' : item.title;

  switch (item.status) {
    case 'completed':
      return `[${timestamp}] ✓ ${item.id}  ${dur}s  "${titlePreview}"`;
    case 'failed':
      return `[${timestamp}] ✗ ${item.id}  ${dur}s  FAILED: ${item.failureReason ?? 'unknown'}`;
    case 'skipped':
      return `[${timestamp}] ⊘ ${item.id}  0.0s  SKIPPED: ${item.failureReason ?? 'already_processed'}`;
    case 'retry':
      return `[${timestamp}] ⟳ ${item.id}  ${dur}s  RETRY ${item.retryAttempt ?? '?'}/${item.maxRetries ?? 3}: ${item.failureReason ?? 'retrying'}`;
  }
}

// ─── Summary output (§6.2) ───

export function renderSummary(summary: BatchSummary): string {
  const lines: string[] = [];
  const pct = (n: number) => summary.total > 0 ? ((n / summary.total) * 100).toFixed(1) : '0.0';
  const duration = formatDuration(summary.durationMs);
  const title = `Abyssal Batch ${capitalize(summary.stageName)} Complete`;

  lines.push('═══════════════════════════════════════════');
  lines.push(`  ${title}`);
  lines.push('═══════════════════════════════════════════');
  lines.push(`  Total:      ${summary.total}`);
  lines.push(`  Completed:  ${summary.completed} (${pct(summary.completed)}%)`);
  lines.push(`  Failed:     ${summary.failed} (${pct(summary.failed)}%)`);
  lines.push(`  Skipped:    ${summary.skipped} (${pct(summary.skipped)}%)`);
  lines.push(`  Duration:   ${duration}`);
  lines.push('');

  // Token usage
  if (summary.tokenUsage.length > 0) {
    lines.push('  Token Usage:');
    let totalCost = 0;
    for (const u of summary.tokenUsage) {
      const costStr = u.cost > 0 ? `$${u.cost.toFixed(2)}` : 'free';
      lines.push(`    ${u.model}:  ${fmtNum(u.inputTokens)} input / ${fmtNum(u.outputTokens)} output  ${costStr}`);
      totalCost += u.cost;
    }
    lines.push(`    Total cost:     $${totalCost.toFixed(2)}`);
    lines.push('');
  }

  // Acquisition source distribution (§6.2)
  const sourceEntries = Object.entries(summary.acquisitionSources);
  if (sourceEntries.length > 0) {
    const sourceTotal = sourceEntries.reduce((sum, [, count]) => sum + count, 0);
    lines.push('  Acquisition Sources:');
    for (const [source, count] of sourceEntries.sort((a, b) => b[1] - a[1])) {
      const srcPct = sourceTotal > 0 ? ((count / sourceTotal) * 100).toFixed(1) : '0.0';
      lines.push(`    ${source}:  ${count} (${srcPct}%)`);
    }
    lines.push('');
  }

  // Failure reasons
  if (Object.keys(summary.failureReasons).length > 0) {
    lines.push('  Failures by reason:');
    for (const [reason, count] of Object.entries(summary.failureReasons)) {
      lines.push(`    ${reason}:  ${count}`);
    }
    lines.push('');
  }

  // Concept suggestions
  if (summary.conceptSuggestions.length > 0) {
    lines.push('  Concept Suggestions (source_paper_count ≥ 3):');
    for (const s of summary.conceptSuggestions) {
      lines.push(`    "${s.term}"  — mentioned in ${s.paperCount} papers`);
    }
    lines.push('');
    lines.push('  → Run Abyssal GUI to review and adopt suggestions.');
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}

// ─── Helpers ───

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
