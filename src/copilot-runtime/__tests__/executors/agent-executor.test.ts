import { AgentExecutor } from '../../executors/agent-executor';
import type { AgentExecutorDeps } from '../../executors/agent-executor';
import { OperationEventEmitter } from '../../event-emitter';
import { makeOperation, makeContext, resetSeq } from '../helpers';
import type { ExecutionStep } from '../../types';

function makeStep(mode: 'chat' | 'draft' | 'patch' = 'chat'): ExecutionStep & { kind: 'llm_generate' } {
  return { kind: 'llm_generate', mode };
}

/** Helper to create an async iterable from chunks */
async function* chunksToStream(chunks: any[]): AsyncIterable<any> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeMockDeps(overrides?: Partial<AgentExecutorDeps>): AgentExecutorDeps {
  return {
    llmClient: {
      completeStream: vi.fn().mockImplementation(() => chunksToStream([
        { type: 'text_delta', delta: 'Hello ' },
        { type: 'text_delta', delta: 'world' },
        { type: 'message_end', text: 'Hello world', usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'end_turn' },
      ])),
    } as any,
    capabilities: {
      toToolDefinitions: vi.fn().mockReturnValue([]),
      execute: vi.fn().mockResolvedValue({ success: true, summary: 'tool result', data: {} }),
    } as any,
    session: {} as any,
    eventBus: {} as any,
    governor: {
      reset: vi.fn(),
      canCallTool: vi.fn().mockReturnValue({ allowed: true }),
      recordCall: vi.fn(),
    } as any,
    buildSystemPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
    ...overrides,
  };
}

describe('AgentExecutor', () => {
  let emitter: OperationEventEmitter;

  beforeEach(() => {
    emitter = new OperationEventEmitter();
    resetSeq();
  });

  describe('execute — simple text completion', () => {
    it('returns full text and usage', async () => {
      const deps = makeMockDeps();
      const executor = new AgentExecutor(deps);
      const op = makeOperation({ id: 'op-1', prompt: 'Say hello' });

      const result = await executor.execute(op, makeStep(), emitter);

      expect(result.text).toBe('Hello world');
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
      expect(result.toolCalls).toEqual([]);
    });

    it('emits model.delta events', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps = makeMockDeps();
      const executor = new AgentExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-1' }), makeStep(), emitter);

      const deltas = events.filter((e) => e.type === 'model.delta');
      expect(deltas).toHaveLength(2);
      expect(deltas[0].text).toBe('Hello ');
      expect(deltas[1].text).toBe('world');
    });

    it('uses chat channel for chat mode and draft for draft mode', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps = makeMockDeps();
      const executor = new AgentExecutor(deps);

      await executor.execute(makeOperation({ id: 'op-1' }), makeStep('chat'), emitter);
      expect(events.find((e) => e.type === 'model.delta')?.channel).toBe('chat');

      events.length = 0;
      emitter.releaseOperation('op-1');

      await executor.execute(makeOperation({ id: 'op-2' }), makeStep('draft'), emitter);
      expect(events.find((e) => e.type === 'model.delta')?.channel).toBe('draft');
    });
  });

  describe('execute — builds messages from conversation context', () => {
    it('includes conversation turns and current prompt', async () => {
      const deps = makeMockDeps();
      const executor = new AgentExecutor(deps);
      const op = makeOperation({
        id: 'op-1',
        prompt: 'Current question',
        context: makeContext({
          conversation: {
            recentTurns: [
              { role: 'user', text: 'Previous question' },
              { role: 'assistant', text: 'Previous answer' },
            ],
          },
        }),
      });

      await executor.execute(op, makeStep(), emitter);

      expect(deps.llmClient.completeStream).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'You are a helpful assistant.',
          messages: [
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
            { role: 'user', content: 'Current question' },
          ],
        }),
      );
    });

    it('injects writing and retrieval context into the current user message', async () => {
      const deps = makeMockDeps();
      const executor = new AgentExecutor(deps);
      const op = makeOperation({
        id: 'op-writing-context',
        prompt: '请继续完善这一节',
        context: makeContext({
          article: {
            articleId: 'art-1',
            articleTitle: 'Deep Research',
            sectionId: 'sec-2',
            sectionTitle: 'Methods',
            previousSectionSummaries: ['Intro: summary'],
            nextSectionTitles: ['Results'],
          },
          writing: {
            editorId: 'main',
            articleId: 'art-1',
            sectionId: 'sec-2',
            unsavedChanges: true,
          },
          retrieval: {
            lastQuery: 'methods evidence',
            evidence: [{ chunkId: 'c1', paperId: 'p1', text: 'retrieved evidence', score: 0.91 }],
          },
        }),
      });

      await executor.execute(op, makeStep('draft'), emitter);

      const messages = (deps.llmClient.completeStream as any).mock.calls[0][0].messages;
      expect(messages[messages.length - 1].content).toContain('Deep Research');
      expect(messages[messages.length - 1].content).toContain('Methods');
      expect(messages[messages.length - 1].content).toContain('Document: Deep Research');
      expect(messages[messages.length - 1].content).toContain('Unsaved Changes: yes');
      expect(messages[messages.length - 1].content).toContain('methods evidence');
      expect(messages[messages.length - 1].content).toContain('retrieved evidence');
      expect(messages[messages.length - 1].content).toContain('source=Source 1');
      expect(messages[messages.length - 1].content).not.toContain('Article ID:');
      expect(messages[messages.length - 1].content).not.toContain('Section ID:');
      expect(messages[messages.length - 1].content).not.toContain('Writing Article ID:');
      expect(messages[messages.length - 1].content).not.toContain('paper=p1');
    });
  });

  describe('execute — tool calling', () => {
    it('executes tools and feeds results back for multi-round', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      let callCount = 0;
      const deps = makeMockDeps({
        llmClient: {
          completeStream: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // First round: tool call
              return chunksToStream([
                { type: 'text_delta', delta: 'Let me search...' },
                { type: 'tool_use_start', id: 'tc-1', name: 'search' },
                { type: 'tool_use_delta', delta: '{"query":"test"}' },
                { type: 'tool_use_end', id: 'tc-1', name: 'search', input: { query: 'test' } },
                { type: 'message_end', text: '', usage: { inputTokens: 50, outputTokens: 20 }, finishReason: 'tool_use' },
              ]);
            }
            // Second round: final response
            return chunksToStream([
              { type: 'text_delta', delta: 'Found results.' },
              { type: 'message_end', text: 'Found results.', usage: { inputTokens: 80, outputTokens: 30 }, finishReason: 'end_turn' },
            ]);
          }),
        } as any,
        capabilities: {
          toToolDefinitions: vi.fn().mockReturnValue([{ name: 'search', description: 'Search', inputSchema: {} }]),
          execute: vi.fn().mockResolvedValue({ success: true, summary: 'search results', data: { count: 3 } }),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-1' }), makeStep(), emitter);

      expect(result.text).toContain('Found results.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.name).toBe('search');
      expect(result.toolCalls[0]!.status).toBe('completed');
      expect(result.usage.inputTokens).toBe(130); // 50 + 80
      expect(result.usage.outputTokens).toBe(50); // 20 + 30

      // Check tool call events
      const toolEvents = events.filter((e) => e.type === 'tool.call');
      expect(toolEvents.some((e) => e.status === 'running')).toBe(true);
      expect(toolEvents.some((e) => e.status === 'completed')).toBe(true);
    });

    it('governor blocks tool call when not allowed', async () => {
      let callCount = 0;
      const deps = makeMockDeps({
        llmClient: {
          completeStream: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return chunksToStream([
                { type: 'tool_use_start', id: 'tc-1', name: 'dangerous_tool' },
                { type: 'tool_use_end', id: 'tc-1', name: 'dangerous_tool', input: {} },
                { type: 'message_end', text: '', usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'tool_use' },
              ]);
            }
            return chunksToStream([
              { type: 'text_delta', delta: 'ok' },
              { type: 'message_end', text: 'ok', usage: { inputTokens: 10, outputTokens: 5 }, finishReason: 'end_turn' },
            ]);
          }),
        } as any,
        governor: {
          reset: vi.fn(),
          canCallTool: vi.fn().mockReturnValue({ allowed: false, reason: 'blocked' }),
          recordCall: vi.fn(),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-1' }), makeStep(), emitter);

      expect(result.toolCalls[0]!.status).toBe('failed');
      expect(deps.capabilities.execute).not.toHaveBeenCalled();
    });
  });

  describe('execute — LLM error in stream', () => {
    it('throws on error chunk', async () => {
      const deps = makeMockDeps({
        llmClient: {
          completeStream: vi.fn().mockReturnValue(chunksToStream([
            { type: 'error', code: 'rate_limited', message: 'Too many requests' },
          ])),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      await expect(
        executor.execute(makeOperation({ id: 'op-1' }), makeStep(), emitter),
      ).rejects.toThrow('Too many requests');
    });
  });

  describe('execute — abort signal', () => {
    it('stops processing when aborted', async () => {
      const deps = makeMockDeps({
        llmClient: {
          completeStream: vi.fn().mockReturnValue(chunksToStream([
            { type: 'text_delta', delta: 'partial ' },
            { type: 'message_end', text: 'partial ', usage: { inputTokens: 5, outputTokens: 3 }, finishReason: 'end_turn' },
          ])),
        } as any,
      });

      const controller = new AbortController();
      controller.abort(); // pre-abort

      const executor = new AgentExecutor(deps);
      const result = await executor.execute(
        makeOperation({ id: 'op-1' }),
        makeStep(),
        emitter,
        controller.signal,
      );

      // Should return early with empty or partial text
      expect(result.text).toBe('');
    });
  });

  describe('execute — patch mode disables tools', () => {
    it('does not pass tools in patch mode', async () => {
      const deps = makeMockDeps({
        capabilities: {
          toToolDefinitions: vi.fn().mockReturnValue([{ name: 'search', description: 'Search', inputSchema: {} }]),
          execute: vi.fn(),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-1' }), makeStep('patch'), emitter);

      const callArgs = (deps.llmClient.completeStream as any).mock.calls[0][0];
      expect(callArgs.tools).toBeUndefined();
    });

    it('does not pass tools for plain greetings', async () => {
      const deps = makeMockDeps({
        capabilities: {
          toToolDefinitions: vi.fn().mockReturnValue([{ name: 'search', description: 'Search', inputSchema: {} }]),
          execute: vi.fn(),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-hello', prompt: '你好' }), makeStep('chat'), emitter);

      const callArgs = (deps.llmClient.completeStream as any).mock.calls[0][0];
      expect(callArgs.tools).toBeUndefined();
      expect(deps.capabilities.toToolDefinitions).not.toHaveBeenCalled();
    });
  });

  describe('execute — tool failure handling (success: false)', () => {
    it('marks tool as failed and feeds explicit failure signal back to model', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      let callCount = 0;
      const deps = makeMockDeps({
        llmClient: {
          completeStream: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return chunksToStream([
                { type: 'text_delta', delta: 'Searching...' },
                { type: 'tool_use_start', id: 'tc-1', name: 'search' },
                { type: 'tool_use_end', id: 'tc-1', name: 'search', input: { query: 'test' } },
                { type: 'message_end', text: '', usage: { inputTokens: 50, outputTokens: 20 }, finishReason: 'tool_use' },
              ]);
            }
            return chunksToStream([
              { type: 'text_delta', delta: 'Done.' },
              { type: 'message_end', text: 'Done.', usage: { inputTokens: 80, outputTokens: 10 }, finishReason: 'end_turn' },
            ]);
          }),
        } as any,
        capabilities: {
          toToolDefinitions: vi.fn().mockReturnValue([{ name: 'search', description: 'Search', inputSchema: {} }]),
          execute: vi.fn().mockResolvedValue({ success: false, summary: 'Error executing search: connection refused' }),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-fail' }), makeStep(), emitter);

      // Tool should be marked as failed
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]!.status).toBe('failed');
      expect(result.toolCalls[0]!.output).toContain('connection refused');

      // Governor should record this as a failure
      expect(deps.governor.recordCall).toHaveBeenCalledWith('search', false);

      // Emitted events should show failure
      const toolEvents = events.filter((e) => e.type === 'tool.call');
      expect(toolEvents.some((e) => e.status === 'failed')).toBe(true);

      // The message fed back to model should contain FAILED marker
      const messages = (deps.llmClient.completeStream as any).mock.calls[1][0].messages;
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.content).toContain('[Tool FAILED: search]');
      expect(lastMsg.content).toContain('Do NOT retry');
    });
  });

  describe('execute — step-level allowedToolFamilies', () => {
    it('uses step allowedToolFamilies instead of routing when provided', async () => {
      const deps = makeMockDeps({
        capabilities: {
          toToolDefinitions: vi.fn().mockReturnValue([]),
          execute: vi.fn(),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      const step = { kind: 'llm_generate' as const, mode: 'draft' as const, allowedToolFamilies: ['writing_edit' as const] };
      await executor.execute(makeOperation({ id: 'op-constrained', prompt: '帮我续写' }), step, emitter);

      // toToolDefinitions should be called with the step-level families, not the route's
      expect(deps.capabilities.toToolDefinitions).toHaveBeenCalledWith(
        expect.objectContaining({ allowedFamilies: ['writing_edit'] }),
      );

      // System prompt should NOT contain routing instruction for constrained steps
      const callArgs = (deps.llmClient.completeStream as any).mock.calls[0][0];
      expect(callArgs.systemPrompt).not.toContain('当前工具路由');
    });

    it('does not inject routing instruction in draft mode even without step families', async () => {
      const deps = makeMockDeps({
        capabilities: {
          toToolDefinitions: vi.fn().mockReturnValue([{ name: 'search', description: 'Search', inputSchema: {} }]),
          execute: vi.fn(),
        } as any,
      });

      const executor = new AgentExecutor(deps);
      await executor.execute(
        makeOperation({ id: 'op-draft', prompt: '帮我写一段关于方法的内容' }),
        makeStep('draft'),
        emitter,
      );

      const callArgs = (deps.llmClient.completeStream as any).mock.calls[0][0];
      expect(callArgs.systemPrompt).not.toContain('当前工具路由');
    });
  });
});
