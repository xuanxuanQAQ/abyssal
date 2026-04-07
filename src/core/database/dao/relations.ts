// ═══ 派生关系管理 ═══
// §9: computeRelationsForPaper / recomputeAllRelations / getRelationGraph

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { PaperRelation, RelationEdgeType } from '../../types/relation';
import type { RelationType } from '../../types/mapping';
import type {
  GraphData,
  GraphEdge as SharedGraphEdge,
  GraphNode as SharedGraphNode,
} from '../../../shared-types/models';
import type { AnalysisStatus, Relevance } from '../../../shared-types/enums';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';

export type GraphNode = SharedGraphNode;
export type GraphEdge = SharedGraphEdge;

// ─── 语义搜索函数类型（依赖注入，避免 database 直接依赖 rag） ───

export type SemanticSearchFn = (
  paperId: PaperId,
  topK: number,
) => Array<{ targetPaperId: PaperId; score: number }>;

// ─── §9.1 概念关系矩阵 ───

type RelDir = 'supports' | 'challenges' | 'extends' | 'operationalizes';

function deriveEdgeType(
  selfRelation: RelDir,
  otherRelation: RelDir,
): RelationEdgeType {
  // 两者方向一致 → agree
  if (selfRelation === otherRelation) return 'concept_agree';

  // 涉及 challenges
  if (selfRelation === 'challenges' || otherRelation === 'challenges') {
    // 双方都 challenges → agree (上面已处理)
    // 一方 challenges 另一方非 challenges → conflict
    return 'concept_conflict';
  }

  // 涉及 extends
  if (selfRelation === 'extends' || otherRelation === 'extends') {
    return 'concept_extend';
  }

  // 其余情况 (supports/operationalizes 组合) → agree
  return 'concept_agree';
}

// ─── §9.1 computeRelationsForPaper ───

export function computeRelationsForPaper(
  db: Database.Database,
  paperId: PaperId,
  semanticSearchFn: SemanticSearchFn | null,
): void {
  writeTransaction(db, () => {
    const timestamp = now();

    // 步骤 1：清理旧关系
    db.prepare(
      'DELETE FROM paper_relations WHERE source_paper_id = ? OR target_paper_id = ?',
    ).run(paperId, paperId);

    // 步骤 2：计算 semantic_neighbor
    if (semanticSearchFn) {
      const neighbors = semanticSearchFn(paperId, 20);

      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO paper_relations
        (source_paper_id, target_paper_id, edge_type, weight, metadata, computed_at)
        VALUES (?, ?, 'semantic_neighbor', ?, NULL, ?)
      `);

      for (const { targetPaperId, score } of neighbors) {
        if (score <= 0.3) continue;
        // 双向边
        insertStmt.run(paperId, targetPaperId, score, timestamp);
        insertStmt.run(targetPaperId, paperId, score, timestamp);
      }
    }

    // 步骤 3：计算概念关系边
    const conceptPairs = db.prepare(`
      SELECT pcm_other.paper_id AS other_paper_id,
             pcm_self.concept_id,
             pcm_self.relation AS self_relation,
             pcm_self.confidence AS self_confidence,
             pcm_other.relation AS other_relation,
             pcm_other.confidence AS other_confidence
      FROM paper_concept_map pcm_self
      JOIN paper_concept_map pcm_other
        ON pcm_self.concept_id = pcm_other.concept_id
        AND pcm_other.paper_id != pcm_self.paper_id
      WHERE pcm_self.paper_id = ?
        AND pcm_self.reviewed = 1
        AND pcm_other.reviewed = 1
        AND pcm_self.relation != 'irrelevant'
        AND pcm_other.relation != 'irrelevant'
    `).all(paperId) as Array<{
      other_paper_id: string;
      concept_id: string;
      self_relation: string;
      self_confidence: number;
      other_relation: string;
      other_confidence: number;
    }>;

    // 聚合：同一 (paper_pair, edge_type) 取最高 weight
    const edgeMap = new Map<string, { weight: number; metadata: string }>();

    for (const pair of conceptPairs) {
      const edgeType = deriveEdgeType(
        pair.self_relation as RelDir,
        pair.other_relation as RelDir,
      );
      const weight = Math.sqrt(pair.self_confidence * pair.other_confidence);
      const metadata = JSON.stringify({
        conceptId: pair.concept_id,
        selfRelation: pair.self_relation,
        otherRelation: pair.other_relation,
      });

      // 双向键
      for (const [src, tgt] of [
        [paperId, pair.other_paper_id],
        [pair.other_paper_id, paperId],
      ] as const) {
        const key = `${src}|${tgt}|${edgeType}`;
        const existing = edgeMap.get(key);
        if (!existing || weight > existing.weight) {
          edgeMap.set(key, { weight, metadata });
        }
      }
    }

    const insertRelStmt = db.prepare(`
      INSERT OR REPLACE INTO paper_relations
      (source_paper_id, target_paper_id, edge_type, weight, metadata, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const [key, { weight, metadata }] of edgeMap) {
      const [src, tgt, edgeType] = key.split('|') as [string, string, string];
      insertRelStmt.run(src, tgt, edgeType, weight, metadata, timestamp);
    }

    // 步骤 4：article_cites 不在此处处理（在 getRelationGraph 中动态生成）
  });
}

// ─── §9.2 recomputeAllRelations ───

export function recomputeAllRelations(
  db: Database.Database,
  semanticSearchFn: SemanticSearchFn | null,
): number {
  // 清空全表
  db.prepare('DELETE FROM paper_relations').run();

  // 获取全部已分析论文
  const papers = db
    .prepare(
      "SELECT id FROM papers WHERE analysis_status = 'completed'",
    )
    .all() as { id: string }[];

  for (const { id } of papers) {
    computeRelationsForPaper(db, id as PaperId, semanticSearchFn);
  }

  return papers.length;
}

// ─── §9.3 getRelationGraph ───

type GraphNodeType = GraphNode['type'];
type GraphEdgeType = GraphEdge['type'];

const GRAPH_RELEVANCE_VALUES = new Set<Relevance>(['seed', 'high', 'medium', 'low', 'excluded']);
const GRAPH_ANALYSIS_STATUS_VALUES = new Set<AnalysisStatus>([
  'not_started',
  'in_progress',
  'completed',
  'needs_review',
  'failed',
]);

const DEFAULT_EDGE_TYPES: GraphEdgeType[] = [
  'citation',
  'conceptAgree',
  'conceptConflict',
  'conceptExtend',
  'semanticNeighbor',
];

const MEMO_NODE_PREFIX = 'memo__';
const NOTE_NODE_PREFIX = 'note__';

export interface RelationGraphFilter {
  centerId?: string;
  centerType?: GraphNodeType;
  depth?: number;
  edgeTypes?: GraphEdgeType[];
  minWeight?: number;
  similarityThreshold?: number;
  includeNotes?: boolean;
  includeConcepts?: boolean;
}

function mapRelationEdgeType(edgeType: RelationEdgeType): GraphEdgeType {
  switch (edgeType) {
    case 'semantic_neighbor':
      return 'semanticNeighbor';
    case 'concept_agree':
      return 'conceptAgree';
    case 'concept_conflict':
      return 'conceptConflict';
    case 'concept_extend':
      return 'conceptExtend';
    case 'article_cites':
      return 'citation';
  }
}

function mapGraphEdgeTypeToDb(edgeType: GraphEdgeType): RelationEdgeType | null {
  switch (edgeType) {
    case 'semanticNeighbor':
      return 'semantic_neighbor';
    case 'conceptAgree':
      return 'concept_agree';
    case 'conceptConflict':
      return 'concept_conflict';
    case 'conceptExtend':
      return 'concept_extend';
    default:
      return null;
  }
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildEdgeId(edge: GraphEdge): string {
  return edge.id ?? `${edge.source}-${edge.target}-${edge.type}`;
}

function addEdge(edgeMap: Map<string, GraphEdge>, edge: GraphEdge): void {
  const edgeId = buildEdgeId(edge);
  const existing = edgeMap.get(edgeId);
  if (!existing || edge.weight >= existing.weight) {
    edgeMap.set(edgeId, { ...edge, id: edgeId });
  }
}

function toMemoNodeId(id: number | string): string {
  return `${MEMO_NODE_PREFIX}${id}`;
}

function toNoteNodeId(id: string): string {
  return `${NOTE_NODE_PREFIX}${id}`;
}

function extractEntityId(nodeId: string, nodeType: GraphNodeType): string {
  if (nodeType === 'memo' && nodeId.startsWith(MEMO_NODE_PREFIX)) {
    return nodeId.slice(MEMO_NODE_PREFIX.length);
  }
  if (nodeType === 'note' && nodeId.startsWith(NOTE_NODE_PREFIX)) {
    return nodeId.slice(NOTE_NODE_PREFIX.length);
  }
  return nodeId;
}

function parseConceptLevel(layer: unknown): number | undefined {
  if (typeof layer !== 'string') {
    return undefined;
  }
  const match = layer.match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function parseGraphRelevance(value: unknown): Relevance | undefined {
  return typeof value === 'string' && GRAPH_RELEVANCE_VALUES.has(value as Relevance)
    ? (value as Relevance)
    : undefined;
}

function parseGraphAnalysisStatus(value: unknown): AnalysisStatus | undefined {
  return typeof value === 'string' && GRAPH_ANALYSIS_STATUS_VALUES.has(value as AnalysisStatus)
    ? (value as AnalysisStatus)
    : undefined;
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function addPapersFromEdges(
  edges: Iterable<GraphEdge>,
  visitedPaperIds: Set<string>,
  nextFrontier?: Set<string>,
): void {
  for (const edge of edges) {
    for (const paperId of [edge.source, edge.target]) {
      if (!visitedPaperIds.has(paperId)) {
        visitedPaperIds.add(paperId);
        nextFrontier?.add(paperId);
      }
    }
  }
}

export function getRelationGraph(
  db: Database.Database,
  filter: RelationGraphFilter,
): GraphData {
  const centerType = filter.centerType ?? 'paper';
  const depth = filter.depth ?? 2;
  const minWeight = filter.minWeight ?? 0;
  const similarityThreshold = filter.similarityThreshold ?? minWeight;
  const selectedEdgeTypes = new Set(filter.edgeTypes ?? DEFAULT_EDGE_TYPES);
  const includeConcepts = filter.includeConcepts === true || centerType === 'concept';
  const includeNotes = filter.includeNotes === true || centerType === 'memo' || centerType === 'note';
  const edgeMap = new Map<string, GraphEdge>();
  const visitedPaperIds = new Set<string>();
  const focusedConceptIds = new Set<string>();
  const focusedMemoNodeIds = new Set<string>();
  const focusedNoteNodeIds = new Set<string>();

  const selectedDbEdgeTypes = [...selectedEdgeTypes]
    .map(mapGraphEdgeTypeToDb)
    .filter((edgeType): edgeType is RelationEdgeType => edgeType !== null);

  const loadPaperRelationEdges = (paperIds: string[]): GraphEdge[] => {
    if (paperIds.length === 0 || selectedDbEdgeTypes.length === 0) {
      return [];
    }
    const placeholders = paperIds.map(() => '?').join(', ');
    const typePlaceholders = selectedDbEdgeTypes.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT source_paper_id, target_paper_id, edge_type, weight, metadata
         FROM paper_relations
         WHERE edge_type IN (${typePlaceholders})
           AND (source_paper_id IN (${placeholders}) OR target_paper_id IN (${placeholders}))`,
      )
      .all(...selectedDbEdgeTypes, ...paperIds, ...paperIds) as Array<{
      source_paper_id: string;
      target_paper_id: string;
      edge_type: RelationEdgeType;
      weight: number;
      metadata: string | null;
    }>;

    return rows
      .map((row) => {
        const type = mapRelationEdgeType(row.edge_type);
        if (row.weight < minWeight) {
          return null;
        }
        if (type === 'semanticNeighbor' && row.weight < similarityThreshold) {
          return null;
        }
        const metadata = parseMetadata(row.metadata);
        const edge: GraphEdge = {
          source: row.source_paper_id,
          target: row.target_paper_id,
          type,
          weight: row.weight,
        };
        if (typeof metadata?.['conceptId'] === 'string') {
          edge.conceptId = metadata['conceptId'];
        }
        return edge;
      })
      .filter(isDefined);
  };

  const loadGlobalPaperRelationEdges = (): GraphEdge[] => {
    if (selectedDbEdgeTypes.length === 0) {
      return [];
    }
    const typePlaceholders = selectedDbEdgeTypes.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT source_paper_id, target_paper_id, edge_type, weight, metadata
         FROM paper_relations
         WHERE edge_type IN (${typePlaceholders})`,
      )
      .all(...selectedDbEdgeTypes) as Array<{
      source_paper_id: string;
      target_paper_id: string;
      edge_type: RelationEdgeType;
      weight: number;
      metadata: string | null;
    }>;

    return rows
      .map((row) => {
        const type = mapRelationEdgeType(row.edge_type);
        if (row.weight < minWeight) {
          return null;
        }
        if (type === 'semanticNeighbor' && row.weight < similarityThreshold) {
          return null;
        }
        const metadata = parseMetadata(row.metadata);
        const edge: GraphEdge = {
          source: row.source_paper_id,
          target: row.target_paper_id,
          type,
          weight: row.weight,
        };
        if (typeof metadata?.['conceptId'] === 'string') {
          edge.conceptId = metadata['conceptId'];
        }
        return edge;
      })
      .filter(isDefined);
  };

  const loadCitationEdges = (paperIds?: string[]): GraphEdge[] => {
    if (!selectedEdgeTypes.has('citation')) {
      return [];
    }
    if (!paperIds || paperIds.length === 0) {
      const rows = db.prepare(
        'SELECT citing_id, cited_id FROM citations',
      ).all() as Array<{ citing_id: string; cited_id: string }>;
      return rows.map((row) => ({
        source: row.citing_id,
        target: row.cited_id,
        type: 'citation',
        weight: 1,
      }));
    }

    const placeholders = paperIds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT citing_id, cited_id
         FROM citations
         WHERE citing_id IN (${placeholders}) OR cited_id IN (${placeholders})`,
      )
      .all(...paperIds, ...paperIds) as Array<{ citing_id: string; cited_id: string }>;
    return rows.map((row) => ({
      source: row.citing_id,
      target: row.cited_id,
      type: 'citation',
      weight: 1,
    }));
  };

  if (filter.centerId) {
    let frontier = new Set<string>();

    switch (centerType) {
      case 'paper':
        visitedPaperIds.add(filter.centerId);
        frontier.add(filter.centerId);
        break;
      case 'concept': {
        const conceptId = extractEntityId(filter.centerId, centerType);
        focusedConceptIds.add(conceptId);
        const rows = db
          .prepare(
            `SELECT DISTINCT paper_id
             FROM paper_concept_map
             WHERE concept_id = ?
               AND reviewed = 1
               AND relation != 'irrelevant'`,
          )
          .all(conceptId) as Array<{ paper_id: string }>;
        for (const row of rows) {
          visitedPaperIds.add(row.paper_id);
          frontier.add(row.paper_id);
        }
        break;
      }
      case 'memo': {
        const memoId = extractEntityId(filter.centerId, centerType);
        focusedMemoNodeIds.add(toMemoNodeId(memoId));
        const rows = db
          .prepare(
            `SELECT DISTINCT je.value AS paper_id
             FROM research_memos m, json_each(m.paper_ids) je
             WHERE m.id = ?`,
          )
          .all(memoId) as Array<{ paper_id: string }>;
        for (const row of rows) {
          visitedPaperIds.add(row.paper_id);
          frontier.add(row.paper_id);
        }
        break;
      }
      case 'note': {
        const noteId = extractEntityId(filter.centerId, centerType);
        focusedNoteNodeIds.add(toNoteNodeId(noteId));
        const rows = db
          .prepare(
            `SELECT DISTINCT je.value AS paper_id
             FROM research_notes n, json_each(n.linked_paper_ids) je
             WHERE n.id = ?`,
          )
          .all(noteId) as Array<{ paper_id: string }>;
        for (const row of rows) {
          visitedPaperIds.add(row.paper_id);
          frontier.add(row.paper_id);
        }
        break;
      }
    }

    for (let currentDepth = 0; currentDepth < depth; currentDepth++) {
      if (frontier.size === 0) {
        break;
      }

      const frontierIds = [...frontier];
      const nextFrontier = new Set<string>();
      const edges = [
        ...loadPaperRelationEdges(frontierIds),
        ...loadCitationEdges(frontierIds),
      ];

      for (const edge of edges) {
        addEdge(edgeMap, edge);
      }
      addPapersFromEdges(edges, visitedPaperIds, nextFrontier);
      frontier = nextFrontier;
    }
  } else {
    const edges = [
      ...loadGlobalPaperRelationEdges(),
      ...loadCitationEdges(),
    ];
    for (const edge of edges) {
      addEdge(edgeMap, edge);
    }
    addPapersFromEdges(edges, visitedPaperIds);
  }

  const nodes: GraphNode[] = [];

  if (visitedPaperIds.size > 0) {
    const paperIds = [...visitedPaperIds];
    const placeholders = paperIds.map(() => '?').join(', ');
    const paperRows = db
      .prepare(
        `SELECT id, title, year, relevance, analysis_status
         FROM papers
         WHERE id IN (${placeholders})`,
      )
      .all(...paperIds) as Array<{
      id: string;
      title: string;
      year: number | null;
      relevance: string | null;
      analysis_status: string | null;
    }>;

    for (const row of paperRows) {
      nodes.push({
        id: row.id,
        type: 'paper',
        label: row.title,
        relevance: parseGraphRelevance(row.relevance),
        analysisStatus: parseGraphAnalysisStatus(row.analysis_status),
      });
    }
  }

  if (includeConcepts) {
    const paperIds = [...visitedPaperIds];
    if (paperIds.length > 0) {
      const placeholders = paperIds.map(() => '?').join(', ');
      const mappingRows = db
        .prepare(
          `SELECT DISTINCT pcm.paper_id, pcm.concept_id, c.name_zh, c.name_en, c.layer, c.parent_id, c.maturity
           FROM paper_concept_map pcm
           JOIN concepts c ON c.id = pcm.concept_id
           WHERE pcm.paper_id IN (${placeholders})
             AND pcm.reviewed = 1
             AND pcm.relation != 'irrelevant'
             AND c.deprecated = 0`,
        )
        .all(...paperIds) as Array<{
        paper_id: string;
        concept_id: string;
        name_zh: string | null;
        name_en: string | null;
        layer: string | null;
        parent_id: string | null;
        maturity: string | null;
      }>;

      const conceptNodeIds = new Set<string>(focusedConceptIds);

      for (const row of mappingRows) {
        if (!conceptNodeIds.has(row.concept_id)) {
          nodes.push({
            id: row.concept_id,
            type: 'concept',
            label: row.name_zh ?? row.name_en ?? row.concept_id,
            level: parseConceptLevel(row.layer),
            parentId: row.parent_id ?? undefined,
            metadata: { maturity: row.maturity ?? 'working' },
          });
          conceptNodeIds.add(row.concept_id);
        }

        addEdge(edgeMap, {
          source: row.paper_id,
          target: row.concept_id,
          type: 'conceptMapping',
          weight: 1,
          conceptId: row.concept_id,
        });
      }
    }

    if (focusedConceptIds.size > 0) {
      const missingConceptIds = [...focusedConceptIds].filter(
        (conceptId) => !nodes.some((node) => node.id === conceptId),
      );
      if (missingConceptIds.length > 0) {
        const placeholders = missingConceptIds.map(() => '?').join(', ');
        const conceptRows = db
          .prepare(
            `SELECT id, name_zh, name_en, layer, parent_id, maturity
             FROM concepts
             WHERE id IN (${placeholders})`,
          )
          .all(...missingConceptIds) as Array<{
          id: string;
          name_zh: string | null;
          name_en: string | null;
          layer: string | null;
          parent_id: string | null;
          maturity: string | null;
        }>;

        for (const row of conceptRows) {
          nodes.push({
            id: row.id,
            type: 'concept',
            label: row.name_zh ?? row.name_en ?? row.id,
            level: parseConceptLevel(row.layer),
            parentId: row.parent_id ?? undefined,
            metadata: { maturity: row.maturity ?? 'working' },
          });
        }
      }
    }
  }

  if (includeNotes) {
    const paperIds = [...visitedPaperIds];
    if (paperIds.length > 0) {
      const placeholders = paperIds.map(() => '?').join(', ');
      const memoRows = db
        .prepare(
          `SELECT DISTINCT m.id, m.text, je.value AS paper_id
           FROM research_memos m, json_each(m.paper_ids) je
           WHERE je.value IN (${placeholders})`,
        )
        .all(...paperIds) as Array<{ id: number; text: string; paper_id: string }>;

      const memoNodeIds = new Set<string>(focusedMemoNodeIds);
      for (const row of memoRows) {
        const memoNodeId = toMemoNodeId(row.id);
        if (!memoNodeIds.has(memoNodeId)) {
          nodes.push({
            id: memoNodeId,
            type: 'memo',
            label: row.text.slice(0, 100),
            metadata: { entityId: String(row.id) },
          });
          memoNodeIds.add(memoNodeId);
        }

        addEdge(edgeMap, {
          source: memoNodeId,
          target: row.paper_id,
          type: 'notes',
          weight: 1,
        });
      }

      const noteRows = db
        .prepare(
          `SELECT DISTINCT n.id, n.title, je.value AS paper_id
           FROM research_notes n, json_each(n.linked_paper_ids) je
           WHERE je.value IN (${placeholders})`,
        )
        .all(...paperIds) as Array<{ id: string; title: string; paper_id: string }>;

      const noteNodeIds = new Set<string>(focusedNoteNodeIds);
      for (const row of noteRows) {
        const noteNodeId = toNoteNodeId(row.id);
        if (!noteNodeIds.has(noteNodeId)) {
          nodes.push({
            id: noteNodeId,
            type: 'note',
            label: row.title,
            metadata: { entityId: row.id },
          });
          noteNodeIds.add(noteNodeId);
        }

        addEdge(edgeMap, {
          source: noteNodeId,
          target: row.paper_id,
          type: 'notes',
          weight: 1,
        });
      }
    }

    for (const memoNodeId of focusedMemoNodeIds) {
      if (!nodes.some((node) => node.id === memoNodeId)) {
        const memoId = extractEntityId(memoNodeId, 'memo');
        const row = db
          .prepare('SELECT id, text FROM research_memos WHERE id = ?')
          .get(memoId) as { id: number; text: string } | undefined;
        if (row) {
          nodes.push({
            id: memoNodeId,
            type: 'memo',
            label: row.text.slice(0, 100),
            metadata: { entityId: String(row.id) },
          });
        }
      }
    }

    for (const noteNodeId of focusedNoteNodeIds) {
      if (!nodes.some((node) => node.id === noteNodeId)) {
        const noteId = extractEntityId(noteNodeId, 'note');
        const row = db
          .prepare('SELECT id, title FROM research_notes WHERE id = ?')
          .get(noteId) as { id: string; title: string } | undefined;
        if (row) {
          nodes.push({
            id: noteNodeId,
            type: 'note',
            label: row.title,
            metadata: { entityId: row.id },
          });
        }
      }
    }
  }

  return {
    nodes,
    edges: [...edgeMap.values()],
  };
}

// ─── 简单查询 ───

export function getRelationsForPaper(
  db: Database.Database,
  paperId: PaperId,
): PaperRelation[] {
  const rows = db
    .prepare(
      'SELECT * FROM paper_relations WHERE source_paper_id = ? OR target_paper_id = ?',
    )
    .all(paperId, paperId) as Record<string, unknown>[];
  return rows.map((r) => fromRow<PaperRelation>(r));
}
