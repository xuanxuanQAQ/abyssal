/**
 * Suggestion Aggregator — concept suggestion dedup + threshold notification.
 *
 * Wraps the DAO addSuggestedConcept with:
 * - term_normalized dedup (same as DAO, but also tracks cross-paper counts)
 * - Threshold-based push notification when source_paper_count reaches threshold
 *
 * See spec: §6.8 (Step 10c)
 */

import type { NormalizedSuggestion } from '../../../output-parser/suggestion-parser';

// ─── DB interface ───

export interface SuggestionDb {
  getSuggestedConceptByTerm: (termNormalized: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  insertSuggestedConcept: (data: Record<string, unknown>) => Promise<void> | void;
  updateSuggestedConcept: (id: string, updates: Record<string, unknown>) => Promise<void> | void;
  addSuggestedConcept: (input: Record<string, unknown>) => Promise<string> | string;
}

// ─── Push notification interface ───

export interface PushNotifier {
  pushNotification: (notification: {
    type: string;
    title: string;
    description: string;
    action?: { type: string; route: string };
  }) => void;
}

// ─── Aggregation result ───

export interface AggregationResult {
  newSuggestions: number;
  updatedSuggestions: number;
  notificationsSent: number;
}

// ─── Main aggregator (§6.8) ───

/**
 * Aggregate suggested concepts from a single paper's analysis results.
 *
 * For each suggestion:
 * - If term_normalized already exists: merge frequencies and source papers
 * - If new: insert fresh record
 * - If source_paper_count reaches threshold: push notification
 *
 * @param suggestions - Normalized suggestions from output parser
 * @param paperId - Source paper that produced these suggestions
 * @param db - Database operations
 * @param notifier - Push notification system (null in CLI mode)
 * @param threshold - Notification threshold (default 3)
 */
export async function aggregateSuggestions(
  suggestions: NormalizedSuggestion[],
  paperId: string,
  db: SuggestionDb,
  notifier: PushNotifier | null,
  threshold: number = 3,
): Promise<AggregationResult> {
  let newSuggestions = 0;
  let updatedSuggestions = 0;
  let notificationsSent = 0;

  for (const suggestion of suggestions) {
    // Fix #8: Retry loop to handle concurrent write races on term_normalized
    // Two papers analyzed concurrently may both try to insert the same term.
    // On UNIQUE constraint violation, retry as an update instead.
    let retries = 0;
    const MAX_RETRIES = 2;

    while (retries <= MAX_RETRIES) {
      try {
        const existing = await db.getSuggestedConceptByTerm(suggestion.termNormalized);

        if (existing) {
          // ── Aggregate: update frequency and source papers ──
          const existingPaperIds = parseJsonArray(existing['source_paper_ids'] as string);
          if (existingPaperIds.includes(paperId)) break; // Already recorded

          existingPaperIds.push(paperId);
          const newCount = existingPaperIds.length;
          const mergedKeywords = Array.from(new Set([
            ...parseJsonArray(existing['suggested_keywords'] as string),
            ...(suggestion.suggestedKeywords ?? []),
          ])).slice(0, 10);

          await db.updateSuggestedConcept(existing['id'] as string, {
            source_paper_count: newCount,
            source_paper_ids: JSON.stringify(existingPaperIds),
            frequency: (existing['frequency'] as number ?? 0) + suggestion.frequencyInPaper,
            reason: selectLongerText(existing['reason'], suggestion.reason),
            suggested_definition: selectPreferredDefinition(existing['suggested_definition'], suggestion.suggestedDefinition),
            suggested_keywords: JSON.stringify(mergedKeywords),
            closest_existing_concept_id: existing['closest_existing_concept_id'] ?? suggestion.closestExisting,
            updated_at: new Date().toISOString(),
          });

          updatedSuggestions++;

          // ── Threshold notification (§6.8) ──
          if (newCount === threshold && notifier) {
            notifier.pushNotification({
              type: 'concept_suggestion',
              title: `AI suggests new concept: "${suggestion.term}"`,
              description: `Mentioned in ${newCount} papers`,
              action: {
                type: 'navigate',
                route: `/framework?tab=suggestions&focus=${suggestion.termNormalized}`,
              },
            });
            notificationsSent++;
          }
        } else {
          // ── New suggestion ──
          await db.addSuggestedConcept({
            term: suggestion.term,
            termNormalized: suggestion.termNormalized,
            frequencyInPaper: suggestion.frequencyInPaper,
            sourcePaperId: paperId,
            closestExistingConceptId: suggestion.closestExisting,
            reason: suggestion.reason,
            suggestedDefinition: suggestion.suggestedDefinition,
            suggestedKeywords: suggestion.suggestedKeywords,
          });

          newSuggestions++;
        }
        break; // Success — exit retry loop
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // UNIQUE constraint or SQLITE_BUSY — retry as update
        if ((msg.includes('UNIQUE') || msg.includes('SQLITE_BUSY')) && retries < MAX_RETRIES) {
          retries++;
          continue;
        }
        // Non-retryable error — rethrow so caller can log with full context
        throw new Error(`Suggestion aggregation failed for term "${suggestion.term}": ${msg}`, { cause: err });
      }
    }
  }

  return { newSuggestions, updatedSuggestions, notificationsSent };
}

// ─── Helper ───

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function selectLongerText(existing: unknown, incoming: string): string {
  const existingText = typeof existing === 'string' ? existing : '';
  return incoming.length > existingText.length ? incoming : existingText;
}

function selectPreferredDefinition(existing: unknown, incoming: string | null): string | null {
  const existingText = typeof existing === 'string' ? existing.trim() : '';
  if (existingText.length > 0) return existingText;
  return typeof incoming === 'string' && incoming.trim().length > 0 ? incoming : null;
}
