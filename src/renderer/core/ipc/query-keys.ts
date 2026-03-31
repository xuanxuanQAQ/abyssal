/**
 * Query Key Factory — centralized, type-safe query key definitions.
 *
 * All React Query keys should be created via this factory to ensure:
 * - Consistent key structure across the codebase
 * - Correct invalidation cascades (e.g., invalidating ['papers'] clears all paper queries)
 * - Compile-time safety — no typo-prone string literals
 *
 * Pattern: entity.scope(...params) → readonly tuple
 *
 * Invalidation graph:
 *   papers.all() → papers.list() → papers.detail(id) → papers.counts()
 *   concepts.all() → concepts.list() → concepts.detail(id) → concepts.framework()
 *   mappings.all() → mappings.paper(id) → mappings.heatmap()
 *   relations.all() → relations.graph(filter)
 *   suggestions.all() → suggestions.list()
 *   articles.all() → articles.detail(id) → articles.outline(id) → articles.section(id)
 */

export const queryKeys = {
  // ─── Papers ───
  papers: {
    all: () => ['papers'] as const,
    list: (filter?: Record<string, unknown>) =>
      filter ? ['papers', 'list', filter] as const : ['papers', 'list'] as const,
    detail: (id: string) => ['papers', 'detail', id] as const,
    counts: () => ['papers', 'counts'] as const,
  },

  // ─── Concepts ───
  concepts: {
    all: () => ['concepts'] as const,
    list: () => ['concepts', 'list'] as const,
    detail: (id: string) => ['concepts', 'detail', id] as const,
    framework: () => ['concepts', 'framework'] as const,
  },

  // ─── Mappings ───
  mappings: {
    all: () => ['mappings'] as const,
    paper: (paperId: string) => ['mappings', 'paper', paperId] as const,
    concept: (conceptId: string) => ['mappings', 'concept', conceptId] as const,
    heatmap: () => ['mappings', 'heatmap'] as const,
  },

  // ─── Relations ───
  relations: {
    all: () => ['relations'] as const,
    graph: (filterHash?: string) =>
      filterHash ? ['relations', 'graph', filterHash] as const : ['relations', 'graph'] as const,
    paper: (paperId: string) => ['relations', 'paper', paperId] as const,
  },

  // ─── Suggested Concepts ───
  suggestions: {
    all: () => ['suggestedConcepts'] as const,
    list: (status?: string) =>
      status ? ['suggestedConcepts', status] as const : ['suggestedConcepts'] as const,
    stats: () => ['suggestedConcepts', 'stats'] as const,
  },

  // ─── Articles ───
  articles: {
    all: () => ['articles'] as const,
    detail: (id: string) => ['articles', 'detail', id] as const,
    outline: (id: string) => ['articles', 'outline', id] as const,
    section: (entryId: string) => ['articles', 'section', entryId] as const,
    versions: (entryId: string) => ['articles', 'versions', entryId] as const,
  },

  // ─── Annotations ───
  annotations: {
    all: () => ['annotations'] as const,
    paper: (paperId: string) => ['annotations', 'paper', paperId] as const,
  },

  // ─── Tags ───
  tags: {
    all: () => ['tags'] as const,
    list: () => ['tags', 'list'] as const,
  },

  // ─── Chat ───
  chat: {
    all: () => ['chat'] as const,
    sessions: () => ['chat', 'sessions'] as const,
    session: (id: string) => ['chat', 'session', id] as const,
  },

  // ─── System ───
  system: {
    stats: () => ['system', 'stats'] as const,
    costStats: () => ['system', 'costStats'] as const,
    projectInfo: () => ['projectInfo'] as const,
    projects: () => ['projects'] as const,
  },

  // ─── Advisory Notifications ───
  advisoryNotifications: {
    all: () => ['advisoryNotifications'] as const,
  },

  // ─── Memos ───
  memos: {
    all: () => ['memos'] as const,
    entity: (entityType: string, entityId: string) =>
      ['memos', entityType, entityId] as const,
  },
} as const;

/**
 * Invalidation graph: given an entity and event, returns all query keys to invalidate.
 *
 * Usage: `invalidationGraph.onAnalysisComplete(paperId).forEach(key => queryClient.invalidateQueries({ queryKey: key }))`
 */
export const invalidationGraph = {
  onPaperAdded: () => [
    queryKeys.papers.all(),
    queryKeys.system.stats(),
  ],

  onPaperUpdated: (paperId: string) => [
    queryKeys.papers.detail(paperId),
    queryKeys.papers.list(),
    queryKeys.papers.counts(),
  ],

  onAnalysisComplete: (paperId: string) => [
    queryKeys.papers.detail(paperId),
    queryKeys.papers.list(),
    queryKeys.papers.counts(),
    queryKeys.mappings.paper(paperId),
    queryKeys.mappings.heatmap(),
    queryKeys.relations.all(),
    queryKeys.concepts.framework(),
    queryKeys.suggestions.all(),
  ],

  onConceptChanged: (conceptId?: string) => [
    queryKeys.concepts.all(),
    ...(conceptId ? [queryKeys.mappings.concept(conceptId)] : []),
    queryKeys.mappings.heatmap(),
    queryKeys.relations.all(),
  ],

  onSuggestionChanged: () => [
    queryKeys.suggestions.all(),
    queryKeys.concepts.all(),
  ],

  onArticleChanged: (articleId: string) => [
    queryKeys.articles.detail(articleId),
    queryKeys.articles.all(),
  ],

  onDbChanged: () => [
    queryKeys.papers.all(),
    queryKeys.mappings.all(),
    queryKeys.suggestions.all(),
    queryKeys.advisoryNotifications.all(),
  ],
};
