/**
 * Agent Loop — tool-use conversation engine with streaming relay.
 *
 * Implements the §7.3 loop: stream LLM → on tool_use_end execute read-only
 * tool → append result → re-invoke LLM → max 10 rounds.
 *
 * History management (§7.4): 10-round trim, context window protection.
 *
 * See spec: section 7
 */

import type { LlmClient, Message, ContentBlock } from '../llm-client/llm-client';
import type { PushManager } from '../../electron/ipc/push';
import type { AgentStreamEvent, ChatContext } from '../../shared-types/ipc';
import type { ToolRegistry } from './tool-registry';
import { buildSystemPrompt, type SystemPromptContext } from './system-prompt-builder';
import { formatPlanForPrompt, advancePlan, isPlanComplete, type ExecutionPlan } from './plan-executor';
import { AgentMemory } from './agent-memory';

// ─── Types ───

export interface AgentLoopOptions {
  llmClient: LlmClient;
  toolRegistry: ToolRegistry;
  pushManager: PushManager | null;
  getSystemPromptContext: (chatContext?: ChatContext) => Promise<SystemPromptContext>;
}

export interface ConversationState {
  messages: Message[];
  conversationId: string;
}

// ─── Agent Loop ───

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly toolRegistry: ToolRegistry;
  private readonly pushManager: PushManager | null;
  private readonly getCtx: (chatContext?: ChatContext) => Promise<SystemPromptContext>;
  private readonly memory: AgentMemory;

  // System prompt cache: keyed by contextKey, TTL 60s.
  // Different papers/concepts get different system prompts.
  private cachedSystemPrompt: string | null = null;
  private cachedSystemPromptKey: string | null = null;
  private systemPromptCacheTime = 0;
  private static readonly SYSTEM_PROMPT_TTL = 60_000;

  constructor(opts: AgentLoopOptions) {
    this.llmClient = opts.llmClient;
    this.toolRegistry = opts.toolRegistry;
    this.pushManager = opts.pushManager;
    this.getCtx = opts.getSystemPromptContext;
    this.memory = new AgentMemory();
  }

  /** Get or build system prompt with TTL cache, keyed by ChatContext. */
  private async getSystemPrompt(chatContext?: ChatContext): Promise<string> {
    const now = Date.now();
    const cacheKey = chatContext?.contextKey ?? 'global';

    // Cache hit: same context key and within TTL
    if (
      this.cachedSystemPrompt &&
      this.cachedSystemPromptKey === cacheKey &&
      now - this.systemPromptCacheTime < AgentLoop.SYSTEM_PROMPT_TTL
    ) {
      return this.cachedSystemPrompt;
    }

    const promptCtx = await this.getCtx(chatContext);
    this.cachedSystemPrompt = buildSystemPrompt(promptCtx);
    this.cachedSystemPromptKey = cacheKey;
    this.systemPromptCacheTime = now;
    return this.cachedSystemPrompt;
  }

  /** Invalidate system prompt cache (call after data changes). */
  invalidateSystemPromptCache(): void {
    this.cachedSystemPrompt = null;
  }

  /**
   * Run a single user turn through the agent loop.
   *
   * Streams tokens to PushManager, executes tools on tool_use_end,
   * re-invokes LLM with tool results, up to maxRounds.
   *
   * @param chatContext  Frontend context: which paper/concept the user is viewing.
   *                     Injected into system prompt so the LLM knows the focus.
   */
  async run(
    userMessage: string,
    conversation: ConversationState,
    chatContext?: ChatContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const MAX_ROUNDS = 10;
    const conversationId = conversation.conversationId;

    // Build system prompt with active paper/concept context
    let baseSystemPrompt = await this.getSystemPrompt(chatContext);

    // ── Recall relevant memories and inject into system prompt ──
    const recalled = this.memory.recall(userMessage, 5);
    if (recalled.length > 0) {
      baseSystemPrompt += '\n\n' + this.memory.formatForPrompt(recalled);
    }

    // ── Plan detection: check if this is a multi-step workflow ──
    const plan = detectWorkflowPlan(userMessage);
    let systemPrompt = baseSystemPrompt;
    if (plan) {
      plan.steps[0]!.status = 'in_progress';
      systemPrompt = baseSystemPrompt + '\n\n' + formatPlanForPrompt(plan);
    }

    // Append user message
    conversation.messages.push({ role: 'user', content: userMessage });

    // Trim history before calling (§7.4)
    this.trimHistory(conversation.messages);
    this.protectContextWindow(conversation.messages, systemPrompt);

    // fullText accumulates ONLY the final assistant text output (not tool-call rounds).
    // Each tool-call round's text is captured separately and appended to messages,
    // so the LLM doesn't see its own partial text repeated.
    let fullText = '';
    let round = 0;

    // Tool hallucination detection: track recent tool calls to detect loops.
    const recentToolCalls: Array<{ name: string; argsHash: string }> = [];
    const DUPLICATE_WINDOW = 3;
    const MAX_TRACKED_CALLS = DUPLICATE_WINDOW * 2;

    // Zero-yield detection: count consecutive tool calls returning empty/trivial results.
    // Prevents LLM from wasting rounds on futile searches with slightly varied queries.
    let consecutiveEmptyResults = 0;
    const MAX_CONSECUTIVE_EMPTY = 3;

    // Count duplicate tool calls that were blocked. If too many in a row,
    // force the loop to end and produce whatever text we have.
    let consecutiveDuplicates = 0;
    const MAX_CONSECUTIVE_DUPLICATES = 2;

    let stripTools = false; // When true, next LLM round gets no tools (forces text-only reply)

    while (round < MAX_ROUNDS) {
      if (signal?.aborted) break;

      let stream: AsyncIterable<any>;
      try {
        stream = this.llmClient.completeStream({
          systemPrompt,
          messages: conversation.messages,
          ...(!stripTools && { tools: this.toolRegistry.getToolDefinitions() }),
          workflowId: 'agent',
          ...(signal != null && { signal }),
        });
      } catch (err) {
        throw err;
      }

      let needsReInvoke = false;
      // Collect all tool calls from a single LLM response for parallel execution
      const pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let streamEndUsage: { inputTokens: number; outputTokens: number } | null = null;

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        if (chunk.type === 'text_delta') {
          fullText += chunk.delta;
          this.push(conversationId, { type: 'text_delta', conversationId, delta: chunk.delta });
        } else if (chunk.type === 'tool_use_end') {
          // Collect tool call — don't execute yet, wait for all tools
          pendingToolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
          this.push(conversationId, {
            type: 'tool_use_start',
            conversationId,
            toolName: chunk.name,
            args: chunk.input,
          });
        } else if (chunk.type === 'message_end') {
          streamEndUsage = chunk.usage;
          if (pendingToolCalls.length === 0) {
            // No tool calls — conversation turn complete
            conversation.messages.push({ role: 'assistant', content: fullText });
            this.push(conversationId, {
              type: 'done',
              conversationId,
              fullText,
              usage: chunk.usage,
            });
            return;
          }
          // Has tool calls — will execute below after collecting all
        } else if (chunk.type === 'error') {
          this.push(conversationId, {
            type: 'error',
            conversationId,
            code: chunk.code,
            message: chunk.message,
          });
          return;
        }
      }

      // ── Execute collected tool calls (parallel when multiple) ──

      if (pendingToolCalls.length === 0) break; // Stream ended without tools or message_end

      // Check for duplicates / hallucinations before executing
      let forceStop = false;
      const toolCallsToExecute: Array<{
        id: string; name: string; input: Record<string, unknown>;
        isDuplicate: boolean;
      }> = [];

      for (const tc of pendingToolCalls) {
        const argsHash = simpleHash(tc.name + JSON.stringify(tc.input));
        const isDuplicate = recentToolCalls
          .slice(-DUPLICATE_WINDOW)
          .some((prev) => prev.name === tc.name && prev.argsHash === argsHash);
        recentToolCalls.push({ name: tc.name, argsHash });
        while (recentToolCalls.length > MAX_TRACKED_CALLS) recentToolCalls.shift();

        if (isDuplicate) {
          consecutiveDuplicates++;
          if (consecutiveDuplicates >= MAX_CONSECUTIVE_DUPLICATES) {
            forceStop = true;
          }
        } else {
          consecutiveDuplicates = 0;
        }
        toolCallsToExecute.push({ ...tc, isDuplicate });
      }

      // Execute all tool calls in parallel
      const executeOne = async (tc: typeof toolCallsToExecute[0]): Promise<string> => {
        if (tc.isDuplicate) {
          return `System Notice: Tool "${tc.name}" was already called with the same arguments. The previous result is still in the conversation — use it to proceed to the NEXT step of the workflow (e.g. after search_papers, call import_paper; after import_paper, call acquire_fulltext). Do NOT repeat the same tool call.`;
        }
        if (!tc.isDuplicate && consecutiveEmptyResults >= MAX_CONSECUTIVE_EMPTY) {
          consecutiveEmptyResults = 0;
          return `System Notice: Your last ${MAX_CONSECUTIVE_EMPTY} tool calls returned empty results. Try a different tool or approach — for example, if searching didn't find results, try different search terms or explain what you found to the user.`;
        }
        if (!this.toolRegistry.has(tc.name)) {
          return `Error: Unknown tool '${tc.name}'`;
        }
        try {
          const result = await this.toolRegistry.execute(tc.name, tc.input);
          let resultStr = JSON.stringify(result, null, 2);
          if (resultStr.length > 50000) {
            resultStr = resultStr.slice(0, 50000) + '\n... [truncated]';
          }
          if (isEmptyResult(result)) {
            consecutiveEmptyResults++;
          } else {
            consecutiveEmptyResults = 0;
          }
          // Append workflow context hint for chained tools
          const hint = getNextStepHint(tc.name, result);
          if (hint) {
            resultStr += '\n\n' + hint;
          }
          return resultStr;
        } catch (err) {
          return `Error executing tool: ${(err as Error).message}`;
        }
      };

      const toolResults = await Promise.all(toolCallsToExecute.map(executeOne));

      // Record successful tool findings to short-term memory
      for (let i = 0; i < toolCallsToExecute.length; i++) {
        const tc = toolCallsToExecute[i]!;
        const res = toolResults[i]!;
        if (!tc.isDuplicate && !res.startsWith('Error') && !res.startsWith('System Notice')) {
          // Store a compact summary — not the full JSON
          const summary = extractToolFindingSummary(tc.name, res);
          if (summary) {
            this.memory.addShortTerm(summary, tc.name, 'tool_finding');
          }
        }
      }

      // Push results to frontend
      for (let i = 0; i < toolCallsToExecute.length; i++) {
        this.push(conversationId, {
          type: 'tool_use_result',
          conversationId,
          toolName: toolCallsToExecute[i]!.name,
          result: toolResults[i]!,
        });
      }

      // Build assistant message with text + all tool_use blocks
      const assistantContent: ContentBlock[] = [];
      if (fullText.trim()) {
        assistantContent.push({ type: 'text', text: fullText });
      }
      for (const tc of toolCallsToExecute) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      conversation.messages.push({ role: 'assistant', content: assistantContent });

      // Build user message with all tool_result blocks
      const toolResultBlocks: ContentBlock[] = toolCallsToExecute.map((tc, i) => ({
        type: 'tool_result' as const,
        toolUseId: tc.id,
        content: toolResults[i]!,
      }));
      conversation.messages.push({ role: 'user', content: toolResultBlocks });

      // ── Advance plan based on which tools were executed ──
      if (plan && !isPlanComplete(plan)) {
        const executedToolNames = toolCallsToExecute
          .filter((tc) => !tc.isDuplicate)
          .map((tc) => tc.name);
        const currentStep = plan.steps.find((s) => s.status === 'in_progress');
        if (currentStep) {
          const summary = executedToolNames.join(', ');
          advancePlan(plan, currentStep.index, summary);
        }
        // Re-inject updated plan into system prompt so LLM sees progress
        systemPrompt = baseSystemPrompt + '\n\n' + formatPlanForPrompt(plan);
      }

      fullText = '';
      round++;
      needsReInvoke = true;

      // Too many duplicate tool calls → give LLM one more round with no tools,
      // forcing it to produce a text-only reply instead of silently dying.
      if (forceStop) {
        stripTools = true;
      }

      if (!needsReInvoke) break;
    }

    // Max rounds reached
    if (round >= MAX_ROUNDS) {
      fullText += '\n\n[Reached maximum tool-use rounds]';
    }
    conversation.messages.push({ role: 'assistant', content: fullText });
    this.push(conversationId, {
      type: 'done',
      conversationId,
      fullText,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }

  /**
   * Trim conversation history with compaction (§7.4).
   *
   * Three-tier strategy:
   * 1. Always preserve the FIRST user message (original intent)
   * 2. If a compaction summary exists (index 1), keep it
   * 3. Keep the most recent 6 rounds (12 messages) intact
   * 4. Compact everything in between into a summary message
   *
   * The summary preserves semantic context (tool results, key findings)
   * while dramatically reducing token count vs. raw message dropping.
   */
  private trimHistory(messages: Message[]): void {
    const MAX_RECENT = 12; // 6 rounds × 2 messages
    if (messages.length <= MAX_RECENT + 1) return; // +1 for first message

    const firstMessage = messages[0]!;
    const recent = messages.slice(-MAX_RECENT);

    // Extract messages to compact (between first and recent)
    const toCompact = messages.slice(1, -MAX_RECENT);
    if (toCompact.length === 0) return;

    // Build compact summary from discarded messages
    const summary = compactMessages(toCompact);

    // Check if index 1 is already a compaction summary — merge if so
    const existingSummary = toCompact[0];
    const isExistingCompaction = typeof existingSummary?.content === 'string'
      && existingSummary.content.startsWith('[Conversation Summary]');

    let summaryMessage: Message;
    if (isExistingCompaction) {
      // Merge old summary with new compacted content
      const oldSummary = existingSummary!.content as string;
      summaryMessage = {
        role: 'user',
        content: oldSummary + '\n\n' + summary,
      };
    } else {
      summaryMessage = {
        role: 'user',
        content: '[Conversation Summary]\n' + summary,
      };
    }

    messages.length = 0;
    messages.push(firstMessage, summaryMessage, ...recent);
  }

  /**
   * Protect context window: compact oldest messages if total > 70% of window.
   *
   * Uses token counting to determine when compaction is needed.
   * Never removes index 0 (first user message / original intent).
   */
  private protectContextWindow(messages: Message[], systemPrompt: string): void {
    const windowSize = this.llmClient.getContextWindow('agent');
    const maxInput = windowSize * 0.7;

    const countMsgTokens = (msg: Message): number => {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((b) => b.text ?? b.content ?? '').join('');
      return this.llmClient.countTokens(text, 'agent');
    };

    let totalTokens = this.llmClient.countTokens(systemPrompt, 'agent');
    for (const msg of messages) {
      totalTokens += countMsgTokens(msg);
    }

    if (totalTokens <= maxInput) return;

    // Aggressively compact from index 1 toward the end, preserving index 0 and last 3
    while (totalTokens > maxInput && messages.length > 3) {
      const removed = messages.splice(1, 1)[0]!;
      totalTokens -= countMsgTokens(removed);
    }
  }

  private push(_conversationId: string, chunk: AgentStreamEvent): void {
    this.pushManager?.pushAgentStream(chunk);
  }
}

// ─── Helpers ───

/**
 * Compact a sequence of messages into a concise text summary.
 *
 * Extracts key information from each message type:
 * - User messages: question/instruction text
 * - Assistant messages: conclusions, not full reasoning
 * - Tool use: tool name + abbreviated result
 * - Tool result: key findings only
 *
 * This is a synchronous, heuristic-based compactor (no LLM call).
 * For deeper compression, an LLM summarization step can be added later.
 */
function compactMessages(messages: Message[]): string {
  const lines: string[] = [];
  const MAX_TOOL_RESULT_CHARS = 200;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      // Plain text message — keep first 300 chars
      const text = msg.content.trim();
      if (!text) continue;
      const prefix = msg.role === 'user' ? 'Q' : 'A';
      lines.push(`[${prefix}] ${text.length > 300 ? text.slice(0, 300) + '...' : text}`);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          const prefix = msg.role === 'user' ? 'Q' : 'A';
          const text = block.text.trim();
          if (text) {
            lines.push(`[${prefix}] ${text.length > 300 ? text.slice(0, 300) + '...' : text}`);
          }
        } else if (block.type === 'tool_use') {
          const argsStr = JSON.stringify(block.input ?? {});
          const shortArgs = argsStr.length > 100 ? argsStr.slice(0, 100) + '...' : argsStr;
          lines.push(`[Tool] ${block.name}(${shortArgs})`);
        } else if (block.type === 'tool_result' && block.content) {
          const result = block.content;
          const short = result.length > MAX_TOOL_RESULT_CHARS
            ? result.slice(0, MAX_TOOL_RESULT_CHARS) + '...'
            : result;
          lines.push(`[Result] ${short}`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Detect empty/trivial tool results for zero-yield protection.
 * Returns true if the result is empty array, null, empty object, or error object.
 */
function isEmptyResult(result: unknown): boolean {
  if (result == null) return true;
  if (Array.isArray(result) && result.length === 0) return true;
  if (typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    // Note: error responses are NOT counted as empty — they carry meaningful
    // feedback the LLM should act on (e.g. "service not configured").
    if (Object.keys(obj).length === 0) return true;
    // Check for { chunks: [] } pattern from RAG
    if (Array.isArray(obj['chunks']) && (obj['chunks'] as unknown[]).length === 0) return true;
    if (Array.isArray(obj['items']) && (obj['items'] as unknown[]).length === 0) return true;
  }
  return false;
}

/** Fast non-crypto hash for tool call deduplication. */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

// ─── Memory extraction ───

/**
 * Extract a compact summary from a tool result for short-term memory.
 * Returns null if the result is not worth remembering.
 */
function extractToolFindingSummary(toolName: string, resultStr: string): string | null {
  try {
    const result = JSON.parse(resultStr);

    switch (toolName) {
      case 'search_papers': {
        if (!Array.isArray(result) || result.length === 0) return null;
        const titles = result.slice(0, 3).map((p: Record<string, unknown>) => p['title']).filter(Boolean);
        return `Found ${result.length} papers: ${titles.join('; ')}`;
      }
      case 'query_papers': {
        const items = (result as Record<string, unknown>)['items'] as unknown[] | undefined;
        if (!Array.isArray(items)) return null;
        if (items.length === 0) return 'No matching papers in local library';
        const titles = items.slice(0, 3).map((p) => (p as Record<string, unknown>)['title']).filter(Boolean);
        return `Library has ${items.length} matching papers: ${titles.join('; ')}`;
      }
      case 'import_paper': {
        const obj = result as Record<string, unknown>;
        if (obj['status'] === 'imported') return `Imported paper "${obj['paperId']}" — acquisition ${obj['taskId'] ? 'started' : 'not triggered'}`;
        if (obj['status'] === 'already_exists') return `Paper "${obj['paperId']}" already in library`;
        return null;
      }
      case 'retrieve': {
        const chunks = (result as Record<string, unknown>)['chunks'];
        if (!Array.isArray(chunks) || chunks.length === 0) return null;
        return `Retrieved ${chunks.length} relevant passages`;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── Workflow context hints ───

/**
 * After a tool returns results, provide a contextual hint about the next step.
 * This prevents the LLM from stopping mid-workflow by explicitly stating
 * what action should follow.
 */
function getNextStepHint(toolName: string, result: unknown): string | null {
  const obj = result as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return null;

  // Error results — no hint, let the LLM handle the error
  if (obj['error']) return null;

  switch (toolName) {
    case 'search_papers': {
      // Search returned results → tell LLM to import
      if (Array.isArray(result) && result.length > 0) {
        return '[Next step: Call import_paper with the best matching result above (pass title, authors, year, doi, arxivId, abstract, venue). Set acquire=true to auto-download the fulltext.]';
      }
      if (Array.isArray(result) && result.length === 0) {
        return '[Search returned no results. Try different search terms, or tell the user the paper was not found.]';
      }
      return null;
    }
    case 'query_papers': {
      // Local query returned results → paper exists
      const items = obj['items'] as unknown[] | undefined;
      if (Array.isArray(items) && items.length > 0) {
        return '[Paper found in local library. Check its fulltextStatus — if not "available", call acquire_fulltext with the paperId. If already available, inform the user.]';
      }
      // Not found locally → search externally
      return '[Paper not found in local library. Call search_papers to search external databases (Semantic Scholar).]';
    }
    case 'import_paper': {
      if (obj['status'] === 'imported' && obj['taskId']) {
        return '[Paper imported and fulltext acquisition started. Inform the user that the paper has been added and is being downloaded.]';
      }
      if (obj['status'] === 'already_exists') {
        return '[Paper already exists. Check its fulltextStatus — if not "available", call acquire_fulltext. Otherwise inform the user.]';
      }
      return null;
    }
    case 'acquire_fulltext': {
      if (obj['status'] === 'started') {
        return '[Fulltext acquisition started. Inform the user and let them know the PDF is being downloaded and will be available shortly.]';
      }
      return null;
    }
    default:
      return null;
  }
}

// ─── Workflow plan detection ───

/**
 * Pattern-match user message against known multi-step workflows.
 * Returns a template ExecutionPlan or null for single-step requests.
 *
 * Template plans avoid the latency of an extra LLM call while ensuring
 * the agent stays on track through multi-step workflows.
 */
function detectWorkflowPlan(userMessage: string): ExecutionPlan | null {
  const msg = userMessage.toLowerCase();

  // ── Paper download / acquire workflow ──
  const downloadPatterns = [
    /下载|获取全文|帮我找.*(?:论文|文献|paper)|download.*paper|acquire.*fulltext|fetch.*paper/,
    /搜.*(?:并|然后|并且).*(?:下载|导入|添加)/,
    /find.*(?:and|then).*(?:download|import|add)/,
  ];
  if (downloadPatterns.some((p) => p.test(msg))) {
    return {
      goal: 'Find, import, and acquire fulltext for requested paper',
      steps: [
        { index: 1, description: 'Check if paper already exists in library', toolHint: 'query_papers', status: 'pending' },
        { index: 2, description: 'Search external databases if not found locally', toolHint: 'search_papers', status: 'pending' },
        { index: 3, description: 'Import paper with metadata and trigger fulltext acquisition', toolHint: 'import_paper', status: 'pending' },
        { index: 4, description: 'Report result to user', status: 'pending' },
      ],
      reasoning: 'Multi-step workflow: library check → external search → import + acquire → report',
      createdAt: Date.now(),
    };
  }

  // ── Batch search + import workflow ──
  const batchPatterns = [
    /批量.*(?:搜索|查找|下载)|搜索.*(?:多篇|一批|相关)/,
    /find.*(?:papers|articles).*(?:about|on|related)/,
    /search.*(?:and|then).*(?:add|import).*(?:all|them|results)/,
  ];
  if (batchPatterns.some((p) => p.test(msg))) {
    return {
      goal: 'Search for multiple papers and import relevant ones',
      steps: [
        { index: 1, description: 'Search external databases for papers matching query', toolHint: 'search_papers', status: 'pending' },
        { index: 2, description: 'Present results to user and identify relevant papers', status: 'pending' },
        { index: 3, description: 'Import selected papers into library', toolHint: 'import_paper', status: 'pending' },
        { index: 4, description: 'Report import results', status: 'pending' },
      ],
      reasoning: 'Multi-step workflow: search → review → batch import → report',
      createdAt: Date.now(),
    };
  }

  // ── Analysis workflow (search + summarize) ──
  const analysisPatterns = [
    /综述|文献.*(?:调研|综合|对比)|compare.*papers|literature.*(?:review|survey)/,
    /(?:分析|总结|比较).*(?:多篇|这些|所有).*(?:论文|文献)/,
  ];
  if (analysisPatterns.some((p) => p.test(msg))) {
    return {
      goal: 'Analyze and synthesize information across papers',
      steps: [
        { index: 1, description: 'Gather relevant papers and their metadata', toolHint: 'query_papers', status: 'pending' },
        { index: 2, description: 'Retrieve key passages from papers', toolHint: 'retrieve', status: 'pending' },
        { index: 3, description: 'Synthesize findings and present analysis', status: 'pending' },
      ],
      reasoning: 'Multi-step workflow: gather → retrieve passages → synthesize',
      createdAt: Date.now(),
    };
  }

  return null;
}
