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
  | 'not_attempted'
  | 'pending'
  | 'available'
  | 'abstract_only'
  | 'failed';

/** 论文类型（与后端 core/types/paper.ts 统一） */
export type PaperType =
  | 'journal'
  | 'conference'
  | 'book'
  | 'chapter'
  | 'preprint'
  | 'review'
  | 'unknown';

/** MainStage 视图类型 */
export type ViewType =
  | 'library'
  | 'reader'
  | 'analysis'
  | 'graph'
  | 'writing'
  | 'notes'
  | 'settings';

/** 管线工作流类型 */
export type WorkflowType =
  | 'discover'
  | 'acquire'
  | 'process'
  | 'analyze'
  | 'synthesize'
  | 'article'
  | 'bibliography'
  | 'generate'; // deprecated alias for 'article'

/** 映射关系类型（与后端 core/types/mapping.ts 统一） */
export type RelationType =
  | 'supports'
  | 'challenges'
  | 'extends'
  | 'operationalizes'
  | 'irrelevant';

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
  | 'partial'
  | 'failed'
  | 'cancelled';

/** 检索路径来源 */
export type RetrievalPath = 'vector' | 'structured' | 'annotation';

/** 检索覆盖度 */
export type RetrievalCoverage = 'sufficient' | 'insufficient' | 'partial';

/** 证据充分度状态 */
export type EvidenceStatus = 'sufficient' | 'insufficient' | 'missing';

/** 项目起点模式 */


/** Advisory 建议类型 */
export type RecommendationType =
  | 'add_paper'
  | 'merge_concepts'
  | 'split_concept'
  | 'review_mapping'
  | 'fill_evidence_gap'
  | 'general';

/** 概念成熟度 */
export type Maturity = 'tentative' | 'working' | 'established';

/** 概念定义变更类型 */
export type ConceptChangeType = 'additive' | 'breaking';

/** 概念历史变更事件类型 */
export type ConceptHistoryEventType =
  | 'created'
  | 'definition_refined'
  | 'keywords_added'
  | 'keywords_removed'
  | 'maturity_upgraded'
  | 'maturity_downgraded'
  | 'layer_changed'
  | 'parent_changed'
  | 'merged_from'
  | 'split_into'
  | 'deprecated';

/** Advisory 通知卡片类型 */
export type AdvisoryNotificationType =
  | 'concept_suggestion'
  | 'coverage_gap'
  | 'maturity_upgrade'
  | 'high_rejection'
  | 'stale_synthesis';
