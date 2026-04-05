/**
 * RecipeRegistry — manages operation recipes with explicit arbitration.
 *
 * Recipes define how a given (intent, context) maps to an execution plan.
 * When multiple recipes match, arbitration follows a strict priority chain:
 *   1. priority (desc)
 *   2. specificity (desc)
 *   3. surface alignment
 *   4. deferred to user (clarification)
 */

import type {
  OperationRecipe,
  CopilotOperation,
  ContextSnapshot,
  RecipeResolution,
  OutputTarget,
  CopilotSurface,
} from './types';

export class RecipeRegistry {
  private recipes: OperationRecipe[] = [];

  register(recipe: OperationRecipe): void {
    this.recipes.push(recipe);
    // Keep sorted by priority desc for faster resolution
    this.recipes.sort((a, b) => b.priority - a.priority);
  }

  unregister(recipeId: string): void {
    this.recipes = this.recipes.filter((r) => r.id !== recipeId);
  }

  getAll(): OperationRecipe[] {
    return [...this.recipes];
  }

  /**
   * Resolve the best recipe for an operation.
   * Returns resolution metadata including candidates and reason.
   */
  resolve(operation: CopilotOperation, context: ContextSnapshot): RecipeResolution {
    // Step 1: collect all matching recipes
    const candidates = this.recipes.filter((r) => r.matches(operation, context));

    if (candidates.length === 0) {
      return {
        selected: null,
        candidates: [],
        resolution: 'no_match',
      };
    }

    if (candidates.length === 1) {
      return {
        selected: candidates[0]!,
        candidates: candidates.map((c) => c.id),
        resolution: 'single_match',
      };
    }

    // Step 2: sort by priority desc
    const sorted = [...candidates].sort((a, b) => b.priority - a.priority);

    if (sorted[0]!.priority > sorted[1]!.priority) {
      return {
        selected: sorted[0]!,
        candidates: sorted.map((c) => c.id),
        resolution: 'priority',
      };
    }

    // Step 3: same priority → sort by specificity desc
    const topPriority = sorted[0]!.priority;
    const samePriority = sorted.filter((r) => r.priority === topPriority);
    samePriority.sort((a, b) => b.specificity - a.specificity);

    if (samePriority[0]!.specificity > samePriority[1]!.specificity) {
      return {
        selected: samePriority[0]!,
        candidates: sorted.map((c) => c.id),
        resolution: 'specificity',
      };
    }

    // Step 4: same specificity → check surface alignment
    const surfaceAligned = samePriority.filter((r) =>
      isSurfaceAligned(r, operation.surface, operation.outputTarget),
    );

    if (surfaceAligned.length === 1) {
      return {
        selected: surfaceAligned[0]!,
        candidates: sorted.map((c) => c.id),
        resolution: 'surface_alignment',
      };
    }

    // Step 5: still ambiguous → defer to user
    return {
      selected: null,
      candidates: sorted.map((c) => c.id),
      resolution: 'deferred_to_user',
    };
  }
}

/** Check if a recipe is naturally aligned with the operation's surface */
function isSurfaceAligned(
  recipe: OperationRecipe,
  surface: CopilotSurface,
  target: OutputTarget,
): boolean {
  // Simple heuristic: recipes for editor intents align with editor surfaces
  const editorIntents = new Set([
    'rewrite-selection', 'expand-selection', 'compress-selection',
    'continue-writing', 'generate-section',
  ]);

  const isEditorSurface = surface === 'editor-toolbar' || surface === 'outline-menu';
  const isEditorTarget = target.type.startsWith('editor-') || target.type.startsWith('section-');
  const hasEditorIntent = recipe.intents.some((i) => editorIntents.has(i));

  if (isEditorSurface && hasEditorIntent) return true;
  if (isEditorTarget && hasEditorIntent) return true;

  const readerIntents = new Set(['draft-citation', 'insert-citation-sentence', 'summarize-selection']);
  const isReaderSurface = surface === 'reader-selection';
  const hasReaderIntent = recipe.intents.some((i) => readerIntents.has(i));

  if (isReaderSurface && hasReaderIntent) return true;

  return false;
}
