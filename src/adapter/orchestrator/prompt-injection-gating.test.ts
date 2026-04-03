import { describe, it, expect } from 'vitest';
import { classifyPromptGate, bundleIncludes } from './prompt-injection-gating';

// ─── Helper ───────────────────────────────────────────────────────────────────

function gate(msg: string, hasRecentSelection = false) {
  return classifyPromptGate({ userMessage: msg, hasRecentSelection });
}

// ─── Gate classification ───────────────────────────────────────────────────────

describe('classifyPromptGate — greeting', () => {
  it('classifies short greeting', () => {
    const result = gate('你好');
    expect(result.type).toBe('greeting');
    expect(result.usedRule).toBe(true);
  });

  it('greeting bundles: project_meta + capability_hints only', () => {
    const { bundles } = gate('Hello!');
    expect(bundles).toContain('project_meta');
    expect(bundles).toContain('capability_hints');
    expect(bundles).not.toContain('active_focus');
    expect(bundles).not.toContain('working_memory_light');
    expect(bundles).not.toContain('working_memory_full');
    expect(bundles).not.toContain('selection_context');
    expect(bundles).not.toContain('recent_activity');
  });

  it('greeting: does NOT inject selection_context even when hasRecentSelection=true', () => {
    const { bundles } = gate('你好', true);
    expect(bundles).not.toContain('selection_context');
  });
});

describe('classifyPromptGate — ui-help', () => {
  it('classifies UI help question', () => {
      const { type } = gate('设置面板在哪里？');
    expect(type).toBe('ui-help');
  });

  it('ui-help: does NOT inject selection_context from implicit recent selection', () => {
      const { bundles } = gate('设置面板在哪里？', true);
    expect(bundles).not.toContain('selection_context');
  });

  it('ui-help: DOES inject selection_context when user explicitly mentions selection', () => {
      const { bundles } = gate('这段 selected 文字怎么操作？', false);
    expect(bundles).toContain('selection_context');
  });
});

describe('classifyPromptGate — quick-fact', () => {
  it('classifies definition question', () => {
    const { type } = gate('风险溢出是什么意思？');
    expect(type).toBe('quick-fact');
  });

  it('quick-fact: does NOT inject selection_context from implicit recent selection', () => {
    const { bundles } = gate('风险溢出是什么意思？', true);
    expect(bundles).not.toContain('selection_context');
  });
});

describe('classifyPromptGate — focused-analysis', () => {
  it('implicit selection available → injects selection_context', () => {
    const { bundles } = gate('帮我分析一下这篇论文的实验设计', true);
    expect(bundles).toContain('selection_context');
  });

  it('no recent selection → does not inject selection_context', () => {
    const { bundles } = gate('帮我分析一下这篇论文的实验设计', false);
    expect(bundles).not.toContain('selection_context');
  });

  it('includes active_focus and working_memory_light', () => {
    const { bundles } = gate('分析这个模型的因果识别策略', false);
    expect(bundles).toContain('active_focus');
    expect(bundles).toContain('working_memory_light');
  });
});

describe('classifyPromptGate — cross-paper-synthesis', () => {
  it('classifies synthesis request', () => {
    const { type } = gate('比较这三篇论文的方法论');
    expect(type).toBe('cross-paper-synthesis');
  });

  it('implicit selection → injects selection_context', () => {
    const { bundles } = gate('综述这几篇论文', true);
    expect(bundles).toContain('selection_context');
  });

  it('includes working_memory_full and recent_activity', () => {
    const { bundles } = gate('对比这些文献的结论', false);
    expect(bundles).toContain('working_memory_full');
    expect(bundles).toContain('recent_activity');
  });
});

describe('classifyPromptGate — task-execution', () => {
  it('classifies explicit task', () => {
    const { type } = gate('搜索 causal inference 相关论文并导入');
    expect(type).toBe('task-execution');
  });

  it('task-execution: does NOT inject selection_context from implicit recent selection', () => {
    const { bundles } = gate('创建一个新笔记', true);
    expect(bundles).not.toContain('selection_context');
  });
});

// ─── bundleIncludes helper ────────────────────────────────────────────────────

describe('bundleIncludes', () => {
  it('returns true when bundle is present', () => {
    expect(bundleIncludes(['project_meta', 'active_focus'], 'active_focus')).toBe(true);
  });

  it('returns false when bundle is absent', () => {
    expect(bundleIncludes(['project_meta'], 'selection_context')).toBe(false);
  });
});
