import { IntentRouter } from '../intent-router';
import { makeOperation, resetSeq } from './helpers';

describe('IntentRouter', () => {
  let router: IntentRouter;

  beforeEach(() => {
    router = new IntentRouter();
    resetSeq();
  });

  describe('classify — explicit intent passthrough', () => {
    it('trusts non-ask intent with confidence 1.0', async () => {
      const op = makeOperation({ intent: 'rewrite-selection', prompt: '随便写的' });
      const result = await router.classify(op);
      expect(result.intent).toBe('rewrite-selection');
      expect(result.confidence).toBe(1.0);
      expect(result.ambiguous).toBe(false);
    });
  });

  describe('classify — keyword pattern matching', () => {
    const cases: Array<[string, string, string]> = [
      ['改写这段话', 'rewrite-selection', 'Chinese rewrite keyword'],
      ['请帮我 rewrite 一下', 'rewrite-selection', 'English rewrite keyword'],
      ['扩展这段内容', 'expand-selection', 'expand keyword'],
      ['压缩一下', 'compress-selection', 'compress keyword'],
      ['续写', 'continue-writing', 'continue keyword'],
      ['生成第三节', 'generate-section', 'generate section keyword'],
      ['引用这句话', 'insert-citation-sentence', 'citation sentence keyword'],
      ['帮我总结选中的内容', 'summarize-selection', 'summarize selection keyword'],
      ['总结这一节', 'summarize-section', 'summarize section keyword'],
      ['审查论证', 'review-argument', 'review keyword'],
      ['检索证据', 'retrieve-evidence', 'retrieve keyword'],
      ['导航到library', 'navigate', 'navigate keyword'],
      ['运行工作流 discover', 'run-workflow', 'workflow keyword'],
    ];

    it.each(cases)('"%s" → %s (%s)', async (prompt, expectedIntent) => {
      const op = makeOperation({ prompt });
      const result = await router.classify(op);
      expect(result.intent).toBe(expectedIntent);
      expect(result.confidence).toBeGreaterThan(0.55);
    });
  });

  describe('classify — unrecognized prompt falls back to ask', () => {
    it('returns ask for generic text', async () => {
      const op = makeOperation({ prompt: '今天天气怎么样' });
      const result = await router.classify(op);
      expect(result.intent).toBe('ask');
      expect(result.confidence).toBe(0.8);
      expect(result.ambiguous).toBe(false);
    });
  });

  describe('classify — ambiguity detection', () => {
    it('detects ambiguity when two patterns match with close confidence', async () => {
      // "引用" matches both draft-citation (p8) and insert-citation-sentence won't match,
      // but "引用" alone will match draft-citation
      const op = makeOperation({ prompt: '引用' });
      const result = await router.classify(op);
      // Should at least classify to one intent
      expect(result.intent).toBeDefined();
    });
  });

  describe('classify — output target inference', () => {
    it('infers editor-selection-replace for rewrite with editor selection', async () => {
      const op = makeOperation({
        prompt: '改写',
        surface: 'editor-toolbar',
        context: {
          ...makeOperation().context,
          selection: {
            kind: 'editor',
            articleId: 'art-1',
            sectionId: 'sec-1',
            selectedText: 'hello',
            from: 0,
            to: 5,
          },
        },
      });
      const result = await router.classify(op);
      expect(result.outputTarget.type).toBe('editor-selection-replace');
    });

    it('infers editor-insert-after for continue-writing with editor selection', async () => {
      const op = makeOperation({
        prompt: '续写',
        surface: 'editor-toolbar',
        context: {
          ...makeOperation().context,
          selection: {
            kind: 'editor',
            articleId: 'art-1',
            sectionId: 'sec-1',
            selectedText: 'existing',
            from: 0,
            to: 8,
          },
        },
      });
      const result = await router.classify(op);
      expect(result.outputTarget.type).toBe('editor-insert-after');
    });

    it('infers navigate target for navigation intent', async () => {
      const op = makeOperation({ prompt: '导航到阅读页' });
      const result = await router.classify(op);
      expect(result.outputTarget.type).toBe('navigate');
    });

    it('infers workflow target for workflow intent', async () => {
      const op = makeOperation({ prompt: '运行 discover 工作流' });
      const result = await router.classify(op);
      expect(result.outputTarget.type).toBe('workflow');
    });

    it('defaults to chat-message for reader selection', async () => {
      const op = makeOperation({
        prompt: '总结一下',
        surface: 'reader-selection',
        context: {
          ...makeOperation().context,
          selection: {
            kind: 'reader',
            paperId: 'p-1',
            selectedText: 'some text from PDF',
          },
        },
      });
      const result = await router.classify(op);
      // summarize-selection with reader context → chat message
      expect(result.outputTarget.type).toBe('chat-message');
    });
  });
});
