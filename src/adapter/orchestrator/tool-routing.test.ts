import { describe, expect, it } from 'vitest';
import { routeToolFamilies } from './tool-routing';

describe('tool routing', () => {
  it('routes provider availability checks to config diagnostics', () => {
    const route = routeToolFamilies({
      userMessage: '测试 Google API 是否可用，检查 gemini key 是否配置正确',
      gateType: 'task-execution',
    });

    expect(route.primaryFamily).toBe('config_diagnostic');
    expect(route.allowedFamilies).toContain('config_diagnostic');
    expect(route.allowedFamilies).not.toContain('retrieval_search');
  });

  it('routes explicit search requests to retrieval tools', () => {
    const route = routeToolFamilies({
      userMessage: '帮我搜索和检索关于扩散模型的论文证据',
      gateType: 'focused-analysis',
    });

    expect(route.primaryFamily).toBe('retrieval_search');
    expect(route.allowedFamilies).toEqual(['retrieval_search', 'research_qa']);
  });

  it('routes drafting requests to writing tools', () => {
    const route = routeToolFamilies({
      userMessage: '根据现有 findings 写一个技术综述草稿',
      gateType: 'task-execution',
    });

    expect(route.primaryFamily).toBe('writing_edit');
    expect(route.allowedFamilies).toContain('writing_edit');
  });
});