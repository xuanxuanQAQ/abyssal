/**
 * Claude adapter — Anthropic SDK wrapper for Claude models.
 *
 * Maps Abyssal's unified LLM interface to @anthropic-ai/sdk:
 * - system prompt as independent parameter (not in messages)
 * - tool_use content blocks for function calling
 * - vision image blocks for describeImage
 * - stream.abort() for cancellation
 * - extended thinking support (thinkingBudget → reasoning)
 *
 * See spec: section 2 — Claude Adapter
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  ContentBlock,
  CompletionResult,
  StreamChunk,
  ToolDefinition,
  ToolCall,
  TokenUsage,
  FinishReason,
  LlmAdapter,
  AdapterCallParams,
} from './llm-client';
import type { ResolvedReasoning } from './model-router';
import type { Logger } from '../../core/infra/logger';
import { classifyCreateError, mapFinishReason, safeParseJson } from './shared';

// ─── Reasoning level → budget_tokens mapping ───

const CLAUDE_THINKING_BUDGETS: Record<string, number> = {
  low: 4096,
  medium: 10240,
  high: 32768,
};

function resolveClaudeThinkingBudget(reasoning: ResolvedReasoning): number {
  if (reasoning.budgetTokens) return reasoning.budgetTokens;
  return CLAUDE_THINKING_BUDGETS[reasoning.level] ?? 10240;
}

// ─── Claude adapter ───

export class ClaudeAdapter implements LlmAdapter {
  private readonly client: Anthropic;
  private readonly logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new Anthropic({ apiKey });
    this.logger = logger;
  }

  // ─── complete (§2.2-2.3) ───

  async complete(params: AdapterCallParams): Promise<CompletionResult> {
    const messages = convertMessages(params.messages);

    // JSON mode: append prefill to guide Claude to output JSON
    if (params.responseFormat && params.responseFormat.type !== 'text') {
      appendJsonPrefill(messages);
    }

    const requestParams: Record<string, unknown> = {
      model: params.model,
      system: buildCacheableSystem(params.systemPrompt),
      messages,
      max_tokens: params.maxTokens ?? 16384,
      temperature: params.temperature ?? 0.7,
    };

    // Extended thinking: reasoning config or legacy thinkingBudget
    const thinkingBudget = params.reasoning
      ? resolveClaudeThinkingBudget(params.reasoning)
      : (params.thinkingBudget && params.thinkingBudget > 0 ? params.thinkingBudget : 0);

    if (thinkingBudget > 0) {
      requestParams['thinking'] = { type: 'enabled', budget_tokens: thinkingBudget };
      // Anthropic requires temperature=1 when thinking is enabled
      requestParams['temperature'] = 1;
      // Ensure max_tokens leaves room for both thinking and actual output
      const minMaxTokens = thinkingBudget + 4096;
      if ((requestParams['max_tokens'] as number) < minMaxTokens) {
        requestParams['max_tokens'] = minMaxTokens;
      }
    }

    if (params.tools && params.tools.length > 0) {
      requestParams['tools'] = params.tools.map(toClaudeTool);
    }

    const response = await this.client.messages.create(
      requestParams as unknown as Anthropic.MessageCreateParamsNonStreaming,
      params.signal ? { signal: params.signal } : undefined,
    );

    return normalizeResponse(response, params.model);
  }

  // ─── completeStream (§2.4) ───

  async *completeStream(params: AdapterCallParams): AsyncIterable<StreamChunk> {
    const messages = convertMessages(params.messages);

    if (params.responseFormat && params.responseFormat.type !== 'text') {
      appendJsonPrefill(messages);
    }

    const requestParams: Record<string, unknown> = {
      model: params.model,
      system: buildCacheableSystem(params.systemPrompt),
      messages,
      max_tokens: params.maxTokens ?? 16384,
      temperature: params.temperature ?? 0.7,
    };

    const thinkingBudget = params.reasoning
      ? resolveClaudeThinkingBudget(params.reasoning)
      : (params.thinkingBudget && params.thinkingBudget > 0 ? params.thinkingBudget : 0);

    if (thinkingBudget > 0) {
      requestParams['thinking'] = { type: 'enabled', budget_tokens: thinkingBudget };
      requestParams['temperature'] = 1;
      const minMaxTokens = thinkingBudget + 4096;
      if ((requestParams['max_tokens'] as number) < minMaxTokens) {
        requestParams['max_tokens'] = minMaxTokens;
      }
    }

    if (params.tools && params.tools.length > 0) {
      requestParams['tools'] = params.tools.map(toClaudeTool);
    }

    const streamStart = Date.now();
    this.logger.debug('[ClaudeAdapter] completeStream: creating stream request', {
      model: params.model,
      hasReasoning: !!params.reasoning,
      thinkingBudget,
      maxTokens: requestParams['max_tokens'],
    });

    let stream;
    try {
      stream = this.client.messages.stream(
        requestParams as unknown as Anthropic.MessageCreateParamsStreaming,
      );
      this.logger.debug('[ClaudeAdapter] completeStream: stream object created', {
        model: params.model,
        createLatencyMs: Date.now() - streamStart,
      });
    } catch (err) {
      this.logger.error('[ClaudeAdapter] completeStream: create() threw', err as Error, {
        model: params.model,
        elapsedMs: Date.now() - streamStart,
      });
      if (params.signal?.aborted) {
        yield { type: 'error', code: 'ABORTED', message: 'Request cancelled' };
      } else {
        yield { type: 'error', code: classifyCreateError(err), message: (err as Error).message };
      }
      return;
    }

    // AbortSignal → stream.abort() (§2.6)
    if (params.signal) {
      params.signal.addEventListener('abort', () => stream.abort(), { once: true });
    }

    const emitThinking = !!params.reasoning;
    let fullText = '';
    let thinkingText = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: FinishReason = 'end_turn';

    // Tool use accumulation
    const toolJsonBuffers = new Map<number, { id: string; name: string; json: string }>();
    // Track which indices are thinking blocks (to silently accumulate)
    const thinkingIndices = new Set<number>();
    let adapterEventCount = 0;

    try {
      for await (const event of stream) {
        adapterEventCount++;
        if (adapterEventCount === 1) {
          this.logger.debug('[ClaudeAdapter] completeStream: first event from SDK', {
            model: params.model,
            latencyMs: Date.now() - streamStart,
            eventType: (event as unknown as Record<string, unknown>)['type'],
          });
          yield { type: 'connected' as const };
        }
        const type = (event as unknown as Record<string, unknown>)['type'] as string;

        if (type === 'content_block_start') {
          const block = (event as unknown as Record<string, unknown>)['content_block'] as Record<string, unknown>;
          const index = (event as unknown as Record<string, unknown>)['index'] as number;

          if (block['type'] === 'tool_use') {
            toolJsonBuffers.set(index, {
              id: block['id'] as string,
              name: block['name'] as string,
              json: '',
            });
            yield { type: 'tool_use_start', id: block['id'] as string, name: block['name'] as string };
          } else if (block['type'] === 'thinking') {
            thinkingIndices.add(index);
          }
        } else if (type === 'content_block_delta') {
          const delta = (event as unknown as Record<string, unknown>)['delta'] as Record<string, unknown>;
          const index = (event as unknown as Record<string, unknown>)['index'] as number;

          if (delta['type'] === 'text_delta') {
            const text = delta['text'] as string;
            fullText += text;
            yield { type: 'text_delta', delta: text };
          } else if (delta['type'] === 'input_json_delta') {
            const partialJson = delta['partial_json'] as string;
            const buf = toolJsonBuffers.get(index);
            if (buf) buf.json += partialJson;
            yield { type: 'tool_use_delta', delta: partialJson };
          } else if (delta['type'] === 'thinking_delta') {
            const thinkDelta = (delta['thinking'] as string) ?? '';
            thinkingText += thinkDelta;
            if (thinkDelta && emitThinking) yield { type: 'thinking_delta' as const, delta: thinkDelta };
          }
        } else if (type === 'content_block_stop') {
          const index = (event as unknown as Record<string, unknown>)['index'] as number;
          const buf = toolJsonBuffers.get(index);
          if (buf) {
            const input = safeParseJson(buf.json);
            yield { type: 'tool_use_end', id: buf.id, name: buf.name, input };
            toolJsonBuffers.delete(index);
          }
          thinkingIndices.delete(index);
        } else if (type === 'message_delta') {
          const delta = (event as unknown as Record<string, unknown>)['delta'] as Record<string, unknown>;
          const usageDelta = (event as unknown as Record<string, unknown>)['usage'] as Record<string, number> | undefined;
          finishReason = mapFinishReason((delta['stop_reason'] as string) ?? 'end_turn');
          if (usageDelta) {
            usage = {
              inputTokens: usageDelta['input_tokens'] ?? 0,
              outputTokens: usageDelta['output_tokens'] ?? 0,
            };
          }
        } else if (type === 'message_stop') {
          // Final usage from the accumulated message
          try {
            const finalMessage = await stream.finalMessage();
            usage = {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            };
          } catch { /* use accumulated */ }

          this.logger.info('[ClaudeAdapter] completeStream: stream iteration done', {
            model: params.model,
            totalEvents: adapterEventCount,
            totalElapsedMs: Date.now() - streamStart,
            textLength: fullText.length,
            thinkingLength: thinkingText.length,
            finishReason,
          });

          yield {
            type: 'message_end',
            text: fullText,
            usage,
            finishReason,
            reasoning: thinkingText || null,
          };
        }
      }
    } catch (err) {
      this.logger.error('[ClaudeAdapter] completeStream: iteration error', err as Error, {
        model: params.model,
        eventsBeforeError: adapterEventCount,
        elapsedMs: Date.now() - streamStart,
      });
      if (params.signal?.aborted) {
        yield { type: 'error', code: 'ABORTED', message: 'Request cancelled' };
      } else {
        yield { type: 'error', code: classifyCreateError(err), message: (err as Error).message };
      }
    }
  }

  // ─── describeImage (§2.5) ───

  async describeImage(
    imageBase64: string,
    mediaType: string,
    prompt: string,
    maxTokens: number,
    model?: string,
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: model ?? 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    return response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
  }
}

// ─── Helpers ───

/**
 * Wrap system prompt in cacheable content blocks (Anthropic prompt caching).
 * Saves ~90% input tokens on repeated calls with the same system prompt.
 *
 * If the system prompt contains the marker `<!-- cache-boundary -->`, it is
 * split into two blocks: the stable prefix (role + project context) gets its
 * own cache_control so it survives across calls even when the variable suffix
 * (paper-specific context, RAG passages) changes. This enables cross-call
 * prefix caching for the chat and workflow paths that share the same project
 * context.
 */
function buildCacheableSystem(systemPrompt: string): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  const BOUNDARY = '<!-- cache-boundary -->';
  const idx = systemPrompt.indexOf(BOUNDARY);

  if (idx !== -1) {
    const prefix = systemPrompt.slice(0, idx).trimEnd();
    const suffix = systemPrompt.slice(idx + BOUNDARY.length).trimStart();
    const blocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
    if (prefix) {
      blocks.push({ type: 'text', text: prefix, cache_control: { type: 'ephemeral' } });
    }
    if (suffix) {
      blocks.push({ type: 'text', text: suffix, cache_control: { type: 'ephemeral' } });
    }
    return blocks.length > 0 ? blocks : [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  }

  return [{
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' },
  }];
}

function convertMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : m.content.map(convertContentBlock),
  })) as Anthropic.MessageParam[];
}

function convertContentBlock(block: ContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text! };
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: block.data!,
        },
      } as unknown as Anthropic.ContentBlockParam;
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id!,
        name: block.name!,
        input: block.input!,
      } as unknown as Anthropic.ContentBlockParam;
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId!,
        content: block.content!,
      } as unknown as Anthropic.ContentBlockParam;
    default:
      return { type: 'text', text: '' };
  }
}

/**
 * Append a JSON prefill to guide Claude to output valid JSON.
 * Claude doesn't have native response_format, but prefilling the assistant
 * turn with `{` forces it to continue with JSON output.
 */
function appendJsonPrefill(messages: Anthropic.MessageParam[]): void {
  // Only add prefill if last message is from user (standard case)
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    messages.push({ role: 'assistant', content: '{' });
  }
}

function toClaudeTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function normalizeResponse(response: Anthropic.Message, model: string): CompletionResult {
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('');

  // Extract thinking content (extended thinking)
  const reasoning = response.content
    .filter((b) => (b as unknown as { type: string }).type === 'thinking')
    .map((b) => ((b as unknown as { thinking: string }).thinking))
    .join('\n') || null;

  const toolCalls: ToolCall[] = response.content
    .filter((b) => b.type === 'tool_use')
    .map((b) => {
      const tb = b as Anthropic.ToolUseBlock;
      return { id: tb.id, name: tb.name, arguments: tb.input as Record<string, unknown> };
    });

  return {
    text,
    toolCalls,
    reasoning,
    model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    finishReason: mapFinishReason(response.stop_reason ?? 'end_turn'),
  };
}
