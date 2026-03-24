/**
 * LLM Client mock —— 用于测试依赖 LLM 的模块（agent-loop, orchestrator 等）。
 *
 * 类比 gtest：
 *   MOCK_METHOD(CompleteResult, complete, (string, string, CompleteOptions));
 *
 * 用法：
 *   vi.mock('@core/llm-client', () => ({ llmClient: createMockLLM() }));
 *   const llm = createMockLLM();
 *   llm.complete.mockResolvedValueOnce({ text: 'mocked response' });
 */
import { vi } from 'vitest';
import type { CompleteResult } from '@core/types';

export function createMockLLM() {
  return {
    complete: vi.fn().mockResolvedValue({
      text: '[mock] default LLM response',
    } satisfies CompleteResult),
    embed: vi.fn().mockResolvedValue([
      new Array(1536).fill(0),
    ]),
  };
}
