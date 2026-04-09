import type { ChatContext } from '../../shared-types/ipc';
import type { SystemPromptBundle } from '../agent-loop/system-prompt-builder';

export type PromptGateType =
  | 'assistant-profile'
  | 'greeting'
  | 'smalltalk'
  | 'ui-help'
  | 'quick-fact'
  | 'focused-analysis'
  | 'cross-paper-synthesis'
  | 'task-execution';

export type SessionPromptBundle =
  | 'recent_activity'
  | 'working_memory_light'
  | 'working_memory_full'
  | 'selection_context';

export type InjectionBundle = SystemPromptBundle | SessionPromptBundle;

export interface PromptGateDecision {
  type: PromptGateType;
  confidence: number;
  bundles: InjectionBundle[];
  usedRule: boolean;
}

interface ScoreBoard {
  social: number;
  action: number;
  analysis: number;
  ui: number;
  deepSynthesis: number;
  quickFact: number;
}

const GREETING_RE = /^(?:\s*)(?:hi|hello|hey|你好|您好|在吗|哈喽|早上好|中午好|晚上好|yo|sup)(?:\s*[!！?.。]*)$/i;
const ASSISTANT_PROFILE_RE = /^(?:\s*)(?:(?:请问|想问下)?\s*)?(?:你是谁|你是做什么的|你能做什么|你可以做什么|能帮我做什么|介绍一下你自己|who are you|what can you do|what do you do|introduce yourself)(?:\s*[?？!！.。]*)$/i;
const SMALLTALK_RE = /(天气|心情|状态|最近怎么样|how are you|what's up|聊聊)/i;
const UI_HELP_RE = /(怎么|在哪|哪里|设置|导出|导入|按钮|面板|功能|操作|无法|报错|卡住|打不开|无法运行|how to|setting|export|import|ui|panel)/i;
const CROSS_SYNTHESIS_RE = /(比较|对比|综述|综\s*合|synthesi[sz]e|review|survey|across papers|cross paper)/i;
const TASK_EXEC_RE = /(帮我|请|创建|新建|生成|搜索|检索|写入|导出|下载|整理|提纲|计划|run|execute|create|search|import|write|download)/i;
const QUICK_FACT_RE = /(是什么|什么意思|定义|概念|解释一下|what is|define|meaning)/i;
const RESEARCH_RE = /(论文|文献|方法|实验|结论|risk spillover|causal|因果|模型|指标|概念|研究)/i;
const SELECTION_REF_RE = /(这段|选中|高亮|划线|selected|selection|highlight|quoted|引用的段落)/i;

const BUNDLE_MAP: Record<PromptGateType, InjectionBundle[]> = {
  'assistant-profile': ['project_meta', 'capability_hints'],
  greeting: [],
  smalltalk: [],
  'ui-help': ['project_meta', 'capability_hints'],
  'quick-fact': ['project_meta', 'active_focus'],
  'focused-analysis': ['project_meta', 'active_focus', 'working_memory_light'],
  'cross-paper-synthesis': ['project_meta', 'active_focus', 'recent_activity', 'working_memory_full'],
  'task-execution': ['project_meta', 'active_focus', 'capability_hints'],
};

export interface PromptGateInputs {
  userMessage: string;
  chatContext?: ChatContext;
  hasRecentSelection: boolean;
}

export function classifyPromptGate(inputs: PromptGateInputs): PromptGateDecision {
  const text = inputs.userMessage.trim();
  const lowered = text.toLowerCase();

  if (text.length <= 48 && ASSISTANT_PROFILE_RE.test(text)) {
    return finalize({ type: 'assistant-profile', confidence: 0.99, bundles: BUNDLE_MAP['assistant-profile'], usedRule: true }, inputs);
  }

  if (text.length <= 24 && GREETING_RE.test(text)) {
    return finalize({ type: 'greeting', confidence: 0.98, bundles: BUNDLE_MAP.greeting, usedRule: true }, inputs);
  }

  if (CROSS_SYNTHESIS_RE.test(text)) {
    return finalize({ type: 'cross-paper-synthesis', confidence: 0.95, bundles: BUNDLE_MAP['cross-paper-synthesis'], usedRule: true }, inputs);
  }

  if (TASK_EXEC_RE.test(text) && /创建|新建|生成|搜索|检索|导出|下载|import|create|execute|search|write|download/i.test(text)) {
    return finalize({ type: 'task-execution', confidence: 0.92, bundles: BUNDLE_MAP['task-execution'], usedRule: true }, inputs);
  }

  if (UI_HELP_RE.test(text) && !RESEARCH_RE.test(text)) {
    return finalize({ type: 'ui-help', confidence: 0.9, bundles: BUNDLE_MAP['ui-help'], usedRule: true }, inputs);
  }

  if (QUICK_FACT_RE.test(text) && text.length <= 48) {
    return finalize({ type: 'quick-fact', confidence: 0.86, bundles: BUNDLE_MAP['quick-fact'], usedRule: true }, inputs);
  }

  if (SMALLTALK_RE.test(text)) {
    return finalize({ type: 'smalltalk', confidence: 0.84, bundles: BUNDLE_MAP.smalltalk, usedRule: true }, inputs);
  }

  const scores: ScoreBoard = {
    social: 0,
    action: 0,
    analysis: 0,
    ui: 0,
    deepSynthesis: 0,
    quickFact: 0,
  };

  if (text.length <= 20) scores.social += 0.2;
  if (RESEARCH_RE.test(lowered)) scores.analysis += 0.35;
  if (TASK_EXEC_RE.test(lowered)) scores.action += 0.28;
  if (UI_HELP_RE.test(lowered)) scores.ui += 0.35;
  if (CROSS_SYNTHESIS_RE.test(lowered)) scores.deepSynthesis += 0.5;
  if (QUICK_FACT_RE.test(lowered)) scores.quickFact += 0.4;
  if (inputs.chatContext?.selectedPaperId || inputs.chatContext?.selectedConceptId || inputs.chatContext?.selectedPaperIds?.length) {
    scores.analysis += 0.18;
  }

  let type: PromptGateType = 'focused-analysis';
  let confidence = 0.68;

  const ranked = [
    { type: 'cross-paper-synthesis' as const, score: scores.deepSynthesis },
    { type: 'task-execution' as const, score: scores.action },
    { type: 'ui-help' as const, score: scores.ui },
    { type: 'quick-fact' as const, score: scores.quickFact },
    { type: 'smalltalk' as const, score: scores.social },
    { type: 'focused-analysis' as const, score: scores.analysis + 0.2 },
  ].sort((a, b) => b.score - a.score);

  if (ranked[0] && ranked[0].score >= 0.32) {
    type = ranked[0].type;
    confidence = Math.min(0.86, 0.55 + ranked[0].score);
  }

  const baseBundles = BUNDLE_MAP[type];
  const conservativeBundles = confidence < 0.62
    ? baseBundles.filter((b) => b !== 'working_memory_full' && b !== 'recent_activity')
    : baseBundles;

  return finalize(
    {
      type,
      confidence,
      bundles: conservativeBundles,
      usedRule: false,
    },
    inputs,
  );
}

function finalize(decision: PromptGateDecision, inputs: PromptGateInputs): PromptGateDecision {
  const bundles = new Set(decision.bundles);

  // Positive allowlist: explicit mention allows all non-social types;
  // implicit (hasRecentSelection) only benefits deep analysis types.
  const IMPLICIT_SELECTION_TYPES = new Set<PromptGateType>(['focused-analysis', 'cross-paper-synthesis']);
  const mentionsSelection = SELECTION_REF_RE.test(inputs.userMessage);
  if (mentionsSelection && decision.type !== 'greeting' && decision.type !== 'smalltalk') {
    bundles.add('selection_context');
  } else if (!mentionsSelection && inputs.hasRecentSelection && IMPLICIT_SELECTION_TYPES.has(decision.type)) {
    bundles.add('selection_context');
  }

  if (decision.type === 'task-execution' && /比较|对比|synthesi[sz]e|review|综述/i.test(inputs.userMessage)) {
    bundles.add('working_memory_light');
  }

  if ((decision.type === 'greeting' || decision.type === 'smalltalk' || decision.type === 'assistant-profile') && bundles.has('active_focus')) {
    bundles.delete('active_focus');
  }

  return {
    ...decision,
    bundles: Array.from(bundles),
  };
}

export function bundleIncludes(bundles: InjectionBundle[], target: InjectionBundle): boolean {
  return bundles.includes(target);
}
