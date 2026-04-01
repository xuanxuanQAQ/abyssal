/**
 * SessionOrchestrator — the AI kernel of the workbench.
 *
 * Dual-mode operation:
 * 1. Reactive: responds to user chat messages (enhanced AgentLoop)
 * 2. Proactive: observes EventBus and generates suggestions/actions
 *
 * Replaces the previous separation of AgentLoop + WorkflowRunner
 * with a unified orchestration layer that has full session awareness.
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
import type { LlmClient, Message, ContentBlock } from '../llm-client/llm-client';
import type { PushManager } from '../../electron/ipc/push';
import type { AgentStreamEvent } from '../../shared-types/ipc';
import { countTokens } from '../llm-client/token-counter';

// ─── Types ───

export interface SessionOrchestratorOptions {
  eventBus: EventBus;
  session: ResearchSession;
  capabilities: CapabilityRegistry;
  llmClient: LlmClient;
  pushManager: PushManager | null;
  /** System prompt builder for the current context */
  buildSystemPrompt: () => Promise<string>;
  /** Maximum tool-use rounds per user message (default 15) */
  maxRounds?: number;
  /** Enable proactive mode (default true) */
  proactiveEnabled?: boolean;
  logger?: (msg: string, data?: unknown) => void;
}

interface ConversationState {
  messages: Message[];
  conversationId: string;
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
  private readonly pushManager: PushManager | null;
  private readonly buildSystemPrompt: () => Promise<string>;
  private readonly maxRounds: number;
  private proactiveEnabled: boolean;
  private readonly logger: (msg: string, data?: unknown) => void;
  private readonly proactiveRules: ProactiveRule[] = [];
  private eventSubscription: { unsubscribe: () => void } | null = null;

  // Single unified conversation per workspace (context switching does NOT split conversations)
  private conversation: ConversationState | null = null;

  constructor(opts: SessionOrchestratorOptions) {
    this.eventBus = opts.eventBus;
    this.session = opts.session;
    this.capabilities = opts.capabilities;
    this.llmClient = opts.llmClient;
    this.pushManager = opts.pushManager;
    this.buildSystemPrompt = opts.buildSystemPrompt;
    this.maxRounds = opts.maxRounds ?? 15;
    this.proactiveEnabled = opts.proactiveEnabled ?? false;
    this.logger = opts.logger ?? (() => {});

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
  // Reactive mode: handle user chat messages
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Process a user message through the capability-aware agent loop.
   *
   * This is the upgraded version of AgentLoop.run(), with:
   * - Session context injection
   * - Capability-based tools (instead of atomic tools)
   * - Working memory integration
   * - Cross-pipeline operation chaining
   */
  async handleUserMessage(
    userMessage: string,
    contextHint: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const conversationId = 'workspace';
    const startMs = Date.now();
    this.logger('[Orchestrator:chat] Start', {
      contextHint,
      msgLen: userMessage.length,
      activePapers: this.session.focus.activePapers.length,
      view: this.session.focus.currentView,
    });

    // Single unified conversation — context switches don't split history
    if (!this.conversation) {
      this.conversation = { messages: [], conversationId };
      this.logger('[Orchestrator:chat] New conversation created');
    }
    const conversation = this.conversation;

    // Build system prompt with session context
    let systemPrompt = await this.buildSystemPrompt();
    const sessionContext = this.session.buildContextForPrompt();
    systemPrompt += '\n\n' + sessionContext;
    this.logger('[Orchestrator:chat] Prompt built', {
      systemPromptLen: systemPrompt.length,
      sessionContextLen: sessionContext.length,
      historyLen: conversation.messages.length,
    });

    // Append user message
    conversation.messages.push({ role: 'user', content: userMessage });

    // Trim history (token-aware with LLM summary bridge)
    await this.trimHistory(conversation.messages);

    let fullText = '';
    let round = 0;

    // Tool call dedup detection
    const recentCalls: Array<{ name: string; hash: string }> = [];
    let consecutiveDupes = 0;

    while (round < this.maxRounds) {
      if (signal?.aborted) break;

      // Get tool definitions from capabilities
      const tools = round < this.maxRounds - 1
        ? this.capabilities.toToolDefinitions()
        : undefined; // Last round: no tools, force text reply

      this.logger('[Orchestrator:chat] Round start', {
        round,
        toolCount: tools?.length ?? 0,
        historyMsgs: conversation.messages.length,
      });

      let stream: AsyncIterable<any>;
      try {
        stream = this.llmClient.completeStream({
          systemPrompt,
          messages: conversation.messages,
          ...(tools !== undefined && { tools }),
          workflowId: 'agent',
          ...(signal && { signal }),
        });
      } catch (err) {
        this.logger('[Orchestrator:chat] Stream init error', { error: (err as Error).message });
        this.push(conversationId, { type: 'error', conversationId, code: 'STREAM_ERROR', message: (err as Error).message });
        return;
      }

      const pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        if (chunk.type === 'text_delta') {
          fullText += chunk.delta;
          this.push(conversationId, { type: 'text_delta', conversationId, delta: chunk.delta });
        } else if (chunk.type === 'tool_use_end') {
          pendingToolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
          this.push(conversationId, { type: 'tool_use_start', conversationId, toolName: chunk.name, args: chunk.input });
        } else if (chunk.type === 'message_end') {
          if (pendingToolCalls.length === 0) {
            // No tools — conversation turn complete
            conversation.messages.push({ role: 'assistant', content: fullText });
            this.push(conversationId, { type: 'done', conversationId, fullText, usage: chunk.usage });
            return;
          }
        } else if (chunk.type === 'error') {
          this.push(conversationId, { type: 'error', conversationId, code: chunk.code, message: chunk.message });
          return;
        }
      }

      if (pendingToolCalls.length === 0) break;

      // Execute capability operations
      const toolResults = await Promise.all(
        pendingToolCalls.map(async (tc) => {
          // Dedup check
          const hash = simpleHash(tc.name + JSON.stringify(tc.input));
          const isDupe = recentCalls.slice(-3).some((r) => r.name === tc.name && r.hash === hash);
          recentCalls.push({ name: tc.name, hash });

          if (isDupe) {
            consecutiveDupes++;
            this.logger('[Orchestrator:chat] Tool dedup blocked', { tool: tc.name });
            return `System: Tool "${tc.name}" was already called with these arguments. Use the previous result.`;
          }
          consecutiveDupes = 0;

          // Execute via CapabilityRegistry
          const execStart = Date.now();
          const result = await this.capabilities.execute(tc.name, tc.input, signal);
          this.logger('[Orchestrator:chat] Tool executed', {
            tool: tc.name,
            success: result.success,
            durationMs: Date.now() - execStart,
            summaryLen: result.summary?.length ?? 0,
          });
          let resultStr = JSON.stringify(result, null, 2);
          if (resultStr.length > 50000) resultStr = resultStr.slice(0, 50000) + '\n[truncated]';
          return resultStr;
        }),
      );

      // Push results to frontend
      for (let i = 0; i < pendingToolCalls.length; i++) {
        this.push(conversationId, {
          type: 'tool_use_result',
          conversationId,
          toolName: pendingToolCalls[i]!.name,
          result: toolResults[i]!,
        });
      }

      // Build message history entries
      const assistantContent: ContentBlock[] = [];
      if (fullText.trim()) {
        assistantContent.push({ type: 'text', text: fullText });
      }
      for (const tc of pendingToolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      conversation.messages.push({ role: 'assistant', content: assistantContent });

      const toolResultBlocks: ContentBlock[] = pendingToolCalls.map((tc, i) => ({
        type: 'tool_result' as const,
        toolUseId: tc.id,
        content: toolResults[i]!,
      }));
      conversation.messages.push({ role: 'user', content: toolResultBlocks });

      fullText = '';
      round++;

      // Force text-only on excessive dupes
      if (consecutiveDupes >= 2) break;
    }

    if (round >= this.maxRounds) {
      fullText += '\n\n[Reached maximum capability rounds]';
      this.logger('[Orchestrator:chat] Max rounds reached', { rounds: round });
    }
    conversation.messages.push({ role: 'assistant', content: fullText });
    this.push(conversationId, { type: 'done', conversationId, fullText, usage: { inputTokens: 0, outputTokens: 0 } });
    this.logger('[Orchestrator:chat] Complete', {
      contextHint,
      rounds: round,
      replyLen: fullText.length,
      durationMs: Date.now() - startMs,
    });
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

  // ─── Internals ───

  /**
   * Token-aware conversation trimming with LLM summary bridge.
   *
   * When the conversation exceeds HISTORY_TOKEN_BUDGET:
   * 1. Keep the last KEEP_RECENT messages untouched (recent context)
   * 2. Summarize older messages via a fast LLM call
   * 3. Replace old messages with a single summary "bridge" message
   *
   * Falls back to naive truncation if the LLM summary call fails.
   */
  private async trimHistory(messages: Message[]): Promise<void> {
    const HISTORY_TOKEN_BUDGET = 12_000;
    const KEEP_RECENT = 6; // Always preserve last 3 user-assistant rounds

    // Fast path: estimate total tokens
    const totalTokens = this.estimateMessagesTokens(messages);
    if (totalTokens <= HISTORY_TOKEN_BUDGET) return;

    // Need at least KEEP_RECENT + 2 messages to have something to summarize
    if (messages.length <= KEEP_RECENT + 1) return;

    const oldMessages = messages.slice(0, messages.length - KEEP_RECENT);
    const recentMessages = messages.slice(-KEEP_RECENT);

    // Try LLM-based summary
    let summaryText: string | null = null;
    try {
      summaryText = await this.summarizeMessages(oldMessages);
    } catch {
      this.logger('[Orchestrator:trim] Summary generation failed, falling back to truncation');
    }

    messages.length = 0;
    if (summaryText) {
      messages.push(
        { role: 'user', content: `[Conversation Summary]\n${summaryText}` },
        { role: 'assistant', content: 'Understood. I have the context from our previous discussion.' },
        ...recentMessages,
      );
      this.logger('[Orchestrator:trim] History condensed via summary', {
        oldMsgCount: oldMessages.length,
        summaryTokens: countTokens(summaryText),
        keptRecent: recentMessages.length,
      });
    } else {
      // Fallback: just keep recent messages
      messages.push(...recentMessages);
      this.logger('[Orchestrator:trim] History truncated (no summary)', {
        dropped: oldMessages.length,
        kept: recentMessages.length,
      });
    }
  }

  /**
   * Estimate token count for an array of messages.
   */
  private estimateMessagesTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += countTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            total += countTokens(block.text);
          } else if (block.type === 'tool_result' && block.content) {
            total += countTokens(block.content);
          } else if (block.type === 'tool_use') {
            // Rough estimate for tool call serialization
            total += countTokens(JSON.stringify(block.input ?? {})) + 20;
          }
        }
      }
    }
    return total;
  }

  /**
   * Summarize a set of older messages into a concise paragraph
   * using a fast LLM call.
   */
  private async summarizeMessages(messages: Message[]): Promise<string> {
    // Extract only text content for the summary prompt
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      if (typeof msg.content === 'string') {
        // Skip summary bridge messages — extract their content
        const text = msg.content.startsWith('[Conversation Summary]')
          ? msg.content.slice('[Conversation Summary]\n'.length)
          : msg.content;
        if (text.trim()) lines.push(`${role}: ${text.slice(0, 500)}`);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text?.trim()) {
            lines.push(`${role}: ${block.text.slice(0, 500)}`);
          }
        }
      }
    }

    if (lines.length === 0) return '';

    // Cap the input to avoid excessive summary prompt size
    const transcript = lines.join('\n').slice(0, 8000);

    const result = await this.llmClient.complete({
      systemPrompt: 'You are a conversation summarizer. Produce a concise summary (2-4 sentences) of the conversation transcript below. Focus on: key topics discussed, decisions made, and any pending questions. Write in the same language as the conversation.',
      messages: [{ role: 'user', content: transcript }],
      maxTokens: 300,
      temperature: 0,
      workflowId: 'agent',
    });

    return result.text.trim();
  }

  private push(conversationId: string, chunk: AgentStreamEvent): void {
    this.pushManager?.pushAgentStream(chunk);
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
  clearConversation(): void {
    this.conversation = null;
  }

  /**
   * Serialize conversation history for persistence across restarts.
   * Only serializes text messages (tool_use/tool_result blocks are omitted
   * since they reference ephemeral tool call IDs).
   */
  serializeConversation(): string | null {
    if (!this.conversation || this.conversation.messages.length === 0) return null;
    // Keep only simple text messages for restoration
    const simplified = this.conversation.messages
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
        this.conversation = { messages, conversationId: 'workspace' };
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
    this.conversation = null;
    this.proactiveRules.length = 0;
  }
}

// ─── Helpers ───

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
