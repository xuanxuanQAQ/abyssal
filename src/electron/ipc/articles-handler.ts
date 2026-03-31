/**
 * IPC handler: articles namespace
 *
 * Contract channels: db:articles:*
 * Maps frontend ArticleOutline/SectionNode/SectionContent models
 * to backend Article/OutlineEntry/SectionDraft DAO types.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asArticleId, asOutlineEntryId } from '../../core/types/common';
import type { Article, OutlineEntry, SectionDraft } from '../../core/types/article';
import type {
  ArticleOutline, SectionNode, SectionContent, SectionVersion,
  SectionOrder,
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
    metadata: {},
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
    aiModel: null,
    children: [],
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
    content: draft?.content ?? '',
    version: draft?.version ?? 1,
    citedPaperIds: draft?.citedPaperIds ?? [],
  };
}

function draftToSectionVersion(draft: SectionDraft): SectionVersion {
  return {
    version: draft.version,
    content: draft.content,
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
    const updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status'>> = {};
    if (patch.title != null) updates.title = patch.title;
    if (patch.citationStyle != null) updates.cslStyleId = mapFrontendToCsl(patch.citationStyle);
    await ctx.dbProxy.updateArticle(asArticleId(articleId), updates);
    ctx.pushManager?.enqueueDbChange(['articles'], 'update');
  });

  // ── db:articles:getOutline ──
  typedHandler('db:articles:getOutline', logger, async (_e, articleId) => {
    const article = await ctx.dbProxy.getArticle(asArticleId(articleId));
    if (!article) {
      throw new Error('Article not found');
    }
    const entries = await ctx.dbProxy.getOutline(asArticleId(articleId));
    const sections = buildSectionTree(entries);
    return articleToOutline(article, sections);
  });

  // ── db:articles:updateOutlineOrder ──
  typedHandler('db:articles:updateOutlineOrder', logger, async (_e, articleId, order) => {
    // Update sortOrder, parentId, and compute depth for each entry
    for (const o of order as SectionOrder[]) {
      // Compute depth from parent chain
      let depth = 0;
      let parentId = o.parentId;
      const orderMap = new Map((order as SectionOrder[]).map((x) => [x.sectionId, x]));
      while (parentId) {
        depth++;
        const parent = orderMap.get(parentId);
        parentId = parent?.parentId ?? null;
      }

      await ctx.dbProxy.updateOutlineEntry(
        asOutlineEntryId(o.sectionId),
        { sortOrder: o.sortIndex, depth } as any,
      );
    }
    ctx.pushManager?.enqueueDbChange(['outlines'], 'update');
  });

  // ── db:articles:getSection ──
  typedHandler('db:articles:getSection', logger, async (_e, sectionId) => {
    const drafts = await ctx.dbProxy.getSectionDrafts(asOutlineEntryId(sectionId));
    const latest = drafts[0] ?? null; // sorted by version DESC
    return draftToSectionContent(sectionId, latest);
  });

  // ── db:articles:updateSection ──
  typedHandler('db:articles:updateSection', logger, async (_e, sectionId, patch) => {
    const entryId = asOutlineEntryId(sectionId);

    if (patch.content != null) {
      await ctx.dbProxy.addSectionDraft(entryId, patch.content, 'manual');
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
    const existing = await ctx.dbProxy.getOutline(asArticleId(articleId));

    // Compute depth from parent chain
    let depth = 0;
    if (parentId) {
      const parentEntry = existing.find((e) => e.id === parentId);
      depth = parentEntry ? ((parentEntry as any).depth ?? 0) + 1 : 1;
    }

    const newEntry: OutlineEntry = {
      id: asOutlineEntryId(id),
      articleId: asArticleId(articleId),
      parentId: parentId ? asOutlineEntryId(parentId) : null,
      depth,
      sortOrder: sortIndex,
      title: title ?? '新节',
      coreArgument: null,
      writingInstruction: null,
      conceptIds: [],
      paperIds: [],
      status: 'pending',
    };
    await ctx.dbProxy.setOutline(asArticleId(articleId), [...existing, newEntry]);
    ctx.pushManager?.enqueueDbChange(['outlines'], 'insert');

    return {
      id,
      title: newEntry.title,
      parentId,
      sortIndex,
      status: 'pending' as const,
      wordCount: 0,
      writingInstructions: null,
      aiModel: null,
      children: [],
    } satisfies SectionNode;
  });

  // ── db:articles:deleteSection ──
  typedHandler('db:articles:deleteSection', logger, async (_e, sectionId) => {
    await ctx.dbProxy.markOutlineEntryDeleted(asOutlineEntryId(sectionId));
    ctx.pushManager?.enqueueDbChange(['outlines'], 'delete');
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
