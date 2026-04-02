// ═══ 派生关系管理 ═══
// §9: computeRelationsForPaper / recomputeAllRelations / getRelationGraph

import type Database from 'better-sqlite3';
import type { PaperId } from '../../types/common';
import type { PaperRelation, RelationEdgeType } from '../../types/relation';
import type { RelationType } from '../../types/mapping';
import { fromRow, now } from '../row-mapper';
import { writeTransaction } from '../transaction-utils';

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

export interface GraphNode {
  id: string;
  type: 'paper' | 'memo' | 'note';
  title: string;
  year?: number | undefined;
  relevance?: string | undefined;
  analysisStatus?: string | undefined;
}

export interface GraphEdge {
  source: string;
  target: string;
  edgeType: RelationEdgeType;
  weight: number;
  metadata: Record<string, unknown> | null;
}

export interface RelationGraphFilter {
  centerId?: PaperId;
  depth?: number;
  edgeTypes?: RelationEdgeType[];
  minWeight?: number;
  includeNotes?: boolean;
}

export function getRelationGraph(
  db: Database.Database,
  filter: RelationGraphFilter,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const depth = filter.depth ?? 2;
  const minWeight = filter.minWeight ?? 0;
  const edgeTypes = filter.edgeTypes ?? [
    'semantic_neighbor',
    'concept_agree',
    'concept_conflict',
    'concept_extend',
  ];

  const typeFilter =
    edgeTypes.length > 0
      ? `AND edge_type IN (${edgeTypes.map(() => '?').join(', ')})`
      : '';
  const typeParams = edgeTypes;

  const allEdges: GraphEdge[] = [];
  const visitedPaperIds = new Set<string>();

  if (filter.centerId) {
    // 局部 BFS 展开
    let frontier = new Set<string>([filter.centerId]);
    visitedPaperIds.add(filter.centerId);

    for (let d = 0; d < depth; d++) {
      if (frontier.size === 0) break;

      const frontierArr = [...frontier];
      const placeholders = frontierArr.map(() => '?').join(', ');

      const rows = db
        .prepare(
          `SELECT * FROM paper_relations
           WHERE (source_paper_id IN (${placeholders}) OR target_paper_id IN (${placeholders}))
             AND weight >= ?
             ${typeFilter}`,
        )
        .all(
          ...frontierArr,
          ...frontierArr,
          minWeight,
          ...typeParams,
        ) as Record<string, unknown>[];

      const nextFrontier = new Set<string>();

      for (const row of rows) {
        const edge: GraphEdge = {
          source: row['source_paper_id'] as string,
          target: row['target_paper_id'] as string,
          edgeType: row['edge_type'] as RelationEdgeType,
          weight: row['weight'] as number,
          metadata: (() => {
            try { return row['metadata'] ? JSON.parse(row['metadata'] as string) : null; }
            catch { return null; }
          })(),
        };
        allEdges.push(edge);

        for (const nid of [edge.source, edge.target]) {
          if (!visitedPaperIds.has(nid)) {
            visitedPaperIds.add(nid);
            nextFrontier.add(nid);
          }
        }
      }

      frontier = nextFrontier;
    }
  } else {
    // 全局查询
    const rows = db
      .prepare(
        `SELECT * FROM paper_relations WHERE weight >= ? ${typeFilter}`,
      )
      .all(minWeight, ...typeParams) as Record<string, unknown>[];

    for (const row of rows) {
      const edge: GraphEdge = {
        source: row['source_paper_id'] as string,
        target: row['target_paper_id'] as string,
        edgeType: row['edge_type'] as RelationEdgeType,
        weight: row['weight'] as number,
        metadata: row['metadata']
          ? JSON.parse(row['metadata'] as string)
          : null,
      };
      allEdges.push(edge);
      visitedPaperIds.add(edge.source);
      visitedPaperIds.add(edge.target);
    }
  }

  // 补充节点信息
  const nodes: GraphNode[] = [];

  if (visitedPaperIds.size > 0) {
    const ids = [...visitedPaperIds];
    const placeholders = ids.map(() => '?').join(', ');
    const paperRows = db
      .prepare(
        `SELECT id, title, year, relevance, analysis_status FROM papers WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Record<string, unknown>[];

    for (const r of paperRows) {
      nodes.push({
        id: r['id'] as string,
        type: 'paper',
        title: r['title'] as string,
        year: r['year'] as number | undefined,
        relevance: r['relevance'] as string | undefined,
        analysisStatus: r['analysis_status'] as string | undefined,
      });
    }
  }

  // article_cites 边动态生成
  if (visitedPaperIds.size > 0 && edgeTypes.includes('article_cites')) {
    const ids = [...visitedPaperIds];
    const placeholders = ids.map(() => '?').join(', ');
    const articleCiteRows = db
      .prepare(
        `SELECT o.article_id, je.value AS paper_id
         FROM outlines o, json_each(o.paper_ids) je
         WHERE je.value IN (${placeholders})`,
      )
      .all(...ids) as Array<{ article_id: string; paper_id: string }>;

    // 构造文章内跨论文引用边
    const articlePapers = new Map<string, string[]>();
    for (const row of articleCiteRows) {
      const papers = articlePapers.get(row.article_id) ?? [];
      papers.push(row.paper_id);
      articlePapers.set(row.article_id, papers);
    }

    for (const [_, papers] of articlePapers) {
      for (let i = 0; i < papers.length; i++) {
        for (let j = i + 1; j < papers.length; j++) {
          allEdges.push({
            source: papers[i]!,
            target: papers[j]!,
            edgeType: 'article_cites',
            weight: 0.5,
            metadata: null,
          });
        }
      }
    }
  }

  // 笔记节点
  if (filter.includeNotes && visitedPaperIds.size > 0) {
    const ids = [...visitedPaperIds];
    const placeholders = ids.map(() => '?').join(', ');

    const memoRows = db
      .prepare(
        `SELECT DISTINCT m.id, m.text
         FROM research_memos m, json_each(m.paper_ids) je
         WHERE je.value IN (${placeholders})`,
      )
      .all(...ids) as Array<{ id: number; text: string }>;

    for (const m of memoRows) {
      nodes.push({
        id: `memo__${m.id}`,
        type: 'memo',
        title: m.text.slice(0, 100),
      });
    }

    const noteRows = db
      .prepare(
        `SELECT DISTINCT n.id, n.title
         FROM research_notes n, json_each(n.linked_paper_ids) je
         WHERE je.value IN (${placeholders})`,
      )
      .all(...ids) as Array<{ id: string; title: string }>;

    for (const n of noteRows) {
      nodes.push({
        id: n.id,
        type: 'note',
        title: n.title,
      });
    }
  }

  return { nodes, edges: allEdges };
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
