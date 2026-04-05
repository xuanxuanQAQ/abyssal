import { RecipeRegistry } from '../recipe-registry';
import { makeOperation, makeRecipe, makeContext, resetSeq } from './helpers';

describe('RecipeRegistry', () => {
  let registry: RecipeRegistry;

  beforeEach(() => {
    registry = new RecipeRegistry();
    resetSeq();
  });

  describe('register / unregister', () => {
    it('registers and lists recipes', () => {
      registry.register(makeRecipe({ id: 'a' }));
      registry.register(makeRecipe({ id: 'b' }));
      expect(registry.getAll().map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('unregisters by id', () => {
      registry.register(makeRecipe({ id: 'a' }));
      registry.register(makeRecipe({ id: 'b' }));
      registry.unregister('a');
      expect(registry.getAll().map((r) => r.id)).toEqual(['b']);
    });
  });

  describe('resolve — no candidates', () => {
    it('returns no_match when nothing matches', () => {
      registry.register(makeRecipe({ matchReturn: false }));
      const op = makeOperation();
      const result = registry.resolve(op, makeContext());
      expect(result.selected).toBeNull();
      expect(result.resolution).toBe('no_match');
    });
  });

  describe('resolve — single match', () => {
    it('returns single_match resolution', () => {
      registry.register(makeRecipe({ id: 'winner', matchReturn: true }));
      registry.register(makeRecipe({ id: 'loser', matchReturn: false }));
      const result = registry.resolve(makeOperation(), makeContext());
      expect(result.selected?.id).toBe('winner');
      expect(result.resolution).toBe('single_match');
    });
  });

  describe('resolve — priority arbitration', () => {
    it('selects higher priority recipe', () => {
      registry.register(makeRecipe({ id: 'low', priority: 3, matchReturn: true }));
      registry.register(makeRecipe({ id: 'high', priority: 10, matchReturn: true }));
      const result = registry.resolve(makeOperation(), makeContext());
      expect(result.selected?.id).toBe('high');
      expect(result.resolution).toBe('priority');
    });
  });

  describe('resolve — specificity arbitration', () => {
    it('selects higher specificity when priority ties', () => {
      registry.register(makeRecipe({ id: 'general', priority: 5, specificity: 2, matchReturn: true }));
      registry.register(makeRecipe({ id: 'specific', priority: 5, specificity: 8, matchReturn: true }));
      const result = registry.resolve(makeOperation(), makeContext());
      expect(result.selected?.id).toBe('specific');
      expect(result.resolution).toBe('specificity');
    });
  });

  describe('resolve — surface alignment', () => {
    it('selects surface-aligned recipe when priority and specificity tie', () => {
      const editorRecipe = makeRecipe({
        id: 'editor',
        priority: 5,
        specificity: 5,
        intents: ['rewrite-selection'],
        matchReturn: true,
      });
      const chatRecipe = makeRecipe({
        id: 'chat',
        priority: 5,
        specificity: 5,
        intents: ['ask'],
        matchReturn: true,
      });
      registry.register(editorRecipe);
      registry.register(chatRecipe);

      const op = makeOperation({
        surface: 'editor-toolbar',
        intent: 'rewrite-selection',
        outputTarget: { type: 'editor-selection-replace', editorId: 'main', articleId: 'a', sectionId: 's', from: 0, to: 10 },
      });
      const result = registry.resolve(op, makeContext());
      expect(result.selected?.id).toBe('editor');
      expect(result.resolution).toBe('surface_alignment');
    });
  });

  describe('resolve — deferred to user on ambiguity', () => {
    it('defers when everything ties', () => {
      registry.register(makeRecipe({ id: 'a', priority: 5, specificity: 5, intents: ['ask'], matchReturn: true }));
      registry.register(makeRecipe({ id: 'b', priority: 5, specificity: 5, intents: ['ask'], matchReturn: true }));
      const op = makeOperation({ surface: 'chat', outputTarget: { type: 'chat-message' } });
      const result = registry.resolve(op, makeContext());
      expect(result.resolution).toBe('deferred_to_user');
      expect(result.selected).toBeNull();
    });
  });

  describe('resolve — sorted by priority internally', () => {
    it('maintains priority sort after multiple registrations', () => {
      registry.register(makeRecipe({ id: 'med', priority: 5 }));
      registry.register(makeRecipe({ id: 'high', priority: 10 }));
      registry.register(makeRecipe({ id: 'low', priority: 1 }));
      const all = registry.getAll();
      expect(all[0]!.id).toBe('high');
      expect(all[1]!.id).toBe('med');
      expect(all[2]!.id).toBe('low');
    });
  });
});
