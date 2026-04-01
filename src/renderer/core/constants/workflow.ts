/**
 * 工作流常量 — 跨组件共享
 */

import type { WorkflowType } from '../../../shared-types/enums';

/** 工作流 → i18n key 映射（用于 StatusBar / TaskDetailPopover） */
export const WORKFLOW_I18N_KEYS: Record<WorkflowType, string> = {
  discover: 'statusBar.workflows.discover',
  acquire: 'statusBar.workflows.acquire',
  process: 'statusBar.workflows.process',
  analyze: 'statusBar.workflows.analyze',
  synthesize: 'statusBar.workflows.synthesize',
  article: 'statusBar.workflows.article',
  bibliography: 'statusBar.workflows.bibliography',
  generate: 'statusBar.workflows.generate',
};

/** 工作流 → 中文显示名（用于非 i18n 场景，如 toast） */
export const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  discover: '文献发现',
  acquire: '全文获取',
  process: '处理',
  analyze: 'AI 分析',
  synthesize: '综合生成',
  article: '文章生成',
  bibliography: '参考文献',
  generate: '内容生成',
};
