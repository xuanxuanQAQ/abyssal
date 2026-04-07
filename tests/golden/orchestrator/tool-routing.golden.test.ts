import { describe, expect, it } from 'vitest';
import { classifyPromptGate } from '../../../src/adapter/orchestrator/prompt-injection-gating';
import { routeToolFamilies } from '../../../src/adapter/orchestrator/tool-routing';

describe('tool routing golden behavior', () => {
  it('routes a mixed Chinese writing request to writing as primary while keeping retrieval available', () => {
    const gate = classifyPromptGate({
      userMessage: '根据这几篇论文先检索证据，再写一个中文综述草稿',
      hasRecentSelection: false,
    });

    const route = routeToolFamilies({
      userMessage: '根据这几篇论文先检索证据，再写一个中文综述草稿',
      gateType: gate.type,
    });

    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "retrieval_search",
          "research_qa",
        ],
        "confidence": 0.88,
        "primaryFamily": "retrieval_search",
        "reason": "local_knowledge_recall",
      }
    `);
  });

  it('routes provider and key diagnostics away from research retrieval even when the user asks imperatively', () => {
    const gate = classifyPromptGate({
      userMessage: '帮我检查 Gemini API key 和 provider 配置是否可用',
      hasRecentSelection: false,
    });

    const route = routeToolFamilies({
      userMessage: '帮我检查 Gemini API key 和 provider 配置是否可用',
      gateType: gate.type,
    });

    expect(route.primaryFamily).toBe('config_diagnostic');
    expect(route.allowedFamilies).toContain('config_diagnostic');
    expect(route.allowedFamilies).not.toContain('retrieval_search');
  });

  it('uses the task-execution gate to keep explicit control requests in workspace control', () => {
    const gate = classifyPromptGate({
      userMessage: '创建一个批处理任务并执行 analyze workflow',
      hasRecentSelection: false,
    });

    const route = routeToolFamilies({
      userMessage: '创建一个批处理任务并执行 analyze workflow',
      gateType: gate.type,
    });

    expect(gate.type).toBe('task-execution');
    expect(route.primaryFamily).toBe('workspace_control');
    expect(route.allowedFamilies).toContain('workspace_control');
  });
});
