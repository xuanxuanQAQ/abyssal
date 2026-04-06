/**
 * IntentRouter — classifies user input into CopilotIntent + initial OutputTarget.
 *
 * Only does two things:
 *   1. Classify user intent
 *   2. Determine initial output target
 *
 * Does NOT call workflows, operate databases, or update editors.
 */

import type {
  CopilotIntent,
  CopilotSurface,
  OutputTarget,
  SelectionContext,
  CopilotOperation,
} from './types';
import type { IntentEmbeddingIndex } from './intent-embedding-index';

export interface IntentClassification {
  intent: CopilotIntent;
  confidence: number;
  outputTarget: OutputTarget;
  ambiguous: boolean;
  alternatives?: Array<{ intent: CopilotIntent; confidence: number }>;
}

/** Keyword patterns mapped to intents (priority ordered) */
const INTENT_PATTERNS: Array<{
  keywords: RegExp;
  intent: CopilotIntent;
  priority: number;
}> = [
  { keywords: /改写|rewrite|润色|重写/i,           intent: 'rewrite-selection',         priority: 10 },
  { keywords: /扩展|expand|展开|详细/i,            intent: 'expand-selection',           priority: 10 },
  { keywords: /压缩|compress|精简|缩写/i,          intent: 'compress-selection',         priority: 10 },
  { keywords: /续写|continue|接着写/i,             intent: 'continue-writing',           priority: 10 },
  { keywords: /生成.*节|generate.*section|写.*节/i, intent: 'generate-section',           priority: 9 },
  { keywords: /引用.*句|citation.*sentence|带引用/i, intent: 'insert-citation-sentence',   priority: 9 },
  { keywords: /引用|cite|draft.*citation/i,        intent: 'draft-citation',             priority: 8 },
  { keywords: /总结.*选|summarize.*select/i,       intent: 'summarize-selection',        priority: 8 },
  { keywords: /总结.*节|summarize.*section/i,      intent: 'summarize-section',          priority: 8 },
  { keywords: /审查|review|论证/i,                 intent: 'review-argument',            priority: 7 },
  { keywords: /检索|retrieve|evidence|证据/i,      intent: 'retrieve-evidence',          priority: 7 },
  { keywords: /导航|navigate|跳转|打开/i,          intent: 'navigate',                   priority: 5 },
  { keywords: /工作流|workflow|discover|acquire|process|analyze/i, intent: 'run-workflow', priority: 5 },
];

const CONFIDENCE_THRESHOLD = 0.55;

export class IntentRouter {
  private embeddingIndex: IntentEmbeddingIndex | null = null;

  /** Inject the embedding index for semantic fallback classification. */
  setEmbeddingIndex(index: IntentEmbeddingIndex): void {
    this.embeddingIndex = index;
  }

  /**
   * Classify the operation's intent from prompt + surface + context.
   * If the operation already has a well-defined intent, validates and returns it.
   * Falls back to embedding similarity when keyword matching finds no match.
   */
  async classify(operation: CopilotOperation): Promise<IntentClassification> {
    // If intent is explicitly set (not 'ask'), trust the intent but still
    // infer outputTarget when the envelope carries the default chat-message
    // target (e.g. quick action chips send an explicit intent without a
    // pre-resolved target).
    if (operation.intent !== 'ask') {
      const needsTargetInference =
        !operation.outputTarget || operation.outputTarget.type === 'chat-message';
      const outputTarget = needsTargetInference
        ? this.inferOutputTarget(
            operation.intent,
            operation.surface,
            operation.context?.selection ?? null,
            operation.prompt.toLowerCase(),
          )
        : operation.outputTarget;
      return {
        intent: operation.intent,
        confidence: 1.0,
        outputTarget,
        ambiguous: false,
      };
    }

    // Classify from prompt text and context
    const prompt = operation.prompt.toLowerCase();
    const matches = this.matchPatterns(prompt);

    if (matches.length === 0) {
      // ── Embedding fallback ──
      // Keyword matching missed — try semantic similarity against exemplar sentences.
      const embeddingMatch = await this.embeddingIndex?.match(prompt);
      if (embeddingMatch) {
        const outputTarget = this.inferOutputTarget(
          embeddingMatch.intent,
          operation.surface,
          operation.context?.selection ?? null,
          prompt,
        );
        return {
          intent: embeddingMatch.intent,
          confidence: embeddingMatch.score,
          outputTarget,
          ambiguous: false,
        };
      }

      // Pure chat/ask — no special intent detected
      return {
        intent: 'ask',
        confidence: 0.8,
        outputTarget: { type: 'chat-message' },
        ambiguous: false,
      };
    }

    const best = matches[0]!

    // Check for ambiguity
    const ambiguous =
      matches.length > 1 &&
      matches[1]!.confidence > CONFIDENCE_THRESHOLD &&
      best.confidence - matches[1]!.confidence < 0.15;

    const outputTarget = this.inferOutputTarget(
      best.intent,
      operation.surface,
      operation.context?.selection ?? null,
      prompt,
    );

    return {
      intent: best.intent,
      confidence: best.confidence,
      outputTarget,
      ambiguous,
      alternatives: ambiguous
        ? matches.slice(1, 4).map((m) => ({ intent: m.intent, confidence: m.confidence }))
        : [],
    };
  }

  private matchPatterns(prompt: string): Array<{ intent: CopilotIntent; confidence: number }> {
    const results: Array<{ intent: CopilotIntent; confidence: number; priority: number }> = [];

    for (const pattern of INTENT_PATTERNS) {
      if (pattern.keywords.test(prompt)) {
        results.push({
          intent: pattern.intent,
          confidence: 0.6 + pattern.priority * 0.03,
          priority: pattern.priority,
        });
      }
    }

    // Sort by confidence desc, then priority desc
    results.sort((a, b) => b.confidence - a.confidence || b.priority - a.priority);
    return results;
  }

  /** Infer the best output target based on intent + surface + selection + prompt */
  private inferOutputTarget(
    intent: CopilotIntent,
    surface: CopilotSurface,
    selection: SelectionContext | null,
    prompt?: string,
  ): OutputTarget {
    // Editor mutation intents
    if (
      selection?.kind === 'editor' &&
      ['rewrite-selection', 'expand-selection', 'compress-selection'].includes(intent)
    ) {
      return {
        type: 'editor-selection-replace',
        editorId: 'main',
        articleId: selection.articleId,
        sectionId: selection.sectionId,
        from: selection.from,
        to: selection.to,
      };
    }

    if (intent === 'continue-writing' && selection?.kind === 'editor') {
      return {
        type: 'editor-insert-after',
        editorId: 'main',
        articleId: selection.articleId,
        sectionId: selection.sectionId,
        pos: selection.to,
      };
    }

    // Citation intents prefer editor insert when cursor is in the editor
    if (
      (intent === 'insert-citation-sentence' || intent === 'draft-citation') &&
      selection?.kind === 'editor'
    ) {
      return {
        type: 'editor-insert-after',
        editorId: 'main',
        articleId: selection.articleId,
        sectionId: selection.sectionId,
        pos: selection.to,
      };
    }

    if (intent === 'generate-section') {
      return { type: 'chat-message' }; // resolved later by recipe with actual section info
    }

    if (intent === 'navigate') {
      return { type: 'navigate', view: this.inferNavigationView(prompt) };
    }

    if (intent === 'run-workflow') {
      return { type: 'workflow', workflow: 'discover' };
    }

    // Default to chat message for reader selections and general queries
    return { type: 'chat-message' };
  }

  /** Extract target view from a navigation prompt via keyword matching. */
  private inferNavigationView(prompt?: string): import('../shared-types/enums').ViewType {
    if (!prompt) return 'library';
    const VIEW_KEYWORDS: Array<{ keywords: RegExp; view: import('../shared-types/enums').ViewType }> = [
      { keywords: /设置|settings|配置|偏好/i, view: 'settings' },
      { keywords: /图书馆|library|文献库|论文列表/i, view: 'library' },
      { keywords: /阅读|reader|pdf|论文阅读/i, view: 'reader' },
      { keywords: /写作|writing|编辑|editor|草稿/i, view: 'writing' },
      { keywords: /分析|analysis|结构化/i, view: 'analysis' },
      { keywords: /概念图|graph|知识图谱|关系图/i, view: 'graph' },
      { keywords: /笔记|notes|memo/i, view: 'notes' },
    ];
    for (const { keywords, view } of VIEW_KEYWORDS) {
      if (keywords.test(prompt)) return view;
    }
    return 'library';
  }
}
