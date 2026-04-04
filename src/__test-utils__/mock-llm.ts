/**
 * LLM Client mock —— 用于测试依赖 LLM 的模块（agent-loop, orchestrator 等）。
 *
 * 用法：
 *   vi.mock('@core/llm-client', () => ({ llmClient: createMockLLM() }));
 *   const llm = createMockLLM();
 *   llm.complete.mockResolvedValueOnce({ text: 'mocked response' });
 */
import { vi } from 'vitest';
import type { CompletionResult } from '@core/llm-client';

export function createMockLLM() {
  return {
    complete: vi.fn().mockResolvedValue({
      text: '[mock] default LLM response',
      toolCalls: [],
      model: 'mock-model',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      finishReason: 'end_turn',
    } satisfies CompletionResult),
    embed: vi.fn().mockResolvedValue([
      new Float32Array(1536), // 零向量，与 EmbedFunction 返回 Float32Array[] 对齐
    ]),
  };
}
