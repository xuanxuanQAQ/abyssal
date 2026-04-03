import type { ChatContext } from '../../shared-types/ipc';
import type { ToolRouteFamily } from '../capabilities';

export interface ToolRouteDecision {
  primaryFamily: ToolRouteFamily;
  allowedFamilies: ToolRouteFamily[];
  confidence: number;
  reason: string;
  /** Semantic relevance scores for operation matching (capability--operation) */
  operationScores?: Record<string, number>;
}

interface RouteInput {
  userMessage: string;
  chatContext?: ChatContext;
  gateType?: string;
}

function hasPattern(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function routeToolFamilies(input: RouteInput): ToolRouteDecision {
  const text = `${input.userMessage}\n${input.chatContext?.selectedQuote ?? ''}`.toLowerCase();
  const providerPattern = /google api|gemini|openai|anthropic|deepseek|cohere|jina|siliconflow|tavily|api key|apikey|token|密钥|令牌|provider|模型供应商/;
  const diagnosticPattern = /测试|test|检查|check|verify|诊断|diagnos|可用|可达|连通|401|403|配置|settings|设置|连接/;
  const settingsPattern = /设置|settings|配置|切换模型|更改模型|update setting|change setting|turn on|turn off|启用|禁用|修改配置/;
  const navigationPattern = /打开|切到|跳转|导航|show me|open|go to|navigate|focus|定位|前往/;
  const writingPattern = /写|撰写|草稿|draft|outline|提纲|文章|综述|note|memo|总结成文/;
  const retrievalPattern = /搜索|检索|查找|找论文|找证据|lookup|search|retrieve|find passages|semantic search|rag/;
  const controlPattern = /运行|执行|启动|导入|下载|获取全文|acquire|analy[sz]e|synthesi[sz]e|pipeline|创建|更新|保存/;

  if (hasPattern(text, providerPattern) && hasPattern(text, diagnosticPattern)) {
    return {
      primaryFamily: 'config_diagnostic',
      allowedFamilies: ['config_diagnostic', 'ui_navigation'],
      confidence: 0.97,
      reason: 'provider_api_diagnostic',
    };
  }

  if (hasPattern(text, settingsPattern)) {
    return {
      primaryFamily: 'workspace_control',
      allowedFamilies: ['workspace_control', 'config_diagnostic', 'ui_navigation'],
      confidence: 0.9,
      reason: 'settings_or_control_request',
    };
  }

  if (hasPattern(text, navigationPattern) && !hasPattern(text, retrievalPattern)) {
    return {
      primaryFamily: 'ui_navigation',
      allowedFamilies: ['ui_navigation', 'workspace_control'],
      confidence: 0.85,
      reason: 'ui_navigation_request',
    };
  }

  if (hasPattern(text, writingPattern)) {
    return {
      primaryFamily: 'writing_edit',
      allowedFamilies: ['writing_edit', 'research_qa', 'retrieval_search'],
      confidence: 0.82,
      reason: 'writing_request',
    };
  }

  if (hasPattern(text, retrievalPattern)) {
    return {
      primaryFamily: 'retrieval_search',
      allowedFamilies: ['retrieval_search', 'research_qa'],
      confidence: 0.83,
      reason: 'retrieval_request',
    };
  }

  if (input.gateType === 'task-execution' && hasPattern(text, controlPattern)) {
    return {
      primaryFamily: 'workspace_control',
      allowedFamilies: ['workspace_control', 'ui_navigation', 'config_diagnostic'],
      confidence: 0.78,
      reason: 'task_execution_control',
    };
  }

  return {
    primaryFamily: 'research_qa',
    allowedFamilies: ['research_qa', 'retrieval_search', 'writing_edit'],
    confidence: 0.62,
    reason: 'default_research_qa',
  };
}

export function buildToolRouteInstruction(route: ToolRouteDecision): string {
  switch (route.primaryFamily) {
    case 'config_diagnostic':
      return '当前工具路由: config_diagnostic。优先使用配置/诊断类工具验证提供商、API key、连接状态；不要改用论文搜索或知识检索来替代 API 连通性检查。';
    case 'workspace_control':
      return '当前工具路由: workspace_control。优先使用会触发应用动作、工作流、设置更新或界面控制的工具；只有在动作需要证据时再使用检索。';
    case 'ui_navigation':
      return '当前工具路由: ui_navigation。优先使用导航、聚焦、打开视图等界面控制工具。';
    case 'writing_edit':
      return '当前工具路由: writing_edit。优先使用写作、笔记、草稿生成相关工具；必要时可辅以检索。';
    case 'retrieval_search':
      return '当前工具路由: retrieval_search。优先使用搜索、RAG、语义检索与 passage 检索工具。';
    default:
      return '当前工具路由: research_qa。优先使用研究问答、项目查询和证据整合工具。';
  }
}

/**
 * Score operations based on semantic keyword matching with user message.
 * Returns a mapping of 'capability--operation' → relevance score (0-1).
 */
export function scoreOperations(
  userMessage: string,
  operationsWithKeywords: Array<{
    capabilityName: string;
    operationName: string;
    description: string;
    semanticKeywords?: string[];
  }>,
): Record<string, number> {
  const msgLower = userMessage.toLowerCase();
  const scores: Record<string, number> = {};

  for (const op of operationsWithKeywords) {
    const opKey = `${op.capabilityName}--${op.operationName}`;
    
    // Keyword matching: check if operation's semantic keywords appear in message
    let keywordScore = 0;
    if (op.semanticKeywords && op.semanticKeywords.length > 0) {
      const matchedIndices = op.semanticKeywords
        .map((kw, idx) => (msgLower.includes(kw.toLowerCase()) ? idx : -1))
        .filter((idx) => idx >= 0);

      if (matchedIndices.length > 0) {
        // Score based on how many high-priority keywords matched
        // First keyword worth most, subsequent worth less
        const weightedScore = matchedIndices.reduce((sum, idx) => {
          const priorityFactor = 1 - (idx / op.semanticKeywords!.length) * 0.2;
          return sum + priorityFactor;
        }, 0);
        // Normalize by number of matched keywords
        keywordScore = Math.min(1, weightedScore / matchedIndices.length);
      }
    }

    // Description overlap: check word overlap between operation description and message
    const descWords = op.description.toLowerCase().split(/\s+/);
    const msgWords = msgLower.split(/\s+/);
    const overlap = descWords.filter(
      (w) => msgWords.some((mw) => mw.includes(w) || w.includes(mw)) && w.length > 2,
    ).length;
    const descriptionScore = Math.min(1, overlap / Math.max(1, descWords.length / 3));

    // Combine: prefer keyword match, but description overlap as fallback
    // If we have keywords, use those; otherwise use description score
    scores[opKey] = keywordScore > 0 ? keywordScore : Math.min(1, descriptionScore * 0.4);
  }

  return scores;
}