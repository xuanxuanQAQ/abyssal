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

// ── Pre-compiled routing patterns (module scope, compiled once) ──────

const PROVIDER_PATTERN = /google api|gemini|openai|anthropic|deepseek|cohere|jina|siliconflow|tavily|api key|apikey|token|密钥|令牌|provider|模型供应商/;
const DIAGNOSTIC_PATTERN = /测试|test|检查|check|verify|诊断|diagnos|可用|可达|连通|401|403|配置|settings|设置|连接/;
const SETTINGS_PATTERN = /设置|settings|配置|切换模型|更改模型|update setting|change setting|turn on|turn off|启用|禁用|修改配置/;
const NAVIGATION_PATTERN = /打开|切到|跳转|导航|show me|open|go to|navigate|focus|定位|前往/;
const NOTE_MEMO_PATTERN = /笔记|memo|记录一下|记个|研究笔记|note(?!.*paper)|随手记|备忘/;
const WRITING_PATTERN = /撰写|草稿|draft|outline|提纲|综述|总结成文|写作|写(?:一篇|篇|个|出|成|完)/;
const CONTROL_PATTERN = /运行|执行|启动|导入|下载|获取全文|acquire|analy[sz]e|synthesi[sz]e|pipeline|创建|更新|保存/;

// Search intent signals
const ONLINE_MARKERS = /在线|网上|online|数据库|database|arxiv|scholar|openalex|下载论文|下载全文|下载pdf|download paper|download fulltext/;
const LOCAL_MARKERS = /我的|库里|本地|local|已有|existing|library|知识库|笔记里|我的文献/;
const FIND_PAPER_PATTERN = /(?:搜索|查找|找|search|find|look\s*up).*?(?:论文|文章|文献|paper|article)/;
const RECALL_PATTERN = /(?:检索|retrieve|回顾|recall|证据|evidence|passage).*?(?:内容|content|信息|info|观点|argument|证据|evidence)|(?:内容|证据|观点|信息).*?(?:检索|retrieve|recall)/;
const GENERIC_SEARCH_PATTERN = /搜索|检索|查找|找论文|找证据|lookup|search|retrieve|find passages|semantic search|rag/;
const FILLER_PATTERN = /帮我|请|一下|吧|呢/g;
const CONTINUATION_PATTERN = /^[,，、。；！？\-—]|^(?:然后|之后|再|并且|接着|同时|以及|并|来)/;

export function routeToolFamilies(input: RouteInput): ToolRouteDecision {
  const text = `${input.userMessage}\n${input.chatContext?.selectedQuote ?? ''}`.toLowerCase();

  // Strip search verb + paper noun to isolate the actual query payload
  const queryPayload = text
    .replace(FILLER_PATTERN, '')
    .replace(FIND_PAPER_PATTERN, '')
    .replace(GENERIC_SEARCH_PATTERN, '')
    .trim();
  // A "substantial query" must be long enough AND look like a paper title —
  // not a continuation clause starting with punctuation or conjunctions.
  const hasSubstantialQuery =
    queryPayload.length > 6 && !CONTINUATION_PATTERN.test(queryPayload);

  if (hasPattern(text, PROVIDER_PATTERN) && hasPattern(text, DIAGNOSTIC_PATTERN)) {
    return {
      primaryFamily: 'config_diagnostic',
      allowedFamilies: ['config_diagnostic', 'ui_navigation'],
      confidence: 0.97,
      reason: 'provider_api_diagnostic',
    };
  }

  if (hasPattern(text, SETTINGS_PATTERN)) {
    return {
      primaryFamily: 'workspace_control',
      allowedFamilies: ['workspace_control', 'config_diagnostic', 'ui_navigation'],
      confidence: 0.9,
      reason: 'settings_or_control_request',
    };
  }

  if (hasPattern(text, NAVIGATION_PATTERN) && !hasPattern(text, GENERIC_SEARCH_PATTERN)) {
    return {
      primaryFamily: 'ui_navigation',
      allowedFamilies: ['ui_navigation', 'workspace_control'],
      confidence: 0.85,
      reason: 'ui_navigation_request',
    };
  }

  // ── Search routing: 3-way split ────────────────────────────────────
  // Ordered by confidence. Checked BEFORE writing to avoid "文章" in
  // "搜索这篇文章 XXX" being swallowed by WRITING_PATTERN.

  // Explicit online markers → online discovery only
  if (hasPattern(text, ONLINE_MARKERS)) {
    return {
      primaryFamily: 'discovery_online',
      allowedFamilies: ['discovery_online', 'workspace_control'],
      confidence: 0.95,
      reason: 'explicit_online_search',
    };
  }

  // Explicit local markers → local retrieval only
  if (hasPattern(text, LOCAL_MARKERS) && hasPattern(text, GENERIC_SEARCH_PATTERN)) {
    return {
      primaryFamily: 'retrieval_search',
      allowedFamilies: ['retrieval_search', 'research_qa'],
      confidence: 0.93,
      reason: 'explicit_local_search',
    };
  }

  // "搜索/找 + 论文/文章" with a substantial title/query → online discovery
  // e.g. "帮我搜索这篇文章 电力现货市场交易运营的未来重大需求与关键技术"
  if (hasPattern(text, FIND_PAPER_PATTERN) && hasSubstantialQuery) {
    return {
      primaryFamily: 'discovery_online',
      allowedFamilies: ['discovery_online', 'workspace_control'],
      confidence: 0.92,
      reason: 'find_specific_paper',
    };
  }

  // Recall/evidence pattern → local retrieval
  if (hasPattern(text, RECALL_PATTERN)) {
    return {
      primaryFamily: 'retrieval_search',
      allowedFamilies: ['retrieval_search', 'research_qa'],
      confidence: 0.88,
      reason: 'local_knowledge_recall',
    };
  }

  // ── Note / memo management ──────────────────────────────────────────
  if (hasPattern(text, NOTE_MEMO_PATTERN)) {
    return {
      primaryFamily: 'note_management',
      allowedFamilies: ['note_management', 'research_qa', 'retrieval_search'],
      confidence: 0.88,
      reason: 'note_memo_request',
    };
  }

  // ── Writing (article generation, drafting — not note-taking) ───────
  if (hasPattern(text, WRITING_PATTERN)) {
    return {
      primaryFamily: 'writing_edit',
      allowedFamilies: ['writing_edit', 'research_qa', 'retrieval_search'],
      confidence: 0.82,
      reason: 'writing_request',
    };
  }

  // Generic "搜索/检索" — ambiguous, include both but lean online via find_paper
  if (hasPattern(text, GENERIC_SEARCH_PATTERN)) {
    return {
      primaryFamily: 'discovery_online',
      allowedFamilies: ['discovery_online', 'retrieval_search', 'research_qa'],
      confidence: 0.78,
      reason: 'ambiguous_search',
    };
  }

  if (input.gateType === 'task-execution' && hasPattern(text, CONTROL_PATTERN)) {
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
      return '当前工具路由: writing_edit。优先使用写作、草稿生成、文章综述相关工具；必要时可辅以检索。不要使用笔记/备忘工具，除非用户明确要求记笔记。';
    case 'note_management':
      return '当前工具路由: note_management。用户想要管理研究笔记或备忘。对于简短内容优先使用 add_memo 而非 create（create 用于结构化长笔记）。';
    case 'discovery_online':
      return buildDiscoveryInstruction(route.reason);
    case 'retrieval_search':
      return '当前工具路由: retrieval_search。用户想从已有知识库中查找信息，优先使用本地语义检索(search_knowledge / retrieve)和论文查询(query_papers)工具。不要调用在线搜索。';
    default:
      return '当前工具路由: research_qa。优先使用研究问答、项目查询和证据整合工具。';
  }
}

function buildDiscoveryInstruction(reason: string): string {
  switch (reason) {
    case 'find_specific_paper':
      return '当前工具路由: discovery_online。用户想找到一篇特定论文。直接使用 `find_paper` — 它会自动查本地库 → 搜在线数据库 → 导入。一次调用即可完成，不要分步手动调 query_papers 再调 search_literature。';
    case 'explicit_online_search':
      return '当前工具路由: discovery_online。用户明确要求在线搜索。使用 `find_paper`（找特定论文）或 `search_literature`（探索主题），不要使用本地检索工具。';
    case 'ambiguous_search':
      return '当前工具路由: discovery_online（模糊意图）。用户说了"搜索"但未明确本地/在线。如果像是找特定论文，用 `find_paper`；如果像是探索主题，用 `search_literature`；如果是从已有文献中找答案，用 `search_knowledge`。';
    default:
      return '当前工具路由: discovery_online。优先使用在线文献发现工具(find_paper / search_literature)搜索学术数据库。';
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