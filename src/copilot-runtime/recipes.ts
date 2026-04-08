/**
 * Default operation recipes — built-in recipes for common operations.
 */

import type {
  OperationRecipe,
} from './types';

// ─── Chat/Ask Recipe ───

export const askRecipe: OperationRecipe = {
  id: 'builtin:ask',
  intents: ['ask'],
  priority: 0,
  specificity: 0,
  matches: (op) => op.intent === 'ask',
  buildPlan: async (_op) => ({
    recipeId: 'builtin:ask',
    target: { type: 'chat-message' },
    steps: [{ kind: 'llm_generate', mode: 'chat' }],
    confirmation: { mode: 'auto', reason: 'Chat response', requiredFor: 'execution' },
  }),
};

// ─── Rewrite Selection Recipe ───

export const rewriteSelectionRecipe: OperationRecipe = {
  id: 'builtin:rewrite-selection',
  intents: ['rewrite-selection'],
  priority: 10,
  specificity: 8,
  matches: (op, ctx) =>
    op.intent === 'rewrite-selection' && ctx.selection?.kind === 'editor',
  buildPlan: async (op, ctx) => {
    const sel = ctx.selection;
    if (sel?.kind !== 'editor') {
      return {
        recipeId: 'builtin:rewrite-selection',
        target: { type: 'chat-message' },
        steps: [{ kind: 'llm_generate', mode: 'chat' }],
        confirmation: { mode: 'auto', reason: 'No editor selection', requiredFor: 'execution' },
      };
    }
    return {
      recipeId: 'builtin:rewrite-selection',
      target: {
        type: 'editor-selection-replace',
        editorId: 'main',
        articleId: sel.articleId,
        sectionId: sel.sectionId,
        from: sel.from,
        to: sel.to,
      },
      steps: [
        { kind: 'llm_generate', mode: 'draft', allowedToolFamilies: ['writing_edit'] },
        { kind: 'apply_patch', patchTarget: {
          type: 'editor-selection-replace',
          editorId: 'main',
          articleId: sel.articleId,
          sectionId: sel.sectionId,
          from: sel.from,
          to: sel.to,
        }},
      ],
      confirmation: { mode: 'preview', reason: 'Editor mutation', requiredFor: 'execution' },
    };
  },
};

// ─── Expand Selection Recipe ───

export const expandSelectionRecipe: OperationRecipe = {
  id: 'builtin:expand-selection',
  intents: ['expand-selection'],
  priority: 10,
  specificity: 8,
  matches: (op, ctx) =>
    op.intent === 'expand-selection' && ctx.selection?.kind === 'editor',
  buildPlan: async (op, ctx) => {
    const sel = ctx.selection;
    if (sel?.kind !== 'editor') {
      return {
        recipeId: 'builtin:expand-selection',
        target: { type: 'chat-message' },
        steps: [{ kind: 'llm_generate', mode: 'chat' }],
        confirmation: { mode: 'auto', reason: 'No editor selection', requiredFor: 'execution' },
      };
    }
    return {
      recipeId: 'builtin:expand-selection',
      target: {
        type: 'editor-selection-replace',
        editorId: 'main',
        articleId: sel.articleId,
        sectionId: sel.sectionId,
        from: sel.from,
        to: sel.to,
      },
      steps: [
        { kind: 'llm_generate', mode: 'draft', allowedToolFamilies: ['writing_edit'] },
        { kind: 'apply_patch', patchTarget: {
          type: 'editor-selection-replace',
          editorId: 'main',
          articleId: sel.articleId,
          sectionId: sel.sectionId,
          from: sel.from,
          to: sel.to,
        }},
      ],
      confirmation: { mode: 'preview', reason: 'Editor mutation', requiredFor: 'execution' },
    };
  },
};

// ─── Compress Selection Recipe ───

export const compressSelectionRecipe: OperationRecipe = {
  id: 'builtin:compress-selection',
  intents: ['compress-selection'],
  priority: 10,
  specificity: 8,
  matches: (op, ctx) =>
    op.intent === 'compress-selection' && ctx.selection?.kind === 'editor',
  buildPlan: async (op, ctx) => {
    const sel = ctx.selection;
    if (sel?.kind !== 'editor') {
      return {
        recipeId: 'builtin:compress-selection',
        target: { type: 'chat-message' },
        steps: [{ kind: 'llm_generate', mode: 'chat' }],
        confirmation: { mode: 'auto', reason: 'No editor selection', requiredFor: 'execution' },
      };
    }
    return {
      recipeId: 'builtin:compress-selection',
      target: {
        type: 'editor-selection-replace',
        editorId: 'main',
        articleId: sel.articleId,
        sectionId: sel.sectionId,
        from: sel.from,
        to: sel.to,
      },
      steps: [
        { kind: 'llm_generate', mode: 'draft', allowedToolFamilies: ['writing_edit'] },
        { kind: 'apply_patch', patchTarget: {
          type: 'editor-selection-replace',
          editorId: 'main',
          articleId: sel.articleId,
          sectionId: sel.sectionId,
          from: sel.from,
          to: sel.to,
        }},
      ],
      confirmation: { mode: 'preview', reason: 'Editor mutation', requiredFor: 'execution' },
    };
  },
};

// ─── Continue Writing Recipe ───

export const continueWritingRecipe: OperationRecipe = {
  id: 'builtin:continue-writing',
  intents: ['continue-writing'],
  priority: 10,
  specificity: 7,
  matches: (op, ctx) =>
    op.intent === 'continue-writing' && ctx.selection?.kind === 'editor',
  buildPlan: async (op, ctx) => {
    const sel = ctx.selection;
    if (sel?.kind !== 'editor') {
      return {
        recipeId: 'builtin:continue-writing',
        target: { type: 'chat-message' },
        steps: [{ kind: 'llm_generate', mode: 'chat' }],
        confirmation: { mode: 'auto', reason: 'No editor selection', requiredFor: 'execution' },
      };
    }
    return {
      recipeId: 'builtin:continue-writing',
      target: {
        type: 'editor-insert-after',
        editorId: 'main',
        articleId: sel.articleId,
        sectionId: sel.sectionId,
        pos: sel.to,
      },
      steps: [
        { kind: 'llm_generate', mode: 'draft', allowedToolFamilies: ['writing_edit'] },
        { kind: 'apply_patch', patchTarget: {
          type: 'editor-insert-after',
          editorId: 'main',
          articleId: sel.articleId,
          sectionId: sel.sectionId,
          pos: sel.to,
        }},
      ],
      confirmation: { mode: 'preview', reason: 'Editor insert', requiredFor: 'execution' },
    };
  },
};

// ─── Generate Section Recipe ───

export const generateSectionRecipe: OperationRecipe = {
  id: 'builtin:generate-section',
  intents: ['generate-section'],
  priority: 8,
  specificity: 6,
  matches: (op) => op.intent === 'generate-section',
  buildPlan: async (op, ctx) => {
    const article = ctx.article;
    return {
      recipeId: 'builtin:generate-section',
      target: article
        ? { type: 'section-replace', articleId: article.articleId, sectionId: article.sectionId ?? '' }
        : { type: 'chat-message' },
      steps: [
        { kind: 'retrieve', query: op.prompt || 'section content evidence', source: 'rag' },
        { kind: 'llm_generate', mode: 'draft' },
        ...(article ? [{ kind: 'apply_patch' as const, patchTarget: {
          type: 'section-replace' as const,
          articleId: article.articleId,
          sectionId: article.sectionId ?? '',
        }}] : []),
      ],
      confirmation: { mode: 'explicit', reason: 'Section-level mutation', requiredFor: 'destructive-mutation' },
    };
  },
};

// ─── Insert Citation Sentence Recipe ───

export const insertCitationSentenceRecipe: OperationRecipe = {
  id: 'builtin:insert-citation-sentence',
  intents: ['insert-citation-sentence'],
  priority: 9,
  specificity: 9,
  matches: (op, ctx) =>
    op.intent === 'insert-citation-sentence' && ctx.selection != null,
  buildPlan: async (op, ctx) => {
    const sel = ctx.selection;
    // When an editor selection is available, target editor insert-after
    if (sel?.kind === 'editor') {
      return {
        recipeId: 'builtin:insert-citation-sentence',
        target: {
          type: 'editor-insert-after',
          editorId: 'main',
          articleId: sel.articleId,
          sectionId: sel.sectionId,
          pos: sel.to,
        },
        steps: [
          { kind: 'retrieve', query: sel.selectedText || op.prompt, source: 'rag' },
          { kind: 'llm_generate', mode: 'draft' },
          { kind: 'apply_patch', patchTarget: {
            type: 'editor-insert-after',
            editorId: 'main',
            articleId: sel.articleId,
            sectionId: sel.sectionId,
            pos: sel.to,
          }},
        ],
        confirmation: { mode: 'preview', reason: 'Editor citation insert', requiredFor: 'execution' },
      };
    }
    // Fall back to chat for reader selections
    return {
      recipeId: 'builtin:insert-citation-sentence',
      target: { type: 'chat-message' },
      steps: [
        { kind: 'retrieve', query: sel?.kind === 'reader'
          ? (sel as { selectedText: string }).selectedText
          : op.prompt, source: 'rag' },
        { kind: 'llm_generate', mode: 'draft' },
      ],
      confirmation: { mode: 'auto', reason: 'Citation draft to chat', requiredFor: 'execution' },
    };
  },
};

// ─── Draft Citation Recipe ───

export const draftCitationRecipe: OperationRecipe = {
  id: 'builtin:draft-citation',
  intents: ['draft-citation'],
  priority: 8,
  specificity: 7,
  matches: (op) => op.intent === 'draft-citation',
  buildPlan: async (op, ctx) => {
    const sel = ctx.selection;
    // When an editor selection is available, target editor insert-after
    if (sel?.kind === 'editor') {
      return {
        recipeId: 'builtin:draft-citation',
        target: {
          type: 'editor-insert-after',
          editorId: 'main',
          articleId: sel.articleId,
          sectionId: sel.sectionId,
          pos: sel.to,
        },
        steps: [
          { kind: 'retrieve', query: op.prompt, source: 'rag' },
          { kind: 'llm_generate', mode: 'draft' },
          { kind: 'apply_patch', patchTarget: {
            type: 'editor-insert-after',
            editorId: 'main',
            articleId: sel.articleId,
            sectionId: sel.sectionId,
            pos: sel.to,
          }},
        ],
        confirmation: { mode: 'preview', reason: 'Editor citation draft', requiredFor: 'execution' },
      };
    }
    return {
      recipeId: 'builtin:draft-citation',
      target: { type: 'chat-message' },
      steps: [
        { kind: 'retrieve', query: op.prompt, source: 'rag' },
        { kind: 'llm_generate', mode: 'chat' },
      ],
      confirmation: { mode: 'auto', reason: 'Citation to chat', requiredFor: 'execution' },
    };
  },
};

// ─── Summarize Selection Recipe ───

export const summarizeSelectionRecipe: OperationRecipe = {
  id: 'builtin:summarize-selection',
  intents: ['summarize-selection'],
  priority: 7,
  specificity: 6,
  matches: (op) => op.intent === 'summarize-selection',
  buildPlan: async () => ({
    recipeId: 'builtin:summarize-selection',
    target: { type: 'chat-message' },
    steps: [{ kind: 'llm_generate', mode: 'chat' }],
    confirmation: { mode: 'auto', reason: 'Summary to chat', requiredFor: 'execution' },
  }),
};

// ─── Summarize Section Recipe ───

export const summarizeSectionRecipe: OperationRecipe = {
  id: 'builtin:summarize-section',
  intents: ['summarize-section'],
  priority: 7,
  specificity: 6,
  matches: (op) => op.intent === 'summarize-section',
  buildPlan: async () => ({
    recipeId: 'builtin:summarize-section',
    target: { type: 'chat-message' },
    steps: [{ kind: 'llm_generate', mode: 'chat' }],
    confirmation: { mode: 'auto', reason: 'Summary to chat', requiredFor: 'execution' },
  }),
};

// ─── Review Argument Recipe ───

export const reviewArgumentRecipe: OperationRecipe = {
  id: 'builtin:review-argument',
  intents: ['review-argument'],
  priority: 7,
  specificity: 6,
  matches: (op) => op.intent === 'review-argument',
  buildPlan: async (op) => ({
    recipeId: 'builtin:review-argument',
    target: { type: 'chat-message' },
    steps: [
      { kind: 'retrieve', query: op.prompt, source: 'rag' },
      { kind: 'llm_generate', mode: 'chat' },
    ],
    confirmation: { mode: 'auto', reason: 'Review to chat', requiredFor: 'execution' },
  }),
};

// ─── Retrieve Evidence Recipe ───

export const retrieveEvidenceRecipe: OperationRecipe = {
  id: 'builtin:retrieve-evidence',
  intents: ['retrieve-evidence'],
  priority: 7,
  specificity: 5,
  matches: (op) => op.intent === 'retrieve-evidence',
  buildPlan: async (op) => ({
    recipeId: 'builtin:retrieve-evidence',
    target: { type: 'chat-message' },
    steps: [
      { kind: 'retrieve', query: op.prompt, source: 'rag' },
      { kind: 'llm_generate', mode: 'chat' },
    ],
    confirmation: { mode: 'auto', reason: 'Retrieval to chat', requiredFor: 'execution' },
  }),
};

// ─── Navigate Recipe ───

export const navigateRecipe: OperationRecipe = {
  id: 'builtin:navigate',
  intents: ['navigate'],
  priority: 5,
  specificity: 3,
  matches: (op) => op.intent === 'navigate',
  buildPlan: async (op) => {
    const target = op.outputTarget;
    const view = target.type === 'navigate'
      ? (target as { view: import('../shared-types/enums').ViewType }).view
      : 'library' as import('../shared-types/enums').ViewType;
    const entityId = target.type === 'navigate'
      ? (target as { entityId?: string }).entityId
      : undefined;

    return {
      recipeId: 'builtin:navigate',
      target: target.type === 'navigate'
        ? target
        : { type: 'navigate', view: 'library' as import('../shared-types/enums').ViewType },
      steps: [
        {
          kind: 'navigate' as const,
          view,
          ...(entityId != null ? { entityId } : {}),
        },
      ],
      confirmation: { mode: 'auto', reason: 'Navigation', requiredFor: 'execution' },
    };
  },
};

// ─── Run Workflow Recipe ───

export const runWorkflowRecipe: OperationRecipe = {
  id: 'builtin:run-workflow',
  intents: ['run-workflow'],
  priority: 5,
  specificity: 3,
  matches: (op) => op.intent === 'run-workflow',
  buildPlan: async (op) => {
    const target = op.outputTarget;
    const workflow = target.type === 'workflow'
      ? (target as { workflow: import('../shared-types/enums').WorkflowType }).workflow
      : 'discover' as import('../shared-types/enums').WorkflowType;
    const config = target.type === 'workflow'
      ? (target as { config?: Record<string, unknown> }).config
      : undefined;

    return {
      recipeId: 'builtin:run-workflow',
      target: op.outputTarget,
      steps: [
        {
          kind: 'run_workflow' as const,
          workflow,
          ...(config ? { config } : {}),
        },
      ],
      confirmation: { mode: 'explicit', reason: 'Workflow execution', requiredFor: 'destructive-mutation' },
    };
  },
};

// ─── All built-in recipes ───

export const builtinRecipes: OperationRecipe[] = [
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
];
