/**
 * OpenAI-compatible adapter — supports four backends via baseURL routing:
 *   OpenAI, DeepSeek, Ollama, vLLM
 *
 * Handles:
 * - system role as messages[0]
 * - tool_calls[].function.arguments JSON parsing with error recovery
 * - o3 reasoning_effort special parameter
 * - deepseek-reasoner reasoning_content filtering
 * - Local model context window overflow check
 *
 * See spec: section 3 — OpenAI Compatible Adapter
 */

import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
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
} from './llm-client';
import { getReasoningEffort, getModelContextWindow } from './model-router';
import { countTokens } from './token-counter';

// ─── Backend configuration ───

export interface OpenAIBackendConfig {
  baseURL?: string;
  apiKey: string;
  provider: string; // 'openai' | 'deepseek' | 'ollama' | 'vllm'
}

// ─── OpenAI adapter ───

export class OpenAIAdapter implements LlmAdapter {
  private readonly client: OpenAI;
  private readonly provider: string;

  constructor(config: OpenAIBackendConfig) {
    this.provider = config.provider;
    this.client = new OpenAI({
      apiKey: config.apiKey || 'not-needed', // Ollama doesn't need a key
      baseURL: config.baseURL,
    });
  }

  // ─── complete (§3.2-3.3) ───

  async complete(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    workflowId?: string;
  }): Promise<CompletionResult> {
    this.checkContextOverflow(params.model, params.systemPrompt, params.messages);

    const requestParams = this.buildRequest(params);

    const response = await this.client.chat.completions.create(
      requestParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
      params.signal ? { signal: params.signal } : undefined,
    );

    return this.normalizeResponse(response, params.model);
  }

  // ─── completeStream (§3.5) ───

  async *completeStream(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    workflowId?: string;
  }): AsyncIterable<StreamChunk> {
    this.checkContextOverflow(params.model, params.systemPrompt, params.messages);

    const requestParams = this.buildRequest(params);
    requestParams['stream'] = true;
    requestParams['stream_options'] = { include_usage: true };

    const stream = await this.client.chat.completions.create(
      requestParams as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
      params.signal ? { signal: params.signal } : undefined,
    );

    let fullText = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: FinishReason = 'end_turn';
    const toolJsonBuffers = new Map<number, { id: string; name: string; json: string }>();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          // Usage-only chunk (final)
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
          continue;
        }

        const delta = choice.delta;

        // Text delta
        if (delta?.content) {
          fullText += delta.content;
          yield { type: 'text_delta', delta: delta.content };
        }

        // Tool call deltas
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (tc.id && tc.function?.name) {
              // New tool call start
              toolJsonBuffers.set(idx, { id: tc.id, name: tc.function.name, json: '' });
              yield { type: 'tool_use_start', id: tc.id, name: tc.function.name };
            }
            if (tc.function?.arguments) {
              const buf = toolJsonBuffers.get(idx);
              if (buf) buf.json += tc.function.arguments;
              yield { type: 'tool_use_delta', delta: tc.function.arguments };
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);

          // Emit tool_use_end for any accumulated tools
          for (const [idx, buf] of toolJsonBuffers) {
            const input = safeParseJson(buf.json);
            yield { type: 'tool_use_end', id: buf.id, name: buf.name, input };
            toolJsonBuffers.delete(idx);
          }
        }
      }

      yield { type: 'message_end', text: fullText, usage, finishReason };
    } catch (err) {
      if (params.signal?.aborted) {
        yield { type: 'error', code: 'ABORTED', message: 'Request cancelled' };
      } else {
        yield { type: 'error', code: 'STREAM_ERROR', message: (err as Error).message };
      }
    }
  }

  // ─── describeImage ───

  async describeImage(
    imageBase64: string,
    mediaType: string,
    prompt: string,
    maxTokens: number,
    model?: string,
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: model ?? 'gpt-4o',
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${imageBase64}` },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    return response.choices[0]?.message?.content ?? '';
  }

  // ─── Request building ───

  private buildRequest(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    workflowId?: string;
  }): Record<string, unknown> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...params.messages.map(convertMessage),
    ];

    const req: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 4096,
    };

    // o3 special handling: reasoning_effort instead of temperature (§3.4)
    if (params.model.startsWith('o3')) {
      const effort = getReasoningEffort(params.workflowId ?? '');
      if (effort) req['reasoning_effort'] = effort;
      // o3 does not support temperature parameter
    } else {
      req['temperature'] = params.temperature ?? 0.7;
    }

    if (params.tools && params.tools.length > 0) {
      req['tools'] = params.tools.map(toOpenAITool);
    }

    return req;
  }

  // ─── Response normalization (§3.3) ───

  private normalizeResponse(
    response: OpenAI.ChatCompletion,
    model: string,
  ): CompletionResult {
    const choice = response.choices[0]!;

    const text = choice.message.content ?? '';

    // DeepSeek reasoner: extract reasoning_content for audit/transparency (§3.4)
    // The reasoning chain is NOT fed to YAML parsers (would break parsing),
    // but preserved in CompletionResult.reasoning for Orchestrator to persist
    // as decision_note / metadata in paper_concept_map.
    let reasoning: string | null = null;
    if (model === 'deepseek-reasoner' || model.startsWith('deepseek-reasoner')) {
      const msg = choice.message as unknown as Record<string, unknown>;
      reasoning = (msg['reasoning_content'] as string) ?? null;
    }

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments),
    }));

    return {
      text,
      toolCalls,
      reasoning,
      model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      finishReason: mapFinishReason(choice.finish_reason ?? 'stop'),
    };
  }

  // ─── Context overflow check (§3.4) ───

  private checkContextOverflow(model: string, systemPrompt: string, messages: Message[]): void {
    // Only check for local models where context window is a real concern
    if (this.provider !== 'ollama' && this.provider !== 'vllm') return;

    const window = getModelContextWindow(model);
    const allText = systemPrompt + messages.map((m) =>
      typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join(''),
    ).join('');
    const estimated = countTokens(allText);

    if (estimated > window * 0.9) {
      const err = new Error(
        `Input (~${estimated} tokens) exceeds 90% of model context window (${window}). Model: ${model}`,
      );
      (err as unknown as Record<string, unknown>)['code'] = 'CONTEXT_OVERFLOW';
      (err as unknown as Record<string, unknown>)['estimatedTokens'] = estimated;
      (err as unknown as Record<string, unknown>)['modelWindow'] = window;
      throw err;
    }
  }
}

// ─── Helpers ───

function convertMessage(msg: Message): OpenAI.ChatCompletionMessageParam {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content } as OpenAI.ChatCompletionMessageParam;
  }
  // Multi-part content (text + images + tool results)
  const parts: OpenAI.ChatCompletionContentPart[] = msg.content.map(convertContentPart);
  return { role: msg.role, content: parts } as unknown as OpenAI.ChatCompletionMessageParam;
}

function convertContentPart(block: ContentBlock): OpenAI.ChatCompletionContentPart {
  if (block.type === 'text') {
    return { type: 'text', text: block.text! };
  }
  if (block.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${block.mediaType};base64,${block.data}` },
    };
  }
  // tool_use and tool_result are handled at the message level by OpenAI
  return { type: 'text', text: block.text ?? '' };
}

function toOpenAITool(tool: ToolDefinition): OpenAI.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  };
}

/**
 * Parse JSON with error recovery for malformed tool call arguments.
 *
 * Uses jsonrepair (FSM-based) instead of fragile regex heuristics.
 * Handles: trailing commas, missing brackets, unquoted keys,
 * truncated strings, escaped character issues, and more.
 */
function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    try {
      const repaired = jsonrepair(json);
      return JSON.parse(repaired);
    } catch {
      return {};
    }
  }
}

function mapFinishReason(reason: string): FinishReason {
  const map: Record<string, FinishReason> = {
    'stop': 'end_turn',
    'tool_calls': 'tool_use',
    'length': 'max_tokens',
    'content_filter': 'content_filter',
  };
  return map[reason] ?? 'end_turn';
}
