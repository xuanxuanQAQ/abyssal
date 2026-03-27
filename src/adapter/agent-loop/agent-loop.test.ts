import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop, type ConversationState } from './agent-loop';
import type { LlmClient, StreamChunk, CompleteParams } from '../llm-client/llm-client';
import { ToolRegistry, type ToolServices } from './tool-registry';

// ─── Mocks ───

function makeMockLlmClient(streamChunks: StreamChunk[]): LlmClient {
  return {
    completeStream: vi.fn().mockReturnValue((async function* () {
      for (const chunk of streamChunks) yield chunk;
    })()),
    countTokens: vi.fn().mockReturnValue(100),
    getContextWindow: vi.fn().mockReturnValue(200_000),
  } as unknown as LlmClient;
}

function makeMockToolServices(): ToolServices {
  return {
    dbProxy: {
      getPaper: vi.fn().mockResolvedValue({ id: 'p1', title: 'Test Paper' }),
      queryPapers: vi.fn().mockResolvedValue({ items: [] }),
      getAllConcepts: vi.fn().mockResolvedValue([]),
      getConcept: vi.fn().mockResolvedValue(null),
      getAnnotations: vi.fn().mockResolvedValue([]),
      getRelationGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      getConceptMatrix: vi.fn().mockResolvedValue([]),
      getStats: vi.fn().mockResolvedValue({ papers: { total: 0 }, concepts: { total: 0 } }),
      getMemosByEntity: vi.fn().mockResolvedValue([]),
      getAllNotes: vi.fn().mockResolvedValue([]),
      getSuggestedConcepts: vi.fn().mockResolvedValue([]),
    },
  };
}

const pushManager = {
  pushAgentStream: vi.fn(),
};

function makeConversation(): ConversationState {
  return { messages: [], conversationId: 'test-conv' };
}

describe('AgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams text_delta chunks to PushManager', async () => {
    const chunks: StreamChunk[] = [
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'World' },
      { type: 'message_end', text: 'Hello World', usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'end_turn' },
    ];

    const agent = new AgentLoop({
      llmClient: makeMockLlmClient(chunks),
      toolRegistry: new ToolRegistry(makeMockToolServices()),
      pushManager: pushManager as any,
      getSystemPromptContext: async () => ({
        projectName: 'Test', frameworkState: 'zero_concepts' as const,
        conceptCount: 0, tentativeCount: 0, workingCount: 0, establishedCount: 0,
        totalPapers: 0, analyzedPapers: 0, acquiredPapers: 0,
        memoCount: 0, noteCount: 0, topConcepts: [], advisorySuggestions: [], toolCount: 0,
      }),
    });

    const conv = makeConversation();
    await agent.run('test message', conv);

    // Should have pushed text_delta + done
    const pushCalls = pushManager.pushAgentStream.mock.calls;
    const textDeltas = pushCalls.filter(([c]: any) => c.type === 'text_delta');
    const dones = pushCalls.filter(([c]: any) => c.type === 'done');
    expect(textDeltas).toHaveLength(2);
    expect(dones).toHaveLength(1);
  });

  it('stops after MAX_ROUNDS', async () => {
    // Each stream ends with tool_use, causing re-invocation
    let callCount = 0;
    const llmClient = {
      completeStream: vi.fn().mockImplementation(() => {
        callCount++;
        return (async function* () {
          yield { type: 'tool_use_end' as const, id: `t${callCount}`, name: 'get_stats', input: {} };
        })();
      }),
      countTokens: vi.fn().mockReturnValue(10),
      getContextWindow: vi.fn().mockReturnValue(200_000),
    } as unknown as LlmClient;

    const agent = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry(makeMockToolServices()),
      pushManager: pushManager as any,
      getSystemPromptContext: async () => ({
        projectName: 'T', frameworkState: 'zero_concepts' as const,
        conceptCount: 0, tentativeCount: 0, workingCount: 0, establishedCount: 0,
        totalPapers: 0, analyzedPapers: 0, acquiredPapers: 0,
        memoCount: 0, noteCount: 0, topConcepts: [], advisorySuggestions: [], toolCount: 0,
      }),
    });

    const conv = makeConversation();
    await agent.run('test', conv);

    // Should stop after 10 rounds
    expect(callCount).toBeLessThanOrEqual(11); // 10 rounds + initial
  });

  it('detects duplicate tool calls and injects system notice', async () => {
    let callIndex = 0;
    const llmClient = {
      completeStream: vi.fn().mockImplementation(() => {
        callIndex++;
        if (callIndex <= 5) {
          return (async function* () {
            yield { type: 'tool_use_end' as const, id: `t${callIndex}`, name: 'search_papers', input: { query: 'affordance' } };
          })();
        }
        return (async function* () {
          yield { type: 'message_end' as const, text: 'done', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'end_turn' as const };
        })();
      }),
      countTokens: vi.fn().mockReturnValue(10),
      getContextWindow: vi.fn().mockReturnValue(200_000),
    } as unknown as LlmClient;

    const agent = new AgentLoop({
      llmClient,
      toolRegistry: new ToolRegistry(makeMockToolServices()),
      pushManager: pushManager as any,
      getSystemPromptContext: async () => ({
        projectName: 'T', frameworkState: 'zero_concepts' as const,
        conceptCount: 0, tentativeCount: 0, workingCount: 0, establishedCount: 0,
        totalPapers: 0, analyzedPapers: 0, acquiredPapers: 0,
        memoCount: 0, noteCount: 0, topConcepts: [], advisorySuggestions: [], toolCount: 0,
      }),
    });

    const conv = makeConversation();
    await agent.run('test', conv);

    // After 3 duplicates, tool_use_result should contain system notice
    const toolResults = pushManager.pushAgentStream.mock.calls
      .filter(([c]: any) => c.type === 'tool_use_result')
      .map(([c]: any) => c.result);
    const notices = toolResults.filter((r: string) => r.includes('System Notice'));
    expect(notices.length).toBeGreaterThan(0);
  });
});
