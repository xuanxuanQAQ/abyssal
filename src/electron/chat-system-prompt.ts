import * as path from 'node:path';
import * as fsp from 'node:fs/promises';

import type { AppContext } from './app-context';
import type { ChatContext } from '../shared-types/ipc';
import {
  buildSystemPrompt,
  type ActiveConceptContext,
  type ActivePaperContext,
  type SystemPromptContext,
} from '../adapter/agent-loop/system-prompt-builder';

export async function buildChatSystemPrompt(
  appContext: AppContext,
  chatContext?: ChatContext,
): Promise<string> {
  const promptContext = await buildChatSystemPromptContext(appContext, chatContext);
  return buildSystemPrompt(promptContext);
}

export async function buildChatSystemPromptContext(
  appContext: AppContext,
  chatContext?: ChatContext,
): Promise<SystemPromptContext> {
  const stats = await appContext.getStats();
  const allConcepts = (await appContext.dbProxy.getAllConcepts()) as unknown as Array<Record<string, unknown>>;
  const activeConcepts = allConcepts.filter((concept) => !concept['deprecated']);

  let analyzedPapers = 0;
  let acquiredPapers = 0;
  let memoCount = 0;
  let noteCount = 0;
  try {
    const detailedStats = await appContext.dbProxy.getStats() as unknown as Record<string, unknown>;
    analyzedPapers = (detailedStats['analyzedPapers'] as number) ?? 0;
    acquiredPapers = (detailedStats['acquiredPapers'] as number) ?? 0;
    memoCount = (detailedStats['memoCount'] as number) ?? 0;
    noteCount = (detailedStats['noteCount'] as number) ?? 0;
  } catch {
    // Ignore detailed stats failures and keep aggregate defaults.
  }

  const activePapers = await loadActivePapers(appContext, chatContext);
  const activePaper = activePapers.length === 1 ? activePapers[0] : undefined;
  const activeConcept = await loadActiveConcept(appContext, chatContext);

  return {
    projectName: appContext.configProvider.config.project.name,
    frameworkState: appContext.frameworkState,
    conceptCount: activeConcepts.length,
    tentativeCount: activeConcepts.filter((concept) => concept['maturity'] === 'tentative').length,
    workingCount: activeConcepts.filter((concept) => concept['maturity'] === 'working').length,
    establishedCount: activeConcepts.filter((concept) => concept['maturity'] === 'established').length,
    totalPapers: stats.paperCount,
    analyzedPapers,
    acquiredPapers,
    memoCount,
    noteCount,
    topConcepts: activeConcepts.slice(0, 10).map((concept) => ({
      nameEn: ((concept['nameEn'] ?? concept['name_en']) as string) ?? '',
      maturity: (concept['maturity'] as string) ?? 'working',
      mappedPapers: 0,
    })),
    advisorySuggestions: appContext.advisoryAgent?.getLatestSuggestions() ?? [],
    toolCount: appContext.capabilityRegistry?.operationCount ?? 0,
    ...(activePaper ? { activePaper } : {}),
    ...(activePapers.length > 1 ? { activePapers } : {}),
    ...(activeConcept ? { activeConcept } : {}),
    ...(chatContext?.pdfPage != null ? { pdfPage: chatContext.pdfPage } : {}),
    defaultOutputLanguage: appContext.configProvider.config.language.defaultOutputLanguage,
  };
}

async function loadActivePapers(
  appContext: AppContext,
  chatContext?: ChatContext,
): Promise<ActivePaperContext[]> {
  const selectedPaperIds = chatContext?.selectedPaperIds && chatContext.selectedPaperIds.length > 1
    ? chatContext.selectedPaperIds.slice(0, 8)
    : chatContext?.selectedPaperId
    ? [chatContext.selectedPaperId]
    : [];

  const papers: ActivePaperContext[] = [];
  for (const paperId of selectedPaperIds) {
    try {
      const paper = await appContext.dbProxy.getPaper(paperId as any) as Record<string, unknown> | null;
      if (!paper) continue;

      const mappedConcepts = await loadMappedConcepts(appContext, paperId, 10);
      const analysisSummary = await loadAnalysisSummary(appContext, paperId, paper);

      papers.push({
        id: paperId,
        title: (paper['title'] as string) ?? 'Untitled',
        authors: (paper['authors'] as string) ?? '',
        year: (paper['year'] as number) ?? null,
        abstract: ((paper['abstract'] as string) ?? '').slice(0, chatContext?.selectedPaperIds && chatContext.selectedPaperIds.length > 1 ? 200 : 1500),
        analysisStatus: (paper['analysisStatus'] ?? paper['analysis_status'] ?? 'not_started') as string,
        fulltextStatus: (paper['fulltextStatus'] ?? paper['fulltext_status'] ?? 'not_attempted') as string,
        ...(paper['doi'] ? { doi: paper['doi'] as string } : {}),
        ...(analysisSummary ? { analysisSummary } : {}),
        ...(mappedConcepts.length > 0 ? { mappedConcepts: mappedConcepts.slice(0, chatContext?.selectedPaperIds && chatContext.selectedPaperIds.length > 1 ? 5 : 10) } : {}),
      });
    } catch (err) {
      appContext.logger.warn('Failed to load active paper for chat prompt', {
        paperId,
        error: (err as Error).message,
      });
    }
  }

  return papers;
}

async function loadMappedConcepts(
  appContext: AppContext,
  paperId: string,
  limit: number,
): Promise<string[]> {
  try {
    const graph = await (appContext.dbProxy as any).getRelationGraph?.({ centerId: paperId, depth: 1 }) as Record<string, unknown> | undefined;
    const nodes = ((graph?.['nodes'] ?? []) as Array<Record<string, unknown>>)
      .filter((node) => node['type'] === 'concept')
      .map((node) => (node['nameEn'] ?? node['name_en'] ?? node['label'] ?? '') as string)
      .filter(Boolean);
    return nodes.slice(0, limit);
  } catch {
    return [];
  }
}

async function loadAnalysisSummary(
  appContext: AppContext,
  paperId: string,
  paper: Record<string, unknown>,
): Promise<string | undefined> {
  const analysisStatus = (paper['analysisStatus'] ?? paper['analysis_status']) as string | undefined;
  if (analysisStatus !== 'completed') return undefined;

  const analysisPath = (paper['analysisPath'] ?? paper['analysis_path']) as string | undefined;
  const analysisDir = analysisPath
    ? path.dirname(analysisPath)
    : path.join(appContext.workspaceRoot, 'analyses');
  const structuredPath = path.join(analysisDir, `${paperId}.analysis.json`);

  try {
    const analysisText = await fsp.readFile(structuredPath, 'utf-8');
    const analysisData = JSON.parse(analysisText) as Record<string, unknown>;
    const summary = String(analysisData['summary'] ?? analysisData['overview'] ?? '').trim();
    if (summary.length > 0) return summary.slice(0, 2000);
  } catch {
    // Fall back to markdown report if structured artifact is unavailable.
  }

  if (!analysisPath) return undefined;
  try {
    const markdown = await fsp.readFile(analysisPath, 'utf-8');
    return markdown
      .split(/\n\s*\n/)
      .map((section) => section.replace(/^#+\s+/gm, '').trim())
      .find((section) => section.length > 0)
      ?.slice(0, 2000);
  } catch {
    return undefined;
  }
}

async function loadActiveConcept(
  appContext: AppContext,
  chatContext?: ChatContext,
): Promise<ActiveConceptContext | undefined> {
  if (!chatContext?.selectedConceptId) return undefined;

  try {
    const concept = await appContext.dbProxy.getConcept(chatContext.selectedConceptId as any) as Record<string, unknown> | null;
    if (!concept) return undefined;

    return {
      id: chatContext.selectedConceptId,
      nameEn: ((concept['nameEn'] ?? concept['name_en'] ?? '') as string),
      definition: ((concept['definition'] as string) ?? '').slice(0, 1000),
      maturity: (concept['maturity'] as string) ?? 'working',
      mappedPaperCount: (concept['mappedPaperCount'] ?? concept['mapped_paper_count'] ?? 0) as number,
    };
  } catch (err) {
    appContext.logger.warn('Failed to load active concept for chat prompt', {
      conceptId: chatContext.selectedConceptId,
      error: (err as Error).message,
    });
    return undefined;
  }
}