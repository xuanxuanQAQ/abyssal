/**
 * SessionOrchestrator — the AI kernel of the workbench.
 *
 * Proactive mode: observes EventBus and generates suggestions/actions.
 * Decision points: workflows can pause and ask the AI for decisions.
 * Conversation state: manages conversation history for persistence.
 *
 * Chat messages are now handled by CopilotRuntime (see copilot-handler.ts).
 *
 * Architecture:
 *   EventBus events → SessionOrchestrator → CapabilityRegistry → Primitives
 *                                         ↓
 *                                   ResearchSession (context)
 *                                         ↓
 *                                   AI command events → Renderer
 */

import type { EventBus, AppEvent } from '../../core/event-bus';
import type { ResearchSession } from '../../core/session';
import type { CapabilityRegistry, OperationResult } from '../capabilities';
import type { LlmClient, Message } from '../llm-client/llm-client';
import { ToolCallingGovernor } from './tool-calling-governor';

// ─── Types ───

export interface SessionOrchestratorOptions {
  eventBus: EventBus;
  session: ResearchSession;
  capabilities: CapabilityRegistry;
  llmClient: LlmClient;
  /** Enable proactive mode (default true) */
  proactiveEnabled?: boolean;
  logger?: (msg: string, data?: unknown) => void;
}

interface ConversationState {
  messages: Message[];
  conversationId: string;
}

interface ConversationShortTermState {
  lastSelectionAt: number | null;
}

interface ProactiveRule {
  /** Event type(s) that trigger this rule */
  eventTypes: string[];
  /** Condition to check (return true to fire) */
  condition: (event: AppEvent, session: ResearchSession) => boolean;
  /** Cooldown in ms to avoid spamming */
  cooldownMs: number;
  /** Action to take */
  action: (event: AppEvent, ctx: ProactiveContext) => Promise<void>;
  /** Last time this rule fired */
  lastFired?: number;
}

interface ProactiveContext {
  session: ResearchSession;
  eventBus: EventBus;
  capabilities: CapabilityRegistry;
  llmClient: LlmClient;
}

// ─── Session Orchestrator ───

export class SessionOrchestrator {
  private readonly eventBus: EventBus;
  private readonly session: ResearchSession;
  private readonly capabilities: CapabilityRegistry;
  private readonly llmClient: LlmClient;
  private proactiveEnabled: boolean;
  private readonly logger: (msg: string, data?: unknown) => void;
  private readonly proactiveRules: ProactiveRule[] = [];
  private eventSubscription: { unsubscribe: () => void } | null = null;
  /** Tool calling governor to prevent excessive tool invocation */
  private readonly toolGovernor: ToolCallingGovernor;

  // Conversation histories keyed by conversationId.
  // 'workspace' keeps legacy behavior; UI-created chat sessions use isolated keys.
  private readonly conversations = new Map<string, ConversationState>();
  // Per-conversation short-term state used for gated prompt injection decisions.
  private readonly conversationShortTerm = new Map<string, ConversationShortTermState>();

  constructor(opts: SessionOrchestratorOptions) {
    this.eventBus = opts.eventBus;
    this.session = opts.session;
    this.capabilities = opts.capabilities;
    this.llmClient = opts.llmClient;
    this.proactiveEnabled = opts.proactiveEnabled ?? false;
    this.logger = opts.logger ?? (() => {});
    this.toolGovernor = new ToolCallingGovernor({
      maxConsecutiveFailures: 3,
      maxTotalCalls: 20,
      maxCallsPerTool: 5,
      repetitionThreshold: 2,
    });

    this.registerDefaultProactiveRules();
  }

  /**
   * Start listening to EventBus for proactive behavior.
   */
  start(): void {
    if (this.eventSubscription) return;
    this.eventSubscription = this.eventBus.onAny((event) => this.handleEvent(event));
    this.logger('[SessionOrchestrator] Started');
  }

  /**
   * Stop listening.
   */
  stop(): void {
    this.eventSubscription?.unsubscribe();
    this.eventSubscription = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Proactive mode: observe events and generate suggestions
  // ═══════════════════════════════════════════════════════════════════

  private async handleEvent(event: AppEvent): Promise<void> {
    if (!this.proactiveEnabled) return;

    for (let i = 0; i < this.proactiveRules.length; i++) {
      const rule = this.proactiveRules[i]!;
      if (!rule.eventTypes.includes(event.type)) continue;

      // Cooldown check
      const now = Date.now();
      if (rule.lastFired && now - rule.lastFired < rule.cooldownMs) continue;

      // Condition check
      if (!rule.condition(event, this.session)) continue;

      rule.lastFired = now;
      this.logger('[Orchestrator:proactive] Rule fired', {
        ruleIndex: i,
        eventType: event.type,
        eventTypes: rule.eventTypes,
      });

      try {
        await rule.action(event, {
          session: this.session,
          eventBus: this.eventBus,
          capabilities: this.capabilities,
          llmClient: this.llmClient,
        });
      } catch (err) {
        this.logger('[Orchestrator:proactive] Rule error', {
          ruleIndex: i,
          error: (err as Error).message,
        });
      }
    }
  }

  /**
   * Register default proactive rules.
   */
  private registerDefaultProactiveRules(): void {
    // Rule 1: When user opens a paper that hasn't been analyzed, suggest analysis
    this.proactiveRules.push({
      eventTypes: ['user:openPaper'],
      cooldownMs: 60_000,
      condition: (event) => {
        return (event as any).hasPdf === true;
      },
      action: async (event, ctx) => {
        const paperId = (event as any).paperId as string;
        const paper = await ctx.capabilities.execute('analysis--get_paper', { paperId });
        const data = (paper as OperationResult).data as Record<string, unknown> | null;
        if (!data) return;

        const status = data['analysisStatus'] as string;
        if (status === 'not_started') {
          ctx.eventBus.emit({
            type: 'ai:suggest',
            suggestion: {
              id: `suggest-analyze-${paperId}`,
              title: 'Run Analysis',
              description: `Paper "${(data['title'] as string)?.slice(0, 60)}" hasn't been analyzed yet. Run the analysis pipeline to extract concepts and mappings?`,
              actions: [
                { id: 'analyze', label: 'Analyze Now', primary: true },
                { id: 'dismiss', label: 'Later' },
              ],
              priority: 6,
              dismissAfterMs: 30_000,
            },
          });
        }
      },
    });

    // Rule 2: When user idles for 2+ minutes on reader, offer context-aware suggestions
    this.proactiveRules.push({
      eventTypes: ['user:idle'],
      cooldownMs: 120_000,
      condition: (event, session) => {
        return (event as any).durationMs >= 120_000
          && session.focus.currentView === 'reader'
          && session.focus.readerState != null;
      },
      action: async (_event, ctx) => {
        const readerState = ctx.session.focus.readerState;
        if (!readerState) return;

        const relatedMemory = ctx.session.memory.getRelated([readerState.paperId], 3);
        if (relatedMemory.length > 0) {
          ctx.eventBus.emit({
            type: 'ai:suggest',
            suggestion: {
              id: `suggest-continue-${Date.now()}`,
              title: 'Continue Research',
              description: `You have ${relatedMemory.length} findings related to the current paper. Want to compile them into a note?`,
              actions: [
                { id: 'create_note', label: 'Create Note', primary: true },
                { id: 'dismiss', label: 'Dismiss' },
              ],
              priority: 4,
              dismissAfterMs: 60_000,
            },
          });
        }
      },
    });

    // Rule 3: When analysis pipeline completes, suggest next steps
    this.proactiveRules.push({
      eventTypes: ['pipeline:complete'],
      cooldownMs: 30_000,
      condition: (event) => {
        const e = event as any;
        return e.workflow === 'analyze' && e.result === 'completed';
      },
      action: async (_event, ctx) => {
        const suggestions = await ctx.capabilities.execute('analysis--get_suggestions', {});
        const data = (suggestions as OperationResult).data;
        const count = Array.isArray(data) ? data.length : 0;

        if (count > 0) {
          ctx.eventBus.emit({
            type: 'ai:suggest',
            suggestion: {
              id: `suggest-review-${Date.now()}`,
              title: 'Review Suggestions',
              description: `Analysis found ${count} new concept suggestions. Review them to refine your research framework.`,
              actions: [
                { id: 'review', label: 'Review Now', primary: true },
                { id: 'dismiss', label: 'Later' },
              ],
              priority: 7,
              dismissAfterMs: 0,
            },
          });
        }
      },
    });

    // Rule 4: When user selects text in reader, offer to create annotation or memo
    this.proactiveRules.push({
      eventTypes: ['user:selectText'],
      cooldownMs: 5_000,
      condition: (event) => {
        const text = (event as any).text as string;
        return text.length >= 20; // Only for meaningful selections
      },
      action: async (event, ctx) => {
        const e = event as any;
        ctx.eventBus.emit({
          type: 'ai:suggest',
          suggestion: {
            id: `suggest-annotate-${Date.now()}`,
            title: 'Save Selection',
            description: `"${(e.text as string).slice(0, 80)}..." — Save as annotation or memo?`,
            actions: [
              { id: 'annotate', label: 'Highlight' },
              { id: 'memo', label: 'Quick Memo' },
              { id: 'ask', label: 'Ask About This', primary: true },
              { id: 'dismiss', label: 'Dismiss' },
            ],
            priority: 5,
            dismissAfterMs: 15_000,
          },
        });
      },
    });

    // Rule 5: When multiple papers are being compared (rapid switching), offer comparison
    this.proactiveRules.push({
      eventTypes: ['user:openPaper'],
      cooldownMs: 60_000,
      condition: (_event, session) => {
        // Check if user has opened 2+ papers in the last 2 minutes
        const recentOpens = session.trajectory
          .filter((t) => t.action === 'Open paper' && Date.now() - t.timestamp < 120_000);
        return recentOpens.length >= 2;
      },
      action: async (_event, ctx) => {
        const recentPapers = ctx.session.focus.activePapers.slice(0, 3);
        if (recentPapers.length < 2) return;

        ctx.eventBus.emit({
          type: 'ai:suggest',
          suggestion: {
            id: `suggest-compare-${Date.now()}`,
            title: 'Compare Papers',
            description: `You've been looking at ${recentPapers.length} papers recently. Want to compare their methods or findings?`,
            actions: [
              { id: 'compare', label: 'Compare', primary: true },
              { id: 'dismiss', label: 'Dismiss' },
            ],
            priority: 5,
            dismissAfterMs: 30_000,
          },
        });
      },
    });
  }

  /**
   * Add a custom proactive rule.
   */
  addProactiveRule(rule: Omit<ProactiveRule, 'lastFired'>): void {
    this.proactiveRules.push({ ...rule });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Decision points: workflows can pause and ask the AI
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle a decision point from a running workflow.
   * The AI evaluates the question using session context and returns a decision.
   */
  async handleDecisionPoint(
    taskId: string,
    workflow: string,
    question: string,
    options: Array<{ id: string; label: string; description?: string }>,
  ): Promise<string> {
    this.logger('[Orchestrator:decision] Start', {
      taskId,
      workflow,
      questionLen: question.length,
      optionCount: options.length,
    });
    const sessionContext = this.session.buildContextForPrompt();

    const decisionPrompt = `You are making a decision during the "${workflow}" pipeline (task: ${taskId}).

${sessionContext}

Question: ${question}

Options:
${options.map((o) => `- ${o.id}: ${o.label}${o.description ? ' — ' + o.description : ''}`).join('\n')}

Choose the best option based on the current research context. Reply with ONLY the option ID.`;

    try {
      const result = await this.llmClient.complete({
        systemPrompt: 'You are a research assistant making pipeline decisions.',
        messages: [{ role: 'user', content: decisionPrompt }],
        maxTokens: 50,
        temperature: 0.1,
        workflowId: 'agent',
      });

      const chosenId = result.text.trim();
      const validOption = options.find((o) => o.id === chosenId);
      this.logger('[Orchestrator:decision] Resolved', {
        taskId,
        workflow,
        chosen: validOption?.id ?? chosenId,
        valid: !!validOption,
      });

      this.session.memory.add({
        type: 'decision',
        content: `Pipeline ${workflow} decision: "${question}" → ${validOption?.label ?? chosenId}`,
        source: `pipeline:${workflow}`,
        linkedEntities: [],
        importance: 0.6,
      });

      return validOption ? validOption.id : options[0]?.id ?? '';
    } catch {
      // Fallback to default
      return options[0]?.id ?? '';
    }
  }

  /**
   * Toggle proactive mode at runtime (e.g. from settings UI).
   */
  setProactiveEnabled(enabled: boolean): void {
    this.proactiveEnabled = enabled;
    this.logger('[SessionOrchestrator] Proactive mode ' + (enabled ? 'enabled' : 'disabled'));
  }

  /**
   * Clear the unified conversation history.
   */
  clearConversation(conversationId?: string): void {
    if (conversationId) {
      this.conversations.delete(conversationId);
      this.conversationShortTerm.delete(conversationId);
      return;
    }
    this.conversations.clear();
    this.conversationShortTerm.clear();
    // Also reset tool governor when clearing all conversations
    this.toolGovernor.reset();
  }

  /**
   * Get tool calling statistics for debugging/monitoring.
   */
  getToolCallingStats() {
    return this.toolGovernor.getStats();
  }

  /**
   * Serialize conversation history for persistence across restarts.
   * Only serializes text messages (tool_use/tool_result blocks are omitted
   * since they reference ephemeral tool call IDs).
   */
  serializeConversation(): string | null {
    const workspaceConversation = this.conversations.get('workspace');
    if (!workspaceConversation || workspaceConversation.messages.length === 0) return null;
    // Keep only simple text messages for restoration
    const simplified = workspaceConversation.messages
      .filter((m) => typeof m.content === 'string')
      .slice(-20); // Keep last 20 text messages
    return JSON.stringify(simplified);
  }

  /**
   * Restore conversation from serialized state (on startup).
   */
  restoreConversation(json: string): void {
    try {
      const messages = JSON.parse(json) as Message[];
      if (Array.isArray(messages) && messages.length > 0) {
        this.conversations.set('workspace', { messages, conversationId: 'workspace' });
        this.logger('[Orchestrator] Conversation restored', { messageCount: messages.length });
      }
    } catch {
      this.logger('[Orchestrator] Failed to restore conversation');
    }
  }

  /**
   * Full cleanup.
   */
  destroy(): void {
    this.stop();
    this.conversations.clear();
    this.conversationShortTerm.clear();
    this.proactiveRules.length = 0;
  }
}
