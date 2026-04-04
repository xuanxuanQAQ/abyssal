/**
 * IPC handler: articles namespace
 *
 * Contract channels: db:articles:*
 * Maps frontend ArticleOutline/SectionNode/SectionContent models
 * to backend Article/OutlineEntry/SectionDraft DAO types.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asArticleId, asDraftId, asOutlineEntryId } from '../../core/types/common';
import type { Article, Draft, OutlineEntry, SectionDraft } from '../../core/types/article';
import {
  deleteSectionFromDocument,
  insertSectionInDocument,
  parseArticleDocument,
  renameSectionInDocument,
  reorderSectionsInDocument,
} from '../../shared/writing/documentOutline';
import type {
  ArticleOutline, DraftOutline, DraftSummary, SectionNode, SectionContent, SectionVersion,
  SectionOrder, ArticleAuthorInfo,
} from '../../shared-types/models';
import type { CitationStyle } from '../../shared-types/enums';
import type { SectionSearchResult } from '../../shared-types/ipc';

// ── Type-safe mapping helpers ──

function articleToOutline(a: Article, sections: SectionNode[]): ArticleOutline {
  return {
    id: a.id,
    title: a.title ?? 'Untitled',
    citationStyle: mapCslToFrontend(a.cslStyleId ?? 'gb-t-7714'),
    exportFormat: 'markdown',
    metadata: {
      writingStyle: a.style ?? undefined,
      abstract: a.abstract ?? undefined,
      keywords: a.keywords?.length ? a.keywords : undefined,
      authors: a.authors?.length
        ? a.authors.map((au): ArticleAuthorInfo => {
            const info: ArticleAuthorInfo = { name: au.name };
            if (au.affiliation) info.affiliation = au.affiliation;
            if (au.email) info.email = au.email;
            if (au.isCorresponding != null) info.isCorresponding = au.isCorresponding;
            return info;
          })
        : undefined,
      targetWordCount: a.targetWordCount ?? undefined,
    },
    createdAt: a.createdAt ?? new Date().toISOString(),
    updatedAt: a.updatedAt ?? new Date().toISOString(),
    sections,
  };
}

function outlineEntryToSectionNode(e: OutlineEntry): SectionNode {
  return {
    id: e.id,
    title: e.title ?? '',
    parentId: (e as any).parentId ?? null,
    sortIndex: e.sortOrder ?? 0,
    status: e.status ?? 'pending',
    wordCount: 0,
    writingInstructions: e.writingInstruction ?? null,
    conceptIds: e.conceptIds ?? [],
    paperIds: e.paperIds ?? [],
    aiModel: null,
    children: [],
  };
}

function draftToSummary(draft: Draft): DraftSummary {
  return {
    id: draft.id,
    articleId: draft.articleId,
    title: draft.title,
    status: draft.status,
    metadata: {
      abstract: draft.abstract ?? undefined,
      keywords: draft.keywords?.length ? draft.keywords : undefined,
      writingStyle: draft.writingStyle ?? undefined,
      targetWordCount: draft.targetWordCount ?? undefined,
      citationStyle: mapCslToFrontend(draft.cslStyleId ?? 'gb-t-7714'),
      language: draft.language ?? undefined,
      audience: draft.audience ?? undefined,
    },
    basedOnDraftId: draft.basedOnDraftId ?? undefined,
    source: draft.source,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    lastOpenedAt: draft.lastOpenedAt ?? undefined,
  };
}

function draftSectionToNode(section: {
  sectionId: string;
  title: string;
  parentId: string | null;
  sortIndex: number;
  status: string;
  wordCount: number;
  writingInstruction: string | null;
  conceptIds: string[];
  paperIds: string[];
  aiModel: string | null;
  evidenceStatus: string | null;
  evidenceGaps: string[];
}): SectionNode {
  return {
    id: section.sectionId,
    title: section.title,
    parentId: section.parentId,
    sortIndex: section.sortIndex,
    status: section.status as SectionNode['status'],
    wordCount: section.wordCount,
    writingInstructions: section.writingInstruction,
    conceptIds: section.conceptIds,
    paperIds: section.paperIds,
    aiModel: section.aiModel,
    evidenceStatus: section.evidenceStatus as SectionNode['evidenceStatus'],
    evidenceGaps: section.evidenceGaps,
    children: [],
  };
}

function buildSectionTreeFromDraftSections(sections: Array<Parameters<typeof draftSectionToNode>[0]>): SectionNode[] {
  const nodeMap = new Map<string, SectionNode>();
  const roots: SectionNode[] = [];

  for (const section of sections) {
    nodeMap.set(section.sectionId, draftSectionToNode(section));
  }

  for (const section of sections) {
    const node = nodeMap.get(section.sectionId)!;
    if (section.parentId && nodeMap.has(section.parentId)) {
      nodeMap.get(section.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: SectionNode[]) => {
    nodes.sort((left, right) => left.sortIndex - right.sortIndex);
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

function draftAndSectionsToOutline(draft: Draft, sections: Array<Parameters<typeof draftSectionToNode>[0]>): DraftOutline {
  return {
    ...draftToSummary(draft),
    sections: buildSectionTreeFromDraftSections(sections),
  };
}

/**
 * Reconstruct a hierarchical SectionNode[] tree from flat OutlineEntry[].
 * Uses parentId to build parent-child relationships.
 */
function buildSectionTree(entries: OutlineEntry[]): SectionNode[] {
  const nodeMap = new Map<string, SectionNode>();
  const roots: SectionNode[] = [];

  // First pass: create all nodes
  for (const entry of entries) {
    nodeMap.set(entry.id, outlineEntryToSectionNode(entry));
  }

  // Second pass: wire parent-child relationships
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    const parentId = (entry as any).parentId as string | null;
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children at each level by sortIndex
  function sortChildren(nodes: SectionNode[]): void {
    nodes.sort((a, b) => a.sortIndex - b.sortIndex);
    for (const node of nodes) {
      if (node.children.length > 0) sortChildren(node.children);
    }
  }
  sortChildren(roots);

  return roots;
}

function draftToSectionContent(sectionId: string, draft: SectionDraft | null): SectionContent {
  return {
    id: sectionId,
    outlineId: draft?.outlineEntryId ?? '',
    articleId: undefined,
    title: undefined,
    content: draft?.content ?? '',
    documentJson: draft?.documentJson ?? null,
    version: draft?.version ?? 1,
    citedPaperIds: draft?.citedPaperIds ?? [],
  };
}

function draftToSectionVersion(draft: SectionDraft): SectionVersion {
  return {
    sectionId: draft.outlineEntryId,
    version: draft.version,
    content: draft.content,
    documentJson: draft.documentJson ?? null,
    createdAt: draft.createdAt ?? '',
    source: draft.llmBackend === 'manual' ? 'manual' : 'ai-generate',
  };
}

function mapCslToFrontend(cslId: string): CitationStyle {
  const map: Record<string, CitationStyle> = {
    'gb-t-7714': 'GB/T 7714',
    'apa': 'APA',
    'ieee': 'IEEE',
    'chicago': 'Chicago',
  };
  return map[cslId] ?? 'GB/T 7714';
}

function mapFrontendToCsl(frontendStyle: string): string {
  const map: Record<string, string> = {
    'GB/T 7714': 'gb-t-7714',
    'APA': 'apa',
    'IEEE': 'ieee',
    'Chicago': 'chicago',
  };
  return map[frontendStyle] ?? frontendStyle;
}

// ── Handler registration ──

export function registerArticlesHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── db:articles:listOutlines ──
  typedHandler('db:articles:listOutlines', logger, async () => {
    const articles = await ctx.dbProxy.getAllArticles();
    return articles.map((a) => articleToOutline(a, []));
  });

  typedHandler('db:drafts:listByArticle', logger, async (_e, articleId) => {
    const drafts = await ctx.dbProxy.listDraftsByArticle(asArticleId(articleId));
    return drafts.map(draftToSummary);
  });

  typedHandler('db:drafts:get', logger, async (_e, draftId) => {
    const draft = await ctx.dbProxy.getDraft(asDraftId(draftId));
    return draft ? draftToSummary(draft) : null;
  });

  typedHandler('db:drafts:create', logger, async (_e, articleId, seed) => {
    const article = await ctx.dbProxy.getArticle(asArticleId(articleId));
    if (!article) throw new Error('Article not found');

    const basedOnDraftId = seed?.basedOnDraftId ?? article.defaultDraftId ?? null;
    const baseDraft = basedOnDraftId ? await ctx.dbProxy.getDraft(asDraftId(basedOnDraftId)) : null;
    const id = asDraftId(crypto.randomUUID());

    await ctx.dbProxy.createDraft({
      id,
      articleId: asArticleId(articleId),
      title: seed?.title ?? `稿件 ${new Date().toLocaleString('zh-CN')}`,
      status: seed?.status ?? 'drafting',
      documentJson: baseDraft?.documentJson ?? article.documentJson ?? '{"type":"doc","content":[{"type":"paragraph"}]}',
      basedOnDraftId: basedOnDraftId ? asDraftId(basedOnDraftId) : null,
      source: seed?.source ?? (basedOnDraftId ? 'duplicate' : 'manual'),
      language: seed?.metadata?.language ?? baseDraft?.language ?? article.outputLanguage ?? null,
      audience: seed?.metadata?.audience ?? baseDraft?.audience ?? null,
      writingStyle: seed?.metadata?.writingStyle ?? baseDraft?.writingStyle ?? article.style ?? null,
      cslStyleId: seed?.metadata?.citationStyle ? mapFrontendToCsl(seed.metadata.citationStyle) : (baseDraft?.cslStyleId ?? article.cslStyleId ?? null),
      abstract: seed?.metadata?.abstract ?? baseDraft?.abstract ?? article.abstract ?? null,
      keywords: seed?.metadata?.keywords ?? baseDraft?.keywords ?? article.keywords ?? [],
      targetWordCount: seed?.metadata?.targetWordCount ?? baseDraft?.targetWordCount ?? article.targetWordCount ?? null,
      lastOpenedAt: seed?.lastOpenedAt ?? null,
    });

    const created = await ctx.dbProxy.getDraft(id);
    if (!created) throw new Error('Failed to create draft');
    ctx.pushManager?.enqueueDbChange(['article_drafts'], 'insert');
    return draftToSummary(created);
  });

  typedHandler('db:drafts:update', logger, async (_e, draftId, patch) => {
    const updates: Record<string, unknown> = {};
    if (patch.title !== undefined) updates['title'] = patch.title;
    if (patch.status !== undefined) updates['status'] = patch.status;
    if (patch.lastOpenedAt !== undefined) updates['lastOpenedAt'] = patch.lastOpenedAt;
    if (patch.metadata) {
      if (patch.metadata.abstract !== undefined) updates['abstract'] = patch.metadata.abstract;
      if (patch.metadata.keywords !== undefined) updates['keywords'] = patch.metadata.keywords;
      if (patch.metadata.writingStyle !== undefined) updates['writingStyle'] = patch.metadata.writingStyle;
      if (patch.metadata.targetWordCount !== undefined) updates['targetWordCount'] = patch.metadata.targetWordCount;
      if (patch.metadata.language !== undefined) updates['language'] = patch.metadata.language;
      if (patch.metadata.audience !== undefined) updates['audience'] = patch.metadata.audience;
      if (patch.metadata.citationStyle !== undefined) updates['cslStyleId'] = mapFrontendToCsl(patch.metadata.citationStyle);
    }
    await ctx.dbProxy.updateDraft(asDraftId(draftId), updates as any);
    ctx.pushManager?.enqueueDbChange(['article_drafts'], 'update');
  });

  typedHandler('db:drafts:delete', logger, async (_e, draftId) => {
    await ctx.dbProxy.deleteDraft(asDraftId(draftId));
    ctx.pushManager?.enqueueDbChange(['article_drafts'], 'delete');
  });

  typedHandler('db:drafts:getDocument', logger, async (_e, draftId) => {
    return await ctx.dbProxy.getDraftDocument(asDraftId(draftId));
  });

  typedHandler('db:drafts:saveDocument', logger, async (_e, draftId, documentJson, source = 'manual') => {
    await ctx.dbProxy.saveDraftDocument(asDraftId(draftId), documentJson, source);
    ctx.pushManager?.enqueueDbChange(['article_drafts', 'draft_versions'], 'update');
  });

  typedHandler('db:drafts:getOutline', logger, async (_e, draftId) => {
    const draft = await ctx.dbProxy.getDraft(asDraftId(draftId));
    if (!draft) throw new Error('Draft not found');
    const sections = await ctx.dbProxy.getDraftSections(asDraftId(draftId));
    return draftAndSectionsToOutline(draft, sections);
  });

  typedHandler('db:drafts:updateOutlineOrder', logger, async (_e, draftId, order) => {
    const current = await ctx.dbProxy.getDraftDocument(asDraftId(draftId));
    const reordered = reorderSectionsInDocument(
      parseArticleDocument(current.documentJson),
      order as SectionOrder[],
    );
    await ctx.dbProxy.saveDraftDocument(asDraftId(draftId), JSON.stringify(reordered), 'manual');
    ctx.pushManager?.enqueueDbChange(['article_drafts', 'draft_versions'], 'update');
  });

  typedHandler('db:drafts:updateSection', logger, async (_e, draftId, sectionId, patch) => {
    if (patch.content != null || patch.documentJson !== undefined) {
      await ctx.dbProxy.updateDraftSectionContent(
        asDraftId(draftId),
        sectionId,
        patch.content ?? '',
        patch.documentJson ?? null,
        'manual',
      );
    }

    if (patch.title != null) {
      const current = await ctx.dbProxy.getDraftDocument(asDraftId(draftId));
      const renamed = renameSectionInDocument(parseArticleDocument(current.documentJson), sectionId, patch.title);
      await ctx.dbProxy.saveDraftDocument(asDraftId(draftId), JSON.stringify(renamed), 'manual');
    }

    const metaPatch: Record<string, unknown> = {};
    if (patch.status !== undefined) metaPatch['status'] = patch.status;
    if (patch.writingInstructions !== undefined) metaPatch['writingInstruction'] = patch.writingInstructions;
    if (patch.aiModel !== undefined) metaPatch['aiModel'] = patch.aiModel;
    if (patch.evidenceStatus !== undefined) metaPatch['evidenceStatus'] = patch.evidenceStatus;
    if (patch.evidenceGaps !== undefined) metaPatch['evidenceGaps'] = patch.evidenceGaps;
    if (Object.keys(metaPatch).length > 0) {
      await ctx.dbProxy.updateDraftSectionMeta(asDraftId(draftId), sectionId, metaPatch as any);
    }

    ctx.pushManager?.enqueueDbChange(['draft_section_meta', 'draft_versions'], 'update');
  });

  typedHandler('db:drafts:createSection', logger, async (_e, draftId, parentId, sortIndex, title) => {
    const id = crypto.randomUUID();
    const current = await ctx.dbProxy.getDraftDocument(asDraftId(draftId));
    const nextDocument = insertSectionInDocument(parseArticleDocument(current.documentJson), {
      parentId,
      sortIndex,
      title: title ?? '新节',
      idFactory: () => id,
    });
    await ctx.dbProxy.saveDraftDocument(asDraftId(draftId), JSON.stringify(nextDocument), 'manual');
    const sections = await ctx.dbProxy.getDraftSections(asDraftId(draftId));
    const created = sections.find((section) => section.sectionId === id);
    ctx.pushManager?.enqueueDbChange(['draft_section_meta', 'draft_versions'], 'insert');
    return draftSectionToNode(created ?? {
      sectionId: id,
      title: title ?? '新节',
      parentId,
      sortIndex,
      status: 'pending',
      wordCount: 0,
      writingInstruction: null,
      conceptIds: [],
      paperIds: [],
      aiModel: null,
      evidenceStatus: null,
      evidenceGaps: [],
    });
  });

  typedHandler('db:drafts:deleteSection', logger, async (_e, draftId, sectionId) => {
    const current = await ctx.dbProxy.getDraftDocument(asDraftId(draftId));
    const nextDocument = deleteSectionFromDocument(parseArticleDocument(current.documentJson), sectionId);
    await ctx.dbProxy.saveDraftDocument(asDraftId(draftId), JSON.stringify(nextDocument), 'manual');
    ctx.pushManager?.enqueueDbChange(['draft_section_meta', 'draft_versions'], 'delete');
  });

  typedHandler('db:drafts:getVersions', logger, async (_e, draftId) => {
    const versions = await ctx.dbProxy.getDraftVersions(asDraftId(draftId));
    return versions.map((version) => ({
      draftId: version.draftId,
      version: version.version,
      title: version.title,
      content: version.content,
      documentJson: version.documentJson,
      createdAt: version.createdAt,
      source: version.source,
      summary: version.summary ?? undefined,
    }));
  });

  typedHandler('db:drafts:restoreVersion', logger, async (_e, draftId, version) => {
    await ctx.dbProxy.restoreDraftVersion(asDraftId(draftId), version);
    ctx.pushManager?.enqueueDbChange(['draft_versions'], 'update');
  });

  typedHandler('db:drafts:createFromVersion', logger, async (_e, draftId, version, title) => {
    const nextDraftId = await ctx.dbProxy.createDraftFromVersion(asDraftId(draftId), version, title);
    const created = await ctx.dbProxy.getDraft(nextDraftId);
    if (!created) throw new Error('Failed to create draft from version');
    ctx.pushManager?.enqueueDbChange(['article_drafts', 'draft_versions'], 'insert');
    return draftToSummary(created);
  });

  // ── db:articles:create ──
  typedHandler('db:articles:create', logger, async (_e, title) => {
    const id = crypto.randomUUID();
    await ctx.dbProxy.createArticle({
      id: asArticleId(id),
      title,
      style: 'formal_paper',
      cslStyleId: ctx.config.writing?.defaultCslStyleId ?? 'gb-t-7714',
      outputLanguage: ctx.config.writing?.defaultOutputLanguage ?? 'zh',
      status: 'drafting',
      abstract: null,
      authors: [],
      keywords: [],
      targetWordCount: null,
    });
    ctx.pushManager?.enqueueDbChange(['articles'], 'insert');

    const now = new Date().toISOString();
    return {
      id,
      title,
      citationStyle: mapCslToFrontend(ctx.config.writing?.defaultCslStyleId ?? 'gb-t-7714'),
      exportFormat: 'markdown' as const,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      sections: [],
    } satisfies ArticleOutline;
  });

  // ── db:articles:update ──
  typedHandler('db:articles:update', logger, async (_e, articleId, patch) => {
    logger.info('[OutlineDebug] db:articles:update', { articleId, patchKeys: Object.keys(patch) });
    const updates: Record<string, unknown> = {};
    if (patch.title != null) updates.title = patch.title;
    if (patch.citationStyle != null) updates.cslStyleId = mapFrontendToCsl(patch.citationStyle);
    // Handle metadata fields (writingStyle, abstract, keywords, authors, targetWordCount)
    const md = (patch as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
    if (md) {
      if (md['writingStyle'] !== undefined) updates['style'] = md['writingStyle'];
      if (md['abstract'] !== undefined) updates['abstract'] = md['abstract'];
      if (md['keywords'] !== undefined) updates['keywords'] = md['keywords'];
      if (md['authors'] !== undefined) updates['authors'] = md['authors'];
      if (md['targetWordCount'] !== undefined) updates['targetWordCount'] = md['targetWordCount'];
    }
    logger.info('[OutlineDebug] db:articles:update resolved updates', { updateKeys: Object.keys(updates) });
    await ctx.dbProxy.updateArticle(asArticleId(articleId), updates as any);
    ctx.pushManager?.enqueueDbChange(['articles'], 'update');
  });

  // ── db:articles:getDocument ──
  typedHandler('db:articles:getDocument', logger, async (_e, articleId) => {
    return await ctx.dbProxy.getArticleDocument(asArticleId(articleId));
  });

  // ── db:articles:saveDocument ──
  typedHandler('db:articles:saveDocument', logger, async (_e, articleId, documentJson, source = 'manual') => {
    await ctx.dbProxy.saveArticleDocument(asArticleId(articleId), documentJson, source);
    ctx.pushManager?.enqueueDbChange(['articles', 'outlines'], 'update');
  });

  // ── db:articles:getOutline ──
  typedHandler('db:articles:getOutline', logger, async (_e, articleId) => {
    const article = await ctx.dbProxy.getArticle(asArticleId(articleId));
    if (!article) {
      throw new Error('Article not found');
    }
    const entries = await ctx.dbProxy.getOutline(asArticleId(articleId));
    const fullDocument = await ctx.dbProxy.getFullDocument(asArticleId(articleId));
    logger.info('[OutlineDebug] db:articles:getOutline', {
      articleId,
      articleTitle: article.title,
      articleStyle: article.style,
      entriesCount: entries.length,
      entryIds: entries.map(e => e.id),
    });
    const sections = buildSectionTree(entries);

    const wordCountMap = new Map<string, number>();
    for (const section of fullDocument) {
      const text = String(section.content ?? '').trim();
      const count = text.length > 0 ? text.split(/\s+/).length : 0;
      wordCountMap.set(section.sectionId, count);
    }

    // Apply word counts to section tree
    function applyWordCounts(nodes: SectionNode[]): void {
      for (const node of nodes) {
        const wc = wordCountMap.get(node.id);
        if (wc !== undefined) (node as any).wordCount = wc;
        applyWordCounts(node.children);
      }
    }
    applyWordCounts(sections);

    return articleToOutline(article, sections);
  });

  // ── db:articles:updateOutlineOrder ──
  typedHandler('db:articles:updateOutlineOrder', logger, async (_e, articleId, order) => {
    const current = await ctx.dbProxy.getArticleDocument(asArticleId(articleId));
    const reordered = reorderSectionsInDocument(
      parseArticleDocument(current.documentJson),
      order as SectionOrder[],
    );
    await ctx.dbProxy.saveArticleDocument(
      asArticleId(articleId),
      JSON.stringify(reordered),
      'manual',
    );
    ctx.pushManager?.enqueueDbChange(['articles', 'outlines'], 'update');
  });

  // ── db:articles:getSection ──
  typedHandler('db:articles:getSection', logger, async (_e, sectionId) => {
    const drafts = await ctx.dbProxy.getSectionDrafts(asOutlineEntryId(sectionId));
    const latest = drafts[0] ?? null; // sorted by version DESC
    if (latest) {
      const base = draftToSectionContent(sectionId, latest);
      return base;
    }

    const articles = await ctx.dbProxy.getAllArticles();
    for (const article of articles) {
      const sections = await ctx.dbProxy.getFullDocument(asArticleId(article.id));
      const match = sections.find((section) => section.sectionId === sectionId);
      if (!match) continue;
      return {
        id: sectionId,
        outlineId: sectionId,
        articleId: article.id,
        title: match.title,
        content: match.content,
        documentJson: match.documentJson,
        version: match.version,
        citedPaperIds: [],
      } satisfies SectionContent;
    }

    return draftToSectionContent(sectionId, null);
  });

  // ── db:articles:updateSection ──
  typedHandler('db:articles:updateSection', logger, async (_e, sectionId, patch) => {
    const entryId = asOutlineEntryId(sectionId);

    if (patch.content != null || patch.documentJson !== undefined) {
      await ctx.dbProxy.addSectionDraft(
        entryId,
        patch.content ?? '',
        'manual',
        'manual',
        patch.documentJson ?? null,
      );
    }
    // Update outline entry fields if provided
    const entryUpdates: Record<string, unknown> = {};
    if (patch.title != null) entryUpdates['title'] = patch.title;
    if (patch.status != null) entryUpdates['status'] = patch.status;
    if (patch.writingInstructions !== undefined) entryUpdates['writingInstruction'] = patch.writingInstructions;
    if (Object.keys(entryUpdates).length > 0) {
      await ctx.dbProxy.updateOutlineEntry(entryId, entryUpdates as Partial<Pick<OutlineEntry, 'title' | 'status' | 'writingInstruction'>>);
    }

    ctx.pushManager?.enqueueDbChange(['section_drafts'], 'update');
  });

  // ── db:articles:getSectionVersions ──
  typedHandler('db:articles:getSectionVersions', logger, async (_e, sectionId) => {
    const drafts = await ctx.dbProxy.getSectionDrafts(asOutlineEntryId(sectionId));
    return drafts.map(draftToSectionVersion);
  });

  // ── db:articles:search ──
  typedHandler('db:articles:search', logger, async (_e, query) => {
    const results = await ctx.dbProxy.searchSections(query);
    return results.map((r): SectionSearchResult => ({
      sectionId: r.outlineEntryId,
      articleId: r.articleId,
      title: r.title,
      snippet: r.snippet,
    }));
  });

  // ── db:articles:createSection ──
  typedHandler('db:articles:createSection', logger, async (_e, articleId, parentId, sortIndex, title) => {
    const id = crypto.randomUUID();
    const current = await ctx.dbProxy.getArticleDocument(asArticleId(articleId));
    const nextDocument = insertSectionInDocument(parseArticleDocument(current.documentJson), {
      parentId,
      sortIndex,
      title: title ?? '新节',
      idFactory: () => id,
    });
    await ctx.dbProxy.saveArticleDocument(asArticleId(articleId), JSON.stringify(nextDocument), 'manual');
    const entries = await ctx.dbProxy.getOutline(asArticleId(articleId));
    const newEntry = entries.find((entry) => entry.id === id);
    ctx.pushManager?.enqueueDbChange(['articles', 'outlines'], 'insert');

    return {
      id,
      title: newEntry?.title ?? title ?? '新节',
      parentId,
      sortIndex: newEntry?.sortOrder ?? sortIndex,
      status: newEntry?.status ?? 'pending',
      wordCount: 0,
      writingInstructions: newEntry?.writingInstruction ?? null,
      aiModel: null,
      children: [],
    } satisfies SectionNode;
  });

  // ── db:articles:deleteSection ──
  typedHandler('db:articles:deleteSection', logger, async (_e, sectionId) => {
    await ctx.dbProxy.markOutlineEntryDeleted(asOutlineEntryId(sectionId));
    ctx.pushManager?.enqueueDbChange(['articles', 'outlines'], 'delete');
  });

  // ── db:articles:getFullDocument ──
  typedHandler('db:articles:getFullDocument', logger, async (_e, articleId) => {
    const sections = await ctx.dbProxy.getFullDocument(asArticleId(articleId));
    return {
      articleId,
      sections: (sections as any[]).map((s: Record<string, unknown>) => ({
        sectionId: String(s['sectionId'] ?? s['section_id'] ?? ''),
        title: String(s['title'] ?? ''),
        content: String(s['content'] ?? ''),
        documentJson: (s['documentJson'] ?? s['document_json'] ?? null) as string | null,
        version: Number(s['version'] ?? 0),
        sortIndex: Number(s['sortIndex'] ?? s['sort_index'] ?? 0),
        parentId: (s['parentId'] ?? s['parent_id'] ?? null) as string | null,
        depth: Number(s['depth'] ?? 0),
      })),
    };
  });

  // ── db:articles:saveDocumentSections ──
  typedHandler('db:articles:saveDocumentSections', logger, async (_e, articleId, sections) => {
    await ctx.dbProxy.saveDocumentSections(asArticleId(articleId), sections as any);
    ctx.pushManager?.enqueueDbChange(['section_drafts'], 'update');
  });

  // ── db:articles:updateMetadata ──
  typedHandler('db:articles:updateMetadata', logger, async (_e, articleId, metadata) => {
    const md = metadata as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (md['abstract'] !== undefined) updates['abstract'] = md['abstract'];
    if (md['keywords'] !== undefined) updates['keywords'] = md['keywords'];
    if (md['authors'] !== undefined) updates['authors'] = md['authors'];
    if (md['targetWordCount'] !== undefined) updates['targetWordCount'] = md['targetWordCount'];
    if (md['writingStyle'] !== undefined) updates['style'] = md['writingStyle'];
    await ctx.dbProxy.updateArticle(asArticleId(articleId), updates as any);
    ctx.pushManager?.enqueueDbChange(['articles'], 'update');
  });

  // ── db:articles:cleanupVersions ──
  typedHandler('db:articles:cleanupVersions', logger, async (_e, articleId, keepCount) => {
    const deleted = await ctx.dbProxy.cleanupVersions(asArticleId(articleId), keepCount);
    return { deleted: deleted as number };
  });

  // ── db:articles:getAllCitedPaperIds ──
  typedHandler('db:articles:getAllCitedPaperIds', logger, async () => {
    const articles = await ctx.dbProxy.getAllArticles();
    const allCitedIds = new Set<string>();
    for (const article of articles) {
      const entries = await ctx.dbProxy.getOutline(asArticleId(article.id));
      for (const entry of entries) {
        const drafts = await ctx.dbProxy.getSectionDrafts(asOutlineEntryId(entry.id));
        const latest = drafts[0] ?? null;
        if (latest?.citedPaperIds) {
          for (const id of latest.citedPaperIds) {
            allCitedIds.add(id);
          }
        }
      }
    }
    return [...allCitedIds];
  });

  // ── db:assets:upload ──
  typedHandler('db:assets:upload', logger, async (_e, articleId, fileName, sourcePath) => {
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');

    const assetId = crypto.randomUUID();
    const assetsDir = path.join(ctx.workspaceRoot, 'assets', articleId);
    await fsp.mkdir(assetsDir, { recursive: true });

    const destPath = path.join(assetsDir, `${assetId}_${fileName}`);
    await fsp.copyFile(sourcePath, destPath);
    const stat = await fsp.stat(destPath);

    // Detect MIME type from extension
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
      '.pdf': 'application/pdf',
    };

    const asset = {
      id: assetId,
      articleId,
      fileName,
      mimeType: mimeMap[ext] ?? 'application/octet-stream',
      filePath: destPath,
      fileSize: stat.size,
      caption: null,
      altText: null,
      createdAt: new Date().toISOString(),
    };

    await ctx.dbProxy.addArticleAsset(asset as any);
    return asset;
  });

  // ── db:assets:list ──
  typedHandler('db:assets:list', logger, async (_e, articleId) => {
    return await ctx.dbProxy.getArticleAssets(asArticleId(articleId)) as any;
  });

  // ── db:assets:get ──
  typedHandler('db:assets:get', logger, async (_e, assetId) => {
    return await ctx.dbProxy.getArticleAsset(assetId) as any;
  });

  // ── db:assets:delete ──
  typedHandler('db:assets:delete', logger, async (_e, assetId) => {
    const asset = await ctx.dbProxy.getArticleAsset(assetId) as any;
    if (asset?.filePath) {
      const fsp = await import('node:fs/promises');
      try { await fsp.unlink(asset.filePath); } catch { /* file may not exist */ }
    }
    await ctx.dbProxy.deleteArticleAsset(assetId);
  });
}
