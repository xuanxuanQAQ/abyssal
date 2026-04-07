/**
 * OpenAI-compatible adapter — supports cloud and OpenAI-compatible backends.
 *
 * Handles:
 * - system role as messages[0]
 * - tool_calls[].function.arguments JSON parsing with error recovery
 * - o3 reasoning_effort special parameter
 * - Local model context window overflow check
 *
 * See spec: section 3 — OpenAI Compatible Adapter
 */

import OpenAI from 'openai';
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
  ResponseFormat,
} from './llm-client';
import { getModelContextWindow, isAlwaysReasoningModel } from './model-router';
import { countTokens } from './token-counter';
import { classifyCreateError, mapFinishReason, safeParseJson, type StructuredOutputTier } from './shared';

// ─── Backend configuration ───

export interface OpenAIBackendConfig {
  baseURL?: string;
  apiKey: string;
  provider: string; // 'openai' | 'deepseek' | 'gemini' | 'siliconflow' | 'doubao' | 'kimi' | 'vllm'
}

// ─── OpenAI adapter ───

export class OpenAIAdapter implements LlmAdapter {
  private readonly client: OpenAI;
  private readonly provider: string;

  constructor(config: OpenAIBackendConfig) {
    this.provider = config.provider;
    this.client = new OpenAI({
      apiKey: config.apiKey || 'not-needed', // local OpenAI-compatible adapters may not need a key
      baseURL: config.baseURL,
    });
  }

  // ─── complete (§3.2-3.3) ───

  async complete(params: AdapterCallParams): Promise<CompletionResult> {
    this.checkContextOverflow(params.model, params.systemPrompt, params.messages);

    const { request, tier } = this.buildRequest(params);

    const response = await this.client.chat.completions.create(
      request as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
      params.signal ? { signal: params.signal } : undefined,
    );

    const result = this.normalizeResponse(response, params.model);
    return tier === 'tool_shim' ? unwrapToolShim(result) : result;
  }

  // ─── completeStream (§3.5) ───

  async *completeStream(params: AdapterCallParams): AsyncIterable<StreamChunk> {
    this.checkContextOverflow(params.model, params.systemPrompt, params.messages);

    const { request, tier } = this.buildRequest(params);
    request['stream'] = true;
    request['stream_options'] = { include_usage: true };

    let stream;
    try {
      stream = await this.client.chat.completions.create(
        request as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
        params.signal ? { signal: params.signal } : undefined,
      );
    } catch (err) {
      if (params.signal?.aborted) {
        yield { type: 'error', code: 'ABORTED', message: 'Request cancelled' };
      } else {
        yield { type: 'error', code: classifyCreateError(err), message: (err as Error).message };
      }
      return;
    }

    const isToolShim = tier === 'tool_shim';
    // Always emit thinking deltas when reasoning is active — either explicitly
    // toggled by the user, or implicitly by model nature (o3, o4, deepseek-reasoner).
    const emitThinking = !!params.reasoning || isAlwaysReasoningModel(params.model);
    let fullText = '';
    let reasoningText = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: FinishReason = 'end_turn';
    let hasRealToolCalls = false;
    const toolJsonBuffers = new Map<number, { id: string; name: string; json: string }>();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          // Usage-only chunk (final)
          if (chunk.usage) {
            const reasoningTokens = (
              (chunk.usage as unknown as Record<string, unknown>)?.['completion_tokens_details'] as Record<string, unknown> | undefined
            )?.['reasoning_tokens'] as number | undefined;
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              ...(reasoningTokens != null && { reasoningTokens }),
            };
          }
          continue;
        }

        const delta = choice.delta;

        // Reasoning / thinking content delta (DeepSeek-R1, Kimi K2, Doubao Seed)
        const reasoningDelta = (delta as Record<string, unknown> | undefined)?.['reasoning_content'] as string | undefined;
        if (reasoningDelta) {
          reasoningText += reasoningDelta;
          if (emitThinking) {
            yield { type: 'thinking_delta' as const, delta: reasoningDelta };
          }
        }

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
              const synthetic = isToolShim && isSyntheticTool(tc.function.name);
              toolJsonBuffers.set(idx, { id: tc.id, name: tc.function.name, json: '' });
              if (!synthetic) {
                hasRealToolCalls = true;
                yield { type: 'tool_use_start', id: tc.id, name: tc.function.name };
              }
            }
            if (tc.function?.arguments) {
              const buf = toolJsonBuffers.get(idx);
              if (buf) buf.json += tc.function.arguments;

              if (isToolShim && isSyntheticTool(buf?.name ?? '')) {
                // Tier 2: re-route synthetic tool arguments as text
                fullText += tc.function.arguments;
                yield { type: 'text_delta', delta: tc.function.arguments };
              } else {
                yield { type: 'tool_use_delta', delta: tc.function.arguments };
              }
            }
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);

          // Emit tool_use_end for real (non-synthetic) tools only
          for (const [idx, buf] of toolJsonBuffers) {
            if (isToolShim && isSyntheticTool(buf.name)) {
              toolJsonBuffers.delete(idx);
              continue;
            }
            const input = safeParseJson(buf.json);
            yield { type: 'tool_use_end', id: buf.id, name: buf.name, input };
            toolJsonBuffers.delete(idx);
          }
        }
      }

      // Tier 2 with no real tools: remap finish_reason from tool_use → end_turn
      if (isToolShim && !hasRealToolCalls && finishReason === 'tool_use') {
        finishReason = 'end_turn';
      }

      yield { type: 'message_end', text: fullText, usage, finishReason, reasoning: reasoningText || null };
    } catch (err) {
      if (params.signal?.aborted) {
        yield { type: 'error', code: 'ABORTED', message: 'Request cancelled' };
      } else {
        yield { type: 'error', code: classifyCreateError(err), message: (err as Error).message };
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
    responseFormat?: ResponseFormat;
    reasoning?: { level: 'low' | 'medium' | 'high'; budgetTokens?: number } | null;
  }): { request: Record<string, unknown>; tier: StructuredOutputTier | null } {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...params.messages.flatMap(convertMessages),
    ];

    // Reasoning model handling (§3.4)
    const isOSeries = params.model.startsWith('o3') || params.model.startsWith('o4');
    const isDeepSeek = params.model.startsWith('deepseek');

    // Per-provider default max_tokens: DeepSeek caps at 8192
    const defaultMaxTokens = isDeepSeek ? 8192 : 16384;

    const req: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? defaultMaxTokens,
    };
    const isDeepSeekReasoner = params.model === 'deepseek-reasoner' || params.model.includes('DeepSeek-R1');
    const isDoubaoSeed = params.model.startsWith('doubao-seed');
    const isKimiThinking = params.model.startsWith('kimi-k2');

    if (params.reasoning && isOSeries) {
      // OpenAI o-series: reasoning_effort parameter, no temperature
      req['reasoning_effort'] = params.reasoning.level;
    } else if (isOSeries) {
      // o-series without explicit reasoning config — no temperature
    } else if (isDeepSeek && (params.reasoning || isDeepSeekReasoner)) {
      // DeepSeek thinking mode: deepseek-chat 通过 thinking 参数启用深度思考
      // deepseek-reasoner 默认开启。thinking mode 下 temperature 不生效。
      req['thinking'] = { type: 'enabled' };
    } else if (isDoubaoSeed || isKimiThinking) {
      // 豆包 Seed / Kimi K2 系列：temperature 必须为 1
      req['temperature'] = 1;
      if (params.reasoning) {
        // 深度思考按钮开启时，显式启用 thinking 模式
        req['thinking'] = { type: 'enabled', budget_tokens: params.reasoning.budgetTokens ?? 10240 };
      }
    } else {
      req['temperature'] = params.temperature ?? 0.7;
    }

    // ─── User tools ───
    if (params.tools && params.tools.length > 0) {
      req['tools'] = params.tools.map(toOpenAITool);
    }

    // ─── Structured output: three-tier strategy ───
    // Tier 1 (native):             response_format json_schema — constrained decoding
    // Tier 2 (tool_shim):          synthetic function call with strict: true — constrained decoding via tool
    // Tier 3 (json_object_prompt): json_object + schema in system prompt — best-effort
    let tier: StructuredOutputTier | null = null;

    if (params.responseFormat?.type === 'json_schema') {
      tier = resolveStructuredOutputTier(params.model, this.provider);
      const fmt = params.responseFormat;

      switch (tier) {
        case 'native':
          req['response_format'] = {
            type: 'json_schema',
            json_schema: {
              name: fmt.name,
              schema: fmt.schema,
              ...(fmt.strict != null && { strict: fmt.strict }),
            },
          };
          break;

        case 'tool_shim': {
          const toolName = syntheticToolName(fmt.name);
          const existingTools = (req['tools'] as unknown[]) ?? [];
          req['tools'] = [...existingTools, {
            type: 'function',
            function: {
              name: toolName,
              description: 'Return the structured output.',
              strict: true,
              parameters: fmt.schema,
            },
          }];
          // Only force synthetic tool when no real user tools exist;
          // otherwise let the model choose freely among all tools.
          if (existingTools.length === 0) {
            req['tool_choice'] = { type: 'function', function: { name: toolName } };
          }
          break;
        }

        case 'json_object_prompt': {
          injectSchemaHint(messages, fmt.schema);
          if (!isDeepSeekReasoner && !isDoubaoSeed) {
            req['response_format'] = { type: 'json_object' };
          }
          break;
        }
      }
    } else if (params.responseFormat?.type === 'json_object') {
      req['response_format'] = { type: 'json_object' };
    }

    return { request: req, tier };
  }

  // ─── Response normalization (§3.3) ───

  private normalizeResponse(
    response: OpenAI.ChatCompletion,
    model: string,
  ): CompletionResult {
    const choice = response.choices[0]!;

    const text = choice.message.content ?? '';

    // Extract reasoning_content (DeepSeek-R1 returns this alongside content)
    const reasoning = (choice.message as unknown as Record<string, unknown>)['reasoning_content'] as string | null ?? null;

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJson(tc.function.arguments),
      }));

    // Extract reasoning token count from OpenAI o-series completion_tokens_details
    const reasoningTokens = (
      (response.usage as unknown as Record<string, unknown>)?.['completion_tokens_details'] as Record<string, unknown> | undefined
    )?.['reasoning_tokens'] as number | undefined;

    return {
      text,
      toolCalls,
      reasoning,
      model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        ...(reasoningTokens != null && { reasoningTokens }),
      },
      finishReason: mapFinishReason(choice.finish_reason ?? 'stop'),
    };
  }

  // ─── Context overflow check (§3.4) ───

  private checkContextOverflow(model: string, systemPrompt: string, messages: Message[]): void {
    // Only check for local models where context window is a real concern
    if (this.provider !== 'vllm') return;

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

/**
 * Convert a single Anthropic-format Message into one or more OpenAI-format messages.
 *
 * OpenAI requires:
 * - Assistant tool calls as `role:'assistant'` with `tool_calls` array
 * - Tool results as separate `role:'tool'` messages (one per tool result)
 *
 * Returns an array because a single Anthropic message with N tool_result blocks
 * must expand to N separate OpenAI tool messages.
 */
function convertMessages(msg: Message): OpenAI.ChatCompletionMessageParam[] {
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content } as OpenAI.ChatCompletionMessageParam];
  }

  const blocks = msg.content;

  // ── Assistant message with tool_use blocks → OpenAI tool_calls format ──
  const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
  if (toolUseBlocks.length > 0 && msg.role === 'assistant') {
    const textParts = blocks.filter((b) => b.type === 'text');
    const text = textParts.map((b) => b.text ?? '').join('') || null;
    const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id!,
      type: 'function' as const,
      function: {
        name: b.name!,
        arguments: JSON.stringify(b.input ?? {}),
      },
    }));
    return [{ role: 'assistant', content: text, tool_calls: toolCalls } as OpenAI.ChatCompletionAssistantMessageParam];
  }

  // ── User message with tool_result blocks → OpenAI role:'tool' messages ──
  const toolResultBlocks = blocks.filter((b) => b.type === 'tool_result');
  if (toolResultBlocks.length > 0) {
    return toolResultBlocks.map((b) => ({
      role: 'tool' as const,
      tool_call_id: b.toolUseId!,
      content: b.content ?? '',
    }));
  }

  // ── Regular multi-part content (text + images) ──
  const parts: OpenAI.ChatCompletionContentPart[] = blocks.map((block) => {
    if (block.type === 'image') {
      return {
        type: 'image_url' as const,
        image_url: { url: `data:${block.mediaType};base64,${block.data}` },
      };
    }
    return { type: 'text' as const, text: block.text ?? '' };
  });
  return [{ role: msg.role, content: parts } as unknown as OpenAI.ChatCompletionMessageParam];
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

// ─── Structured output: three-tier helpers ───

const SYNTHETIC_TOOL_PREFIX = '__structured_output_';

function syntheticToolName(schemaName: string): string {
  return `${SYNTHETIC_TOOL_PREFIX}${schemaName}`;
}

function isSyntheticTool(name: string): boolean {
  return name.startsWith(SYNTHETIC_TOOL_PREFIX);
}

/**
 * Detect Doubao Seed models that support native json_schema (≥ 1.6).
 * Model names: doubao-seed-1.6, doubao-seed-1.8, doubao-seed-2.0,
 *              doubao-seed-2-0-pro-260215, etc.
 */
function isDoubao16Plus(model: string): boolean {
  const match = model.match(/doubao-seed-(\d+)[.\-](\d+)/);
  if (!match) return false;
  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  return major > 1 || (major === 1 && minor >= 6);
}

/**
 * Resolve the optimal structured output tier for a model/provider.
 *
 * Tier 1 (native):            gpt-4o, gpt-4o-mini, gemini
 * Tier 2 (tool_shim):         o3, o4 (reasoning models), deepseek-chat
 * Tier 3 (json_object_prompt): doubao, kimi, deepseek-reasoner, unknown
 *   - doubao and deepseek-reasoner: schema hint only (no response_format)
 *
 * NOTE: DeepSeek strict function calling officially requires the /beta endpoint.
 * If the configured baseURL doesn't include /beta, the API may reject strict: true.
 */
function resolveStructuredOutputTier(model: string, provider: string): StructuredOutputTier {
  // Tier 1: native json_schema via response_format
  if (provider === 'openai' && !isAlwaysReasoningModel(model)) return 'native';
  if (provider === 'gemini') return 'native';

  // Tier 2: strict function calling (constrained decoding via tool shim)
  if (isAlwaysReasoningModel(model)) return 'tool_shim'; // o3, o4
  if (model === 'deepseek-chat') return 'tool_shim';

  // Tier 3: json_object + schema in system prompt
  return 'json_object_prompt';
}

/** Inject a JSON schema hint into the system message (for Tier 3 fallback). */
function injectSchemaHint(
  messages: OpenAI.ChatCompletionMessageParam[],
  schema: Record<string, unknown>,
): void {
  const schemaStr = JSON.stringify(schema);
  const hint = `\n\nRespond with valid JSON matching this schema:\n${schemaStr}`;
  const first = messages[0];
  // Only skip injection if the exact schema is already present (not just any mention of "json")
  if (first?.role === 'system' && typeof first.content === 'string'
    && !first.content.includes(schemaStr)) {
    messages[0] = { role: 'system', content: first.content + hint };
  }
}

/**
 * Unwrap a Tier 2 (tool_shim) response: extract the synthetic tool call's
 * arguments into `text` and remove it from `toolCalls`.
 */
function unwrapToolShim(result: CompletionResult): CompletionResult {
  const syntheticIdx = result.toolCalls.findIndex((tc) => isSyntheticTool(tc.name));
  if (syntheticIdx === -1) return result;

  const synthetic = result.toolCalls[syntheticIdx]!;
  const remainingToolCalls = result.toolCalls.filter((_, i) => i !== syntheticIdx);

  return {
    ...result,
    text: JSON.stringify(synthetic.arguments),
    toolCalls: remainingToolCalls,
    finishReason: remainingToolCalls.length > 0 ? result.finishReason : 'end_turn',
  };
}
