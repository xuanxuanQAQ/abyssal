/**
 * ContextSnapshotBuilder — builds frozen, budget-constrained context snapshots.
 *
 * Replaces scattered context assembly in useChatContext and useAIOperations.
 * Single aggregation point for all operation context.
 *
 * Layers:
 * - surface: current view, current selection, current article/section
 * - working: current goal, recent operation, recent retrieval
 * - retrieval: on-demand evidence chunks
 * - history: long conversation and old drafts (default off)
 */

import type { ResearchSession, SessionFocus } from '../core/session/research-session';
import type {
  ContextSnapshot,
  ContextBudget,
  CopilotOperation,
  FocusEntities,
  ConversationContext,
  RetrievalContext,
  ArticleFocus,
  SelectionContext,
  WritingContextState,
  EvidenceChunk,
} from './types';
import { estimateTokens } from '../core/infra/token-counter';

export interface ContextBuildDeps {
  session: ResearchSession;
  workspaceId: string;
  /** Retrieve conversation turns for a session */
  getConversationTurns?: (sessionId: string, limit: number) => Array<{
    role: 'user' | 'assistant' | 'system';
    text: string;
  }>;
  /** Retrieve article focus information */
  getArticleFocus?: (articleId: string, sectionId?: string | null) => Promise<ArticleFocus | null>;
  /** Retrieve recent retrieval context */
  getRetrievalContext?: () => RetrievalContext;
}

const BUDGET_DEFAULTS: Record<ContextBudget['policy'], ContextBudget> = {
  minimal: {
    policy: 'minimal',
    tokenBudget: 2000,
    includedLayers: ['surface'],
  },
  standard: {
    policy: 'standard',
    tokenBudget: 6000,
    includedLayers: ['surface', 'working'],
  },
  deep: {
    policy: 'deep',
    tokenBudget: 12000,
    includedLayers: ['surface', 'working', 'retrieval', 'history'],
  },
};

export class ContextSnapshotBuilder {
  private deps: ContextBuildDeps;

  constructor(deps: ContextBuildDeps) {
    this.deps = deps;
  }

  /**
   * Build a frozen context snapshot for an operation.
   * The snapshot is immutable once built — execution must not re-read live state.
   */
  async build(operation: CopilotOperation): Promise<ContextSnapshot> {
    const policy = operation.constraints?.contextPolicy ?? 'standard';
    const budget = BUDGET_DEFAULTS[policy];
    const session = this.deps.session;
    const focus = session.focus;

    // Surface layer (always included)
    const selection = this.resolveSelection(operation);
    const focusEntities = this.resolveFocusEntities(operation, focus);

    // Article focus
    const article = await this.resolveArticleFocus(operation, focus);

    // Writing context
    const writing = this.resolveWritingContext(operation, focus);

    // Working layer
    const conversation = this.resolveConversation(operation, budget);

    // Retrieval layer
    const retrieval = this.resolveRetrieval(operation, budget);

    const snapshot: ContextSnapshot = {
      activeView: operation.context?.activeView ?? focus.currentView,
      workspaceId: this.deps.workspaceId,
      article,
      selection,
      focusEntities,
      conversation,
      retrieval,
      writing,
      budget,
      frozenAt: Date.now(),
    };

    // ── Priority-based truncation ──
    // Eviction order (lowest priority first): history turns → retrieval evidence → focus entities
    // Selection and article focus are never truncated (essential for intent routing).
    const truncated = this.truncateToBudget(snapshot, budget.tokenBudget);

    return Object.freeze(truncated) as ContextSnapshot;
  }

  private resolveSelection(operation: CopilotOperation): SelectionContext | null {
    // If the operation already has selection context, use it directly
    if (operation.context?.selection) {
      return operation.context.selection;
    }

    // Otherwise infer from session focus
    const focus = this.deps.session.focus;
    if (focus.readerState?.selection) {
      return {
        kind: 'reader',
        paperId: focus.readerState.paperId,
        selectedText: focus.readerState.selection.text,
        pdfPage: focus.readerState.selection.page,
      };
    }

    return null;
  }

  private resolveFocusEntities(operation: CopilotOperation, focus: SessionFocus): FocusEntities {
    if (operation.context?.focusEntities) {
      return operation.context.focusEntities;
    }

    const paperIds = focus.activePapers.slice(0, 5);
    const conceptIds = focus.activeConcepts.slice(0, 5);

    return {
      paperIds,
      conceptIds,
    };
  }

  private async resolveArticleFocus(
    operation: CopilotOperation,
    focus: SessionFocus,
  ): Promise<ArticleFocus | null> {
    const operationArticle = operation.context?.article ?? null;
    const articleId = operationArticle?.articleId ?? focus.selected.articleId ?? null;
    const operationSectionId = operationArticle ? operationArticle.sectionId ?? null : null;
    if (!articleId) {
      return operationArticle;
    }

    if (!this.deps.getArticleFocus) {
      return operationArticle ?? { articleId, sectionId: operationSectionId };
    }

    const fetched = await this.deps.getArticleFocus(articleId, operationSectionId);
    if (!fetched) {
      return operationArticle ?? { articleId, sectionId: operationSectionId };
    }

    if (!operationArticle) {
      return fetched;
    }

    return {
      ...fetched,
      ...operationArticle,
      articleId,
      sectionId: operationArticle.sectionId ?? fetched.sectionId ?? null,
      ...(operationArticle.previousSectionSummaries != null ? { previousSectionSummaries: operationArticle.previousSectionSummaries } : {}),
      ...(operationArticle.nextSectionTitles != null ? { nextSectionTitles: operationArticle.nextSectionTitles } : {}),
    };
  }

  private resolveWritingContext(
    operation: CopilotOperation,
    focus: SessionFocus,
  ): WritingContextState | null {
    if (operation.context?.writing) {
      return operation.context.writing;
    }

    // Infer from current view
    if (focus.currentView === 'writing' && focus.selected.articleId) {
      return {
        editorId: 'main',
        articleId: focus.selected.articleId,
        sectionId: null,
        unsavedChanges: false,
      };
    }

    return null;
  }

  private resolveConversation(
    operation: CopilotOperation,
    budget: ContextBudget,
  ): ConversationContext {
    if (operation.context?.conversation?.recentTurns?.length) {
      return operation.context.conversation;
    }

    if (!budget.includedLayers.includes('working') && !budget.includedLayers.includes('history')) {
      return { recentTurns: [] };
    }

    const limit = budget.includedLayers.includes('history') ? 20 : 6;

    if (this.deps.getConversationTurns) {
      const turns = this.deps.getConversationTurns(operation.sessionId, limit);
      return { recentTurns: turns };
    }

    return { recentTurns: [] };
  }

  /**
   * Truncate context layers to fit within the token budget.
   * Eviction priority (trimmed first → last):
   *   1. Conversation history turns (oldest first)
   *   2. Retrieval evidence (lowest-score first)
   *   3. Focus entity IDs (excess trimmed)
   * Selection and article focus are never truncated.
   */
  private truncateToBudget(snapshot: ContextSnapshot, tokenBudget: number): ContextSnapshot {
    const estimate = (s: ContextSnapshot) => {
      let tokens = 0;
      // Selection text
      if (s.selection && 'selectedText' in s.selection) {
        tokens += estimateTokens(s.selection.selectedText);
      }
      // Article focus summaries
      if (s.article?.previousSectionSummaries) {
        for (const summary of s.article.previousSectionSummaries) {
          tokens += estimateTokens(summary);
        }
      }
      // Conversation turns
      for (const turn of s.conversation.recentTurns) {
        tokens += estimateTokens(turn.text);
      }
      // Evidence chunks
      for (const chunk of s.retrieval.evidence) {
        tokens += estimateTokens(chunk.text);
      }
      return tokens;
    };

    let current = estimate(snapshot);
    if (current <= tokenBudget) return snapshot;

    // Mutable shallow copy for truncation
    let result = { ...snapshot };

    // Phase 1: Trim conversation history (oldest first)
    if (result.conversation.recentTurns.length > 0 && current > tokenBudget) {
      const turns = [...result.conversation.recentTurns];
      while (turns.length > 1 && current > tokenBudget) {
        const removed = turns.shift()!;
        current -= estimateTokens(removed.text);
      }
      result = { ...result, conversation: { ...result.conversation, recentTurns: turns } };
    }

    // Phase 2: Trim retrieval evidence (lowest-score first)
    if (result.retrieval.evidence.length > 0 && current > tokenBudget) {
      const evidence = [...result.retrieval.evidence].sort((a, b) => b.score - a.score);
      while (evidence.length > 0 && current > tokenBudget) {
        const removed = evidence.pop()!;
        current -= estimateTokens(removed.text);
      }
      result = { ...result, retrieval: { ...result.retrieval, evidence } };
    }

    // Phase 3: Trim focus entity lists
    if (current > tokenBudget) {
      result = {
        ...result,
        focusEntities: {
          ...result.focusEntities,
          paperIds: result.focusEntities.paperIds.slice(0, 2),
          conceptIds: result.focusEntities.conceptIds.slice(0, 2),
        },
      };
    }

    return result;
  }

  private resolveRetrieval(
    operation: CopilotOperation,
    budget: ContextBudget,
  ): RetrievalContext {
    if (operation.context?.retrieval?.evidence?.length || operation.context?.retrieval?.lastQuery) {
      return operation.context.retrieval;
    }

    if (!budget.includedLayers.includes('retrieval')) {
      return { evidence: [] };
    }

    if (this.deps.getRetrievalContext) {
      return this.deps.getRetrievalContext();
    }

    return { evidence: [] };
  }
}
