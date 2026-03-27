/**
 * Discover workflow — literature discovery via citation traversal + concept search.
 *
 * 8-step pipeline:
 * 1. Seed loading (§1.3)
 * 2. Three-directional citation BFS (§1.4)
 * 3. Bridge paper identification + 1.5× weighting (§1.5)
 * 4. Concept-dictionary-driven multi-source search (§1.6)
 * 5. Global dedup + merge (§1.7)
 * 6. Batch LLM relevance screening (§1.8)
 * 7. Ingestion decision + DB write (§1.9)
 * 8. Progress report + stats
 *
 * Idempotency: addPaper UPSERT silently skips existing papers.
 * Circuit breaker: 10 consecutive same-category failures → abort.
 *
 * See spec: §1
 */

import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { SearchService } from '../../../core/search';
import type { LlmClient } from '../../llm-client/llm-client';
import type { Logger } from '../../../core/infra/logger';
import type { PaperMetadata } from '../../../core/types/paper';
import type { PaperId } from '../../../core/types/common';
import { CircuitBreaker } from '../error-classifier';
import { withRetry, classifyError } from '../error-classifier';
import { createConcurrencyGuard } from '../concurrency-guard';

// ─── Types ───

interface Seed {
  paperId: string;
  seedType: 'axiom' | 'milestone' | 'exploratory';
  doi: string | null;
  arxivId: string | null;
  semanticScholarId: string | null;
}

interface Candidate {
  paper: PaperMetadata;
  discoveredVia: 'references' | 'citations' | 'related' | 'concept_search';
  discoveredFrom: string;
  rootSeedId: string;
  depth: number;
  isBridgePaper: boolean;
  bridgeSeedCount: number;
  relevanceScore: number;
  screeningReason: string;
}

// ─── Services interface ───

export interface DiscoverServices {
  dbProxy: {
    getSeeds: () => Promise<Array<Record<string, unknown>>>;
    getPaper: (id: string) => Promise<Record<string, unknown> | null>;
    addPaper: (metadata: unknown) => Promise<unknown>;
    addCitation: (citingId: string, citedId: string) => Promise<void>;
    queryPapers: (filter: unknown) => Promise<{ items: Array<Record<string, unknown>> }>;
    getAllConcepts?: () => Promise<Array<Record<string, unknown>>>;
  };
  searchService: SearchService;
  llmClient: LlmClient | null;
  logger: Logger;
  config: {
    discovery: { citationDepth: number; maxResultsPerQuery: number; relevanceThreshold?: number; keepExcluded?: boolean };
    project: { description?: string; keywords?: string[] };
    maxPapersPerSeed?: number;
  };
  frameworkState: string;
}

// ─── Workflow ───

export function createDiscoverWorkflow(services: DiscoverServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, searchService, llmClient, logger, config } = services;
    const breaker = new CircuitBreaker(10);
    const guard = createConcurrencyGuard('discover', options.concurrency);

    // ═══ Step 1: Seed loading (§1.3) ═══
    const rawSeeds = await dbProxy.getSeeds();
    const seeds: Seed[] = [];

    for (const s of rawSeeds) {
      const paperId = s['paperId'] as string ?? s['paper_id'] as string;
      const paper = await dbProxy.getPaper(paperId);
      if (!paper) continue;

      const doi = (paper['doi'] as string) ?? null;
      const arxivId = (paper['arxivId'] as string ?? paper['arxiv_id'] as string) ?? null;
      const s2Id = (paper['semanticScholarId'] as string ?? paper['semantic_scholar_id'] as string) ?? null;

      if (!doi && !arxivId && !s2Id) {
        logger.warn(`Seed ${paperId}: no external identifier, skipping citation traversal`);
        continue;
      }

      seeds.push({
        paperId,
        seedType: (s['seedType'] as string ?? s['seed_type'] as string ?? 'exploratory') as Seed['seedType'],
        doi,
        arxivId,
        semanticScholarId: s2Id,
      });
    }

    if (seeds.length === 0) {
      logger.info('No seeds with external identifiers found');
      runner.setTotal(0);
      return;
    }

    logger.info(`Loaded ${seeds.length} seeds for discovery`);

    // ═══ Step 2: Three-directional citation BFS (§1.4) ═══
    const allCandidates: Candidate[] = [];
    const baseDepth = config.discovery.citationDepth ?? 2;
    const maxPerSeed = config.maxPapersPerSeed ?? 200;

    for (const seed of seeds) {
      if (runner.signal.aborted) break;
      runner.reportProgress({ currentItem: seed.paperId, currentStage: 'traversing' });

      // maxDepth adjustment by seed type (§1.4.1)
      let maxDepth = baseDepth;
      if (seed.seedType === 'axiom') maxDepth = baseDepth + 1;
      if (seed.seedType === 'exploratory') maxDepth = Math.max(1, baseDepth - 1);

      const identifier = seed.semanticScholarId ?? seed.doi ?? seed.arxivId!;

      // Three directions
      for (const direction of ['references', 'citations', 'related'] as const) {
        if (runner.signal.aborted) break;
        try {
          const dirCandidates = await traverseDirection(
            identifier,
            seed.paperId,
            direction,
            direction === 'related' ? 1 : maxDepth, // related: 1 layer only
            maxPerSeed,
            searchService,
            logger,
          );
          allCandidates.push(...dirCandidates);
        } catch (err) {
          const classified = classifyError(err);
          logger.warn(`Seed ${seed.paperId} ${direction}: ${classified.message}`);
          breaker.recordFailure(err);
        }
      }
    }

    logger.info(`Citation traversal found ${allCandidates.length} candidates`);

    // ═══ Step 3: Bridge paper identification (§1.5) ═══
    const seedCountMap = new Map<string, Set<string>>();
    for (const c of allCandidates) {
      const existing = seedCountMap.get(c.paper.id) ?? new Set<string>();
      existing.add(c.rootSeedId);
      seedCountMap.set(c.paper.id, existing);
    }
    for (const c of allCandidates) {
      const seedCount = seedCountMap.get(c.paper.id)?.size ?? 0;
      c.isBridgePaper = seedCount >= 2;
      c.bridgeSeedCount = seedCount;
    }

    // ═══ Step 4: Concept-dictionary search (§1.6) ═══
    if (services.frameworkState !== 'zero_concepts' && dbProxy.getAllConcepts) {
      runner.reportProgress({ currentStage: 'concept_search' });
      try {
        const concepts = await dbProxy.getAllConcepts();
        const activeConcepts = concepts.filter((c) => !c['deprecated']);

        for (const concept of activeConcepts) {
          if (runner.signal.aborted) break;
          const keywords = (concept['searchKeywords'] as string[] ?? concept['search_keywords'] as string[]) ?? [];
          const nameEn = concept['nameEn'] as string ?? concept['name_en'] as string ?? '';

          const queries = generateSearchQueries(nameEn, keywords, config.project.keywords ?? []);
          for (const query of queries.slice(0, 3)) { // limit to 3 queries per concept
            try {
              const results = await withRetry(() =>
                searchService.searchSemanticScholar(query, { limit: 20 }),
              );
              for (const paper of results) {
                allCandidates.push({
                  paper,
                  discoveredVia: 'concept_search',
                  discoveredFrom: concept['id'] as string,
                  rootSeedId: concept['id'] as string,
                  depth: 0,
                  isBridgePaper: false,
                  bridgeSeedCount: 0,
                  relevanceScore: 0,
                  screeningReason: '',
                });
              }
            } catch (err) {
              logger.debug(`Concept search failed for "${query}": ${(err as Error).message}`);
            }
          }
        }
      } catch (err) {
        logger.warn(`Concept search failed: ${(err as Error).message}`);
      }
    }

    // ═══ Step 5: Global dedup + merge (§1.7) ═══
    runner.reportProgress({ currentStage: 'deduplicating' });

    const unique = new Map<string, Candidate>();
    for (const c of allCandidates) {
      const doi = c.paper.doi?.toLowerCase().trim();
      const arxiv = c.paper.arxivId?.replace(/v\d+$/, '').replace(/^arxiv:/i, '');
      const titleKey = c.paper.title
        ?.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);

      const key = doi ? `doi:${doi}` : arxiv ? `arxiv:${arxiv}` : `title:${titleKey}`;
      if (!key || key === 'title:') continue;

      if (unique.has(key)) {
        // Merge: keep more complete metadata, take higher bridge count
        const existing = unique.get(key)!;
        if (c.bridgeSeedCount > existing.bridgeSeedCount) {
          existing.bridgeSeedCount = c.bridgeSeedCount;
          existing.isBridgePaper = c.isBridgePaper;
        }
        if (!existing.paper.abstract && c.paper.abstract) {
          existing.paper = { ...existing.paper, abstract: c.paper.abstract };
        }
        if ((c.paper.citationCount ?? 0) > (existing.paper.citationCount ?? 0)) {
          existing.paper = { ...existing.paper, citationCount: c.paper.citationCount };
        }
      } else {
        unique.set(key, c);
      }
    }

    // Filter out papers already in DB
    const existingPapers = await dbProxy.queryPapers({ limit: 10000 });
    const existingIds = new Set<string>();
    for (const p of existingPapers.items) {
      if (p['doi']) existingIds.add(('doi:' + (p['doi'] as string).toLowerCase().trim()));
      if (p['arxivId'] ?? p['arxiv_id']) {
        const aid = ((p['arxivId'] ?? p['arxiv_id']) as string).replace(/v\d+$/, '');
        existingIds.add('arxiv:' + aid);
      }
      existingIds.add(p['id'] as string);
    }

    const newCandidates = [...unique.values()].filter((c) => {
      const doi = c.paper.doi?.toLowerCase().trim();
      const arxiv = c.paper.arxivId?.replace(/v\d+$/, '');
      if (doi && existingIds.has(`doi:${doi}`)) return false;
      if (arxiv && existingIds.has(`arxiv:${arxiv}`)) return false;
      if (existingIds.has(c.paper.id)) return false;
      return true;
    });

    logger.info(`After dedup: ${newCandidates.length} new candidates (from ${allCandidates.length} raw)`);

    if (newCandidates.length === 0) {
      runner.setTotal(0);
      return;
    }

    runner.setTotal(newCandidates.length);

    // ═══ Step 6: Batch LLM screening (§1.8) ═══
    if (llmClient && newCandidates.length > 0) {
      runner.reportProgress({ currentStage: 'screening' });
      const batchSize = 5;

      for (let i = 0; i < newCandidates.length; i += batchSize) {
        if (runner.signal.aborted) break;
        const batch = newCandidates.slice(i, i + batchSize);

        try {
          const scores = await batchScreen(batch, llmClient, services, logger);
          for (let j = 0; j < batch.length; j++) {
            if (scores[j]) {
              batch[j]!.relevanceScore = scores[j]!.score;
              batch[j]!.screeningReason = scores[j]!.reason;
            }
          }
          breaker.recordSuccess();
        } catch (err) {
          logger.warn(`Batch screening failed at index ${i}: ${(err as Error).message}`);
          breaker.recordFailure(err);
          // Set failed batch to 0.0
          for (const c of batch) {
            c.relevanceScore = 0.0;
            c.screeningReason = 'screening_failed';
          }
        }
      }
    } else {
      // No LLM — set default moderate score
      for (const c of newCandidates) {
        c.relevanceScore = 0.5;
        c.screeningReason = 'no_llm_screening';
      }
    }

    // ═══ Step 7: Ingestion decision + write (§1.9) ═══
    runner.reportProgress({ currentStage: 'ingesting' });
    const threshold = config.discovery.relevanceThreshold ?? 0.4;
    let ingested = 0;

    for (const c of newCandidates) {
      if (runner.signal.aborted) break;

      const effectiveScore = c.relevanceScore * (c.isBridgePaper ? 1.5 : 1.0);

      let relevance: 'high' | 'medium' | 'low' | 'excluded';
      if (effectiveScore >= 0.7) relevance = 'high';
      else if (effectiveScore >= threshold) relevance = 'medium';
      else if (effectiveScore >= threshold * 0.8) relevance = 'low';
      else relevance = 'excluded';

      const shouldIngest = relevance !== 'excluded' || config.discovery.keepExcluded;

      if (shouldIngest) {
        try {
          await guard.writeExclusive(async () => {
            await dbProxy.addPaper({
              ...c.paper,
              relevance,
              discoveredVia: c.discoveredVia,
              discoveredFrom: c.discoveredFrom,
            });
            // Write citation relationship
            if (c.discoveredVia !== 'concept_search') {
              try {
                await dbProxy.addCitation(c.discoveredFrom, c.paper.id);
              } catch { /* ignore dup citations */ }
            }
          });
          ingested++;
          runner.reportComplete(c.paper.id);
          breaker.recordSuccess();
        } catch (err) {
          runner.reportFailed(c.paper.id, 'ingest', err as Error);
          breaker.recordFailure(err);
        }
      } else {
        runner.reportSkipped(c.paper.id);
      }
    }

    logger.info(`Discovery complete: ${ingested} papers ingested from ${newCandidates.length} candidates`);
  };
}

// ─── BFS traversal (§1.4.1) ───

async function traverseDirection(
  seedIdentifier: string,
  seedPaperId: string,
  direction: 'references' | 'citations' | 'related',
  maxDepth: number,
  maxCandidates: number,
  search: SearchService,
  logger: Logger,
): Promise<Candidate[]> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];
  const candidates: Candidate[] = [];

  queue.push({ id: seedIdentifier, depth: 0 });
  visited.add(seedIdentifier);

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;

    let results: PaperMetadata[];
    try {
      if (direction === 'related') {
        results = await withRetry(() => search.getRelatedPapers(item.id));
      } else {
        results = await withRetry(() =>
          search.getCitations(item.id, direction === 'references' ? 'references' : 'citations'),
        );
      }
    } catch (err) {
      logger.debug(`BFS ${direction} at depth ${item.depth}: ${(err as Error).message}`);
      continue;
    }

    for (const paper of results) {
      const paperId = paper.doi ?? paper.arxivId ?? paper.id;
      if (!paperId) continue;
      if (visited.has(paperId)) continue;

      visited.add(paperId);
      candidates.push({
        paper,
        discoveredVia: direction,
        discoveredFrom: item.id,
        rootSeedId: seedPaperId,
        depth: item.depth + 1,
        isBridgePaper: false,
        bridgeSeedCount: 0,
        relevanceScore: 0,
        screeningReason: '',
      });

      // Only continue BFS for references/citations, not related (§1.4.1)
      if (direction !== 'related' && item.depth + 1 < maxDepth) {
        const nextId = paper.doi ?? paper.arxivId ?? paper.id;
        if (nextId) queue.push({ id: nextId, depth: item.depth + 1 });
      }

      if (candidates.length >= maxCandidates) return candidates;
    }
  }

  return candidates;
}

// ─── Concept search queries (§1.6) ───

function generateSearchQueries(
  conceptName: string,
  searchKeywords: string[],
  projectKeywords: string[],
): string[] {
  const queries = new Set<string>();

  // Strategy 1: concept name + project keywords
  if (conceptName && projectKeywords.length > 0) {
    queries.add(`${conceptName} ${projectKeywords.join(' ')}`);
  }

  // Strategy 2: each keyword independently
  for (const kw of searchKeywords) {
    queries.add(kw);
  }

  // Strategy 3: first two keywords combined
  if (searchKeywords.length >= 2) {
    queries.add(`${searchKeywords[0]} ${searchKeywords[1]}`);
  }

  return [...queries];
}

// ─── Batch LLM screening (§1.8) ───

async function batchScreen(
  batch: Candidate[],
  llmClient: LlmClient,
  services: DiscoverServices,
  logger: Logger,
): Promise<Array<{ score: number; reason: string }>> {
  const projectDesc = services.config.project.description ?? '';

  const paperLines = batch.map((c, i) => {
    const authors = c.paper.authors?.slice(0, 3).join(', ') ?? 'Unknown';
    const abstract = c.paper.abstract?.slice(0, 300) ?? 'No abstract';
    return `[${i}] Title: ${c.paper.title}\n    Authors: ${authors}\n    Year: ${c.paper.year}\n    Abstract: ${abstract}`;
  }).join('\n\n');

  const systemPrompt = `You are an academic relevance assessor. For each paper below, rate its relevance to the research topic on a scale of 0.0 to 1.0.

Research topic: ${projectDesc}

Output a JSON array with one entry per paper:
[{"paper_index": 0, "relevance": 0.85, "reason": "one sentence"}, ...]`;

  const userMessage = `Papers to assess:\n\n${paperLines}`;

  const result = await llmClient.complete({
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    workflowId: 'discover_screen',
  });

  return parseScreeningResponse(result.text, batch.length);
}

function parseScreeningResponse(
  text: string,
  batchSize: number,
): Array<{ score: number; reason: string }> {
  const results: Array<{ score: number; reason: string }> = [];

  // Try JSON array parse
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ paper_index: number; relevance: number; reason?: string }>;
      for (const entry of parsed) {
        results[entry.paper_index] = {
          score: Math.max(0, Math.min(1, Number(entry.relevance) || 0)),
          reason: entry.reason ?? '',
        };
      }
      // Fill missing entries
      for (let i = 0; i < batchSize; i++) {
        if (!results[i]) results[i] = { score: 0, reason: 'missing_from_response' };
      }
      return results;
    }
  } catch { /* fall through to regex */ }

  // Regex fallback
  for (let i = 0; i < batchSize; i++) {
    const scoreMatch = text.match(new RegExp(`\\[${i}\\].*?(\\d\\.\\d+)`, 's'));
    if (scoreMatch) {
      results.push({
        score: Math.max(0, Math.min(1, parseFloat(scoreMatch[1]!))),
        reason: '',
      });
    } else {
      results.push({ score: 0, reason: 'parse_failed' });
    }
  }

  return results;
}
