/**
 * Advisory Agent — read-only diagnostic guardian.
 *
 * Four-phase flow: SQL diagnostics → rule engine → LLM formatting → push.
 *
 * Triggers: app startup (async), workflow completion, manual refresh.
 * 30-second timeout protection.
 *
 * See spec: section 6
 */

import type { LlmClient } from '../llm-client/llm-client';
import type { PushManager } from '../../electron/ipc/push';
import type { Logger } from '../../core/infra/logger';
import { runDiagnosticQueries, evaluateRules, type RawSuggestion } from './diagnostic-queries';
import {
  formatSuggestionsWithLlm,
  formatSuggestionsWithoutLlm,
  type FormattedSuggestion,
} from './suggestion-formatter';

// ─── Types ───

export interface AdvisoryAgentOptions {
  llmClient: LlmClient | null;
  pushManager: PushManager | null;
  logger: Logger;
  queryFn: (sql: string) => Promise<unknown[]>;
  getProjectStats: () => Promise<{ papers: number; concepts: number; memos: number }>;
}

// ─── Advisory Agent ───

export class AdvisoryAgent {
  private readonly llmClient: LlmClient | null;
  private readonly pushManager: PushManager | null;
  private readonly logger: Logger;
  private readonly queryFn: (sql: string) => Promise<unknown[]>;
  private readonly getProjectStats: () => Promise<{ papers: number; concepts: number; memos: number }>;
  private latestSuggestions: FormattedSuggestion[] = [];

  /** Debounce state: prevents SQL storms when workflows complete in rapid succession */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResolvers: Array<(v: FormattedSuggestion[]) => void> = [];
  private isRunning = false;

  constructor(opts: AdvisoryAgentOptions) {
    this.llmClient = opts.llmClient;
    this.pushManager = opts.pushManager;
    this.logger = opts.logger;
    this.queryFn = opts.queryFn;
    this.getProjectStats = opts.getProjectStats;
  }

  /**
   * Generate advisory suggestions with debounce protection.
   *
   * When called multiple times in rapid succession (e.g., batch workflow
   * completing papers one by one), only the last call within a 5-second
   * window actually executes. Earlier callers receive the same result.
   *
   * This prevents SQL storms on the main thread during batch operations.
   */
  async generateSuggestions(): Promise<FormattedSuggestion[]> {
    // If already running, return promise that resolves when current run finishes
    if (this.isRunning) {
      return new Promise<FormattedSuggestion[]>((resolve) => {
        this.pendingResolvers.push(resolve);
      });
    }

    // Debounce: wait 5 seconds for more calls to coalesce
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    return new Promise<FormattedSuggestion[]>((resolve) => {
      this.pendingResolvers.push(resolve);

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.executeGeneration().then((result) => {
          const resolvers = this.pendingResolvers;
          this.pendingResolvers = [];
          for (const r of resolvers) r(result);
        });
      }, 5000);
    });
  }

  /**
   * Immediately generate suggestions without debounce (for manual refresh).
   */
  async generateSuggestionsImmediate(): Promise<FormattedSuggestion[]> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;

    const result = await this.executeGeneration();
    const resolvers = this.pendingResolvers;
    this.pendingResolvers = [];
    for (const r of resolvers) r(result);
    return result;
  }

  private async executeGeneration(): Promise<FormattedSuggestion[]> {
    this.isRunning = true;
    this.logger.debug('Advisory Agent: generating suggestions');

    try {
      // Phase 1: SQL diagnostics (time-sliced to avoid blocking event loop)
      const diagnostics = await runDiagnosticQueries(this.queryFn);

      // Phase 2: Rule engine
      const rawSuggestions = evaluateRules(diagnostics);

      if (rawSuggestions.length === 0) {
        this.latestSuggestions = [];
        this.pushManager?.pushAdvisorySuggestions([]);
        return [];
      }

      // Phase 3: LLM formatting (with 30s timeout)
      let formatted: FormattedSuggestion[];

      if (this.llmClient) {
        try {
          const stats = await this.getProjectStats();
          formatted = await withTimeout(
            formatSuggestionsWithLlm(rawSuggestions, this.llmClient, stats),
            30_000,
          );
        } catch (err) {
          this.logger.warn('Advisory Agent: LLM formatting failed, using rule-engine output', {
            error: (err as Error).message,
          });
          formatted = formatSuggestionsWithoutLlm(rawSuggestions);
        }
      } else {
        formatted = formatSuggestionsWithoutLlm(rawSuggestions);
      }

      this.latestSuggestions = formatted;

      // Phase 4: Push to renderer
      this.pushManager?.pushAdvisorySuggestions(formatted);

      this.logger.info('Advisory Agent: generated suggestions', {
        rawCount: rawSuggestions.length,
        formattedCount: formatted.length,
      });

      return formatted;
    } catch (err) {
      this.logger.warn('Advisory Agent: suggestion generation failed', {
        error: (err as Error).message,
      });
      return [];
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get the most recently generated suggestions (for IPC).
   */
  getLatestSuggestions(): FormattedSuggestion[] {
    return this.latestSuggestions;
  }
}

// ─── Timeout helper ───

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Advisory Agent timeout (${ms}ms)`)), ms),
    ),
  ]);
}
