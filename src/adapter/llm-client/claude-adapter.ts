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
import { mapFinishReason, safeParseJson } from './shared';

// ─── Claude adapter ───

export class ClaudeAdapter implements LlmAdapter {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
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
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7,
    };

    // Extended thinking: budget_tokens enables chain-of-thought reasoning
    if (params.thinkingBudget && params.thinkingBudget > 0) {
      requestParams['thinking'] = { type: 'enabled', budget_tokens: params.thinkingBudget };
      // Anthropic requires temperature=1 when thinking is enabled
      requestParams['temperature'] = 1;
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
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7,
    };

    if (params.thinkingBudget && params.thinkingBudget > 0) {
      requestParams['thinking'] = { type: 'enabled', budget_tokens: params.thinkingBudget };
      requestParams['temperature'] = 1;
    }

    if (params.tools && params.tools.length > 0) {
      requestParams['tools'] = params.tools.map(toClaudeTool);
    }

    const stream = this.client.messages.stream(
      requestParams as unknown as Anthropic.MessageCreateParamsStreaming,
    );

    // AbortSignal → stream.abort() (§2.6)
    if (params.signal) {
      params.signal.addEventListener('abort', () => stream.abort(), { once: true });
    }

    let fullText = '';
    let thinkingText = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: FinishReason = 'end_turn';

    // Tool use accumulation
    const toolJsonBuffers = new Map<number, { id: string; name: string; json: string }>();
    // Track which indices are thinking blocks (to silently accumulate)
    const thinkingIndices = new Set<number>();

    try {
      for await (const event of stream) {
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
            // Silently accumulate thinking content
            thinkingText += (delta['thinking'] as string) ?? '';
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
      if (params.signal?.aborted) {
        yield { type: 'error', code: 'ABORTED', message: 'Request cancelled' };
      } else {
        yield { type: 'error', code: 'STREAM_ERROR', message: (err as Error).message };
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
 * Wrap system prompt in a cacheable content block (Anthropic prompt caching).
 * Saves ~90% input tokens on repeated calls with the same system prompt.
 */
function buildCacheableSystem(systemPrompt: string): Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
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
