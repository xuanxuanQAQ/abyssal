// ═══ 前端 IPC 边界共享枚举 ═══

/** 论文相关性等级 */
export type Relevance = 'seed' | 'high' | 'medium' | 'low' | 'excluded';

/** 分析状态 */
export type AnalysisStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'needs_review'
  | 'failed';

/** 全文获取状态 */
export type FulltextStatus =
  | 'available'
  | 'pending'
  | 'failed'
  | 'not_attempted';

/** 论文类型 */
export type PaperType =
  | 'empirical'
  | 'theoretical'
  | 'review'
  | 'methodological';

/** MainStage 视图类型 */
export type ViewType =
  | 'library'
  | 'reader'
  | 'analysis'
  | 'graph'
  | 'writing'
  | 'settings';

/** 管线工作流类型 */
export type WorkflowType =
  | 'discover'
  | 'acquire'
  | 'analyze'
  | 'synthesize'
  | 'generate';

/** 映射关系类型 */
export type RelationType =
  | 'supports'
  | 'challenges'
  | 'extends'
  | 'unmapped';

/** 裁决决策 */
export type AdjudicationDecision = 'accept' | 'reject' | 'revise';

/** 裁决状态 */
export type AdjudicationStatus =
  | 'pending'
  | 'accepted'
  | 'revised'
  | 'rejected';

/** 标注类型 */
export type AnnotationType = 'highlight' | 'note' | 'conceptTag';

/** 高亮颜色 */
export type HighlightColor = 'yellow' | 'green' | 'red' | 'blue';

/** 导出格式 */
export type ExportFormat = 'markdown' | 'latex' | 'docx' | 'pdf';

/** 节写作状态 */
export type SectionStatus = 'pending' | 'drafted' | 'revised' | 'finalized';

/** 引文格式 */
export type CitationStyle = 'GB/T 7714' | 'APA' | 'IEEE' | 'Chicago';

/** 管线任务状态 */
export type PipelineStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ═══ v1.2 新增枚举 ═══

/** 检索路径来源 */
export type RetrievalPath = 'vector' | 'structured' | 'annotation';

/** 检索覆盖度 */
export type RetrievalCoverage = 'sufficient' | 'insufficient' | 'partial';

/** 证据充分度状态 */
export type EvidenceStatus = 'sufficient' | 'insufficient' | 'missing';

/** 项目起点模式 */
export type ProjectStartMode = 'framework' | 'exploration';

/** Advisory 建议类型 */
export type RecommendationType =
  | 'add_paper'
  | 'merge_concepts'
  | 'split_concept'
  | 'review_mapping'
  | 'fill_evidence_gap'
  | 'general';
