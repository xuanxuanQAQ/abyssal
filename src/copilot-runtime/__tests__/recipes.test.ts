import {
  askRecipe,
  rewriteSelectionRecipe,
  expandSelectionRecipe,
  compressSelectionRecipe,
  continueWritingRecipe,
  generateSectionRecipe,
  insertCitationSentenceRecipe,
  draftCitationRecipe,
  summarizeSelectionRecipe,
  summarizeSectionRecipe,
  reviewArgumentRecipe,
  retrieveEvidenceRecipe,
  navigateRecipe,
  runWorkflowRecipe,
  builtinRecipes,
} from '../recipes';
import { makeOperation, makeContext, resetSeq } from './helpers';
import type { ContextSnapshot, EditorSelectionContext } from '../types';

function editorContext(): ContextSnapshot {
  return makeContext({
    selection: {
      kind: 'editor',
      articleId: 'art-1',
      sectionId: 'sec-1',
      selectedText: 'selected text',
      from: 10,
      to: 23,
    } as EditorSelectionContext,
  });
}

function readerContext(): ContextSnapshot {
  return makeContext({
    selection: {
      kind: 'reader',
      paperId: 'paper-1',
      selectedText: 'PDF selected text',
    },
  });
}

describe('Built-in Recipes', () => {
  beforeEach(() => resetSeq());

  describe('builtinRecipes collection', () => {
    it('contains 14 recipes', () => {
      expect(builtinRecipes).toHaveLength(14);
    });

    it('all have unique ids', () => {
      const ids = builtinRecipes.map((r) => r.id);
      expect(new Set(ids).size).toBe(14);
    });
  });

  describe('askRecipe', () => {
    it('matches ask intent', () => {
      const op = makeOperation({ intent: 'ask' });
      expect(askRecipe.matches(op, makeContext())).toBe(true);
    });

    it('does not match other intents', () => {
      const op = makeOperation({ intent: 'rewrite-selection' });
      expect(askRecipe.matches(op, makeContext())).toBe(false);
    });

    it('builds plan with chat-message target and llm_generate step', async () => {
      const plan = await askRecipe.buildPlan(makeOperation({ intent: 'ask' }), makeContext());
      expect(plan.target.type).toBe('chat-message');
      expect(plan.steps).toEqual([{ kind: 'llm_generate', mode: 'chat' }]);
      expect(plan.confirmation.mode).toBe('auto');
    });
  });

  describe('rewriteSelectionRecipe', () => {
    it('matches rewrite-selection with editor selection', () => {
      const op = makeOperation({ intent: 'rewrite-selection' });
      expect(rewriteSelectionRecipe.matches(op, editorContext())).toBe(true);
    });

    it('does not match without editor selection', () => {
      const op = makeOperation({ intent: 'rewrite-selection' });
      expect(rewriteSelectionRecipe.matches(op, makeContext())).toBe(false);
    });

    it('builds plan with editor-selection-replace target', async () => {
      const op = makeOperation({ intent: 'rewrite-selection' });
      const plan = await rewriteSelectionRecipe.buildPlan(op, editorContext());
      expect(plan.target.type).toBe('editor-selection-replace');
      expect(plan.steps.some((s) => s.kind === 'llm_generate')).toBe(true);
      expect(plan.steps.some((s) => s.kind === 'apply_patch')).toBe(true);
      expect(plan.confirmation.mode).toBe('preview');
    });

    it('falls back to chat when no editor selection', async () => {
      const op = makeOperation({ intent: 'rewrite-selection' });
      const plan = await rewriteSelectionRecipe.buildPlan(op, makeContext());
      expect(plan.target.type).toBe('chat-message');
    });
  });

  describe('expandSelectionRecipe', () => {
    it('matches expand-selection with editor selection', () => {
      const op = makeOperation({ intent: 'expand-selection' });
      expect(expandSelectionRecipe.matches(op, editorContext())).toBe(true);
    });

    it('builds plan with editor target', async () => {
      const plan = await expandSelectionRecipe.buildPlan(
        makeOperation({ intent: 'expand-selection' }),
        editorContext(),
      );
      expect(plan.target.type).toBe('editor-selection-replace');
    });
  });

  describe('compressSelectionRecipe', () => {
    it('matches compress-selection with editor selection', () => {
      const op = makeOperation({ intent: 'compress-selection' });
      expect(compressSelectionRecipe.matches(op, editorContext())).toBe(true);
    });

    it('builds plan with editor target', async () => {
      const plan = await compressSelectionRecipe.buildPlan(
        makeOperation({ intent: 'compress-selection' }),
        editorContext(),
      );
      expect(plan.target.type).toBe('editor-selection-replace');
    });
  });

  describe('continueWritingRecipe', () => {
    it('matches continue-writing with editor selection', () => {
      const op = makeOperation({ intent: 'continue-writing' });
      expect(continueWritingRecipe.matches(op, editorContext())).toBe(true);
    });

    it('builds plan with editor-insert-after target', async () => {
      const plan = await continueWritingRecipe.buildPlan(
        makeOperation({ intent: 'continue-writing' }),
        editorContext(),
      );
      expect(plan.target.type).toBe('editor-insert-after');
    });
  });

  describe('generateSectionRecipe', () => {
    it('matches generate-section intent', () => {
      const op = makeOperation({ intent: 'generate-section' });
      expect(generateSectionRecipe.matches(op, makeContext())).toBe(true);
    });

    it('builds plan with retrieval + generation steps', async () => {
      const ctx = makeContext({
        article: { articleId: 'art-1', sectionId: 'sec-1' },
      });
      const plan = await generateSectionRecipe.buildPlan(
        makeOperation({ intent: 'generate-section' }),
        ctx,
      );
      expect(plan.steps.some((s) => s.kind === 'retrieve')).toBe(true);
      expect(plan.steps.some((s) => s.kind === 'llm_generate')).toBe(true);
      expect(plan.confirmation.mode).toBe('explicit');
    });

    it('uses section-replace target when article context available', async () => {
      const ctx = makeContext({
        article: { articleId: 'art-1', sectionId: 'sec-1' },
      });
      const plan = await generateSectionRecipe.buildPlan(makeOperation(), ctx);
      expect(plan.target.type).toBe('section-replace');
    });

    it('falls back to chat-message when no article context', async () => {
      const plan = await generateSectionRecipe.buildPlan(makeOperation(), makeContext());
      expect(plan.target.type).toBe('chat-message');
    });
  });

  describe('insertCitationSentenceRecipe', () => {
    it('matches with selection present', () => {
      const op = makeOperation({ intent: 'insert-citation-sentence' });
      expect(insertCitationSentenceRecipe.matches(op, readerContext())).toBe(true);
    });

    it('does not match without selection', () => {
      const op = makeOperation({ intent: 'insert-citation-sentence' });
      expect(insertCitationSentenceRecipe.matches(op, makeContext())).toBe(false);
    });

    it('builds plan with retrieve + generate steps', async () => {
      const plan = await insertCitationSentenceRecipe.buildPlan(
        makeOperation({ intent: 'insert-citation-sentence' }),
        readerContext(),
      );
      expect(plan.steps[0]!.kind).toBe('retrieve');
      expect(plan.steps[1]!.kind).toBe('llm_generate');
    });
  });

  describe('draftCitationRecipe', () => {
    it('matches draft-citation intent', () => {
      expect(draftCitationRecipe.matches(
        makeOperation({ intent: 'draft-citation' }),
        makeContext(),
      )).toBe(true);
    });

    it('builds plan with retrieve + chat', async () => {
      const plan = await draftCitationRecipe.buildPlan(makeOperation({ prompt: 'cite X' }), makeContext());
      expect(plan.steps.map((s) => s.kind)).toEqual(['retrieve', 'llm_generate']);
    });
  });

  describe('summarizeSelectionRecipe', () => {
    it('builds plan with single llm_generate step', async () => {
      const plan = await summarizeSelectionRecipe.buildPlan(makeOperation(), makeContext());
      expect(plan.steps).toEqual([{ kind: 'llm_generate', mode: 'chat' }]);
    });
  });

  describe('summarizeSectionRecipe', () => {
    it('builds plan with single llm_generate step', async () => {
      const plan = await summarizeSectionRecipe.buildPlan(makeOperation(), makeContext());
      expect(plan.steps).toEqual([{ kind: 'llm_generate', mode: 'chat' }]);
    });
  });

  describe('reviewArgumentRecipe', () => {
    it('builds plan with retrieve + generate', async () => {
      const plan = await reviewArgumentRecipe.buildPlan(makeOperation({ prompt: 'review this' }), makeContext());
      expect(plan.steps.map((s) => s.kind)).toEqual(['retrieve', 'llm_generate']);
    });
  });

  describe('retrieveEvidenceRecipe', () => {
    it('builds plan with retrieve + generate', async () => {
      const plan = await retrieveEvidenceRecipe.buildPlan(makeOperation({ prompt: 'find evidence' }), makeContext());
      expect(plan.steps.map((s) => s.kind)).toEqual(['retrieve', 'llm_generate']);
    });
  });

  describe('navigateRecipe', () => {
    it('matches navigate intent', () => {
      expect(navigateRecipe.matches(
        makeOperation({ intent: 'navigate' }),
        makeContext(),
      )).toBe(true);
    });

    it('builds plan with navigate step', async () => {
      const op = makeOperation({
        intent: 'navigate',
        outputTarget: { type: 'navigate', view: 'reader' },
      });
      const plan = await navigateRecipe.buildPlan(op, makeContext());
      expect(plan.steps[0]!.kind).toBe('navigate');
      expect(plan.confirmation.mode).toBe('auto');
    });
  });

  describe('runWorkflowRecipe', () => {
    it('matches run-workflow intent', () => {
      expect(runWorkflowRecipe.matches(
        makeOperation({ intent: 'run-workflow' }),
        makeContext(),
      )).toBe(true);
    });

    it('builds plan with run_workflow step', async () => {
      const op = makeOperation({
        intent: 'run-workflow',
        outputTarget: { type: 'workflow', workflow: 'discover' },
      });
      const plan = await runWorkflowRecipe.buildPlan(op, makeContext());
      expect(plan.steps[0]!.kind).toBe('run_workflow');
      expect(plan.confirmation.mode).toBe('explicit');
    });
  });
});
