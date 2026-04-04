import type { ChatMessage } from '../../../../../shared-types/models';
import { useChatStore } from '../../../../core/store/useChatStore';
import { ChunkAccumulator } from './ChunkAccumulator';

function makeAssistantMessage(id: string, overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'streaming',
    streamBuffer: '',
    ...overrides,
  };
}

describe('ChunkAccumulator', () => {
  beforeEach(() => {
    useChatStore.getState().clearChatHistory();
  });

  it('keeps streamed text bound to the original session after active session changes', () => {
    const onFinalize = vi.fn();
    const accumulator = new ChunkAccumulator({ onFinalize });

    useChatStore.getState().setActiveSessionKey('chat:a');
    useChatStore.getState().ensureSession('chat:a');
    useChatStore.getState().addMessage(makeAssistantMessage('assistant-a'));

    accumulator.bind('assistant-a', 'chat:a');
    accumulator.pushChunk('Hello');

    useChatStore.getState().setActiveSessionKey('chat:b');
    useChatStore.getState().ensureSession('chat:b');
    useChatStore.getState().addMessage(
      makeAssistantMessage('assistant-b', { content: 'other-session' }),
    );

    accumulator.pushChunk(' world');
    accumulator.finalize();

    const sessionA = useChatStore.getState().sessions['chat:a'];
    const sessionB = useChatStore.getState().sessions['chat:b'];

    expect(sessionA?.messages[0]?.content).toBe('Hello world');
    expect(sessionA?.messages[0]?.status).toBe('completed');
    expect(sessionB?.messages[0]?.content).toBe('other-session');
    expect(onFinalize).toHaveBeenCalledWith('assistant-a', 'Hello world', 'chat:a');
  });
});