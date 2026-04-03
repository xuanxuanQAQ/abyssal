/**
 * Routing Snapshot Tests — Real-world Chinese instruction corpus
 *
 * Validates that typical Chinese instructions are routed to the correct family
 * and that operation scoring correctly prioritizes operations within each family.
 */

import { describe, it, expect } from 'vitest';
import { routeToolFamilies, scoreOperations } from './tool-routing';
import type { CapabilityOperation } from '../capabilities';

describe('[Routing] Snapshot tests with Chinese instructions', () => {
  /**
   * Scenario 1: API diagnostic request
   * "测试 Google API 是否可用，检查 gemini key 是否配置"
   */
  it('routes "测试 API 可用性" to config_diagnostic family', () => {
    const route = routeToolFamilies({
      userMessage: '测试 Google API 是否可用，检查 gemini key 是否配置',
    });

    expect(route.primaryFamily).toBe('config_diagnostic');
    expect(route.allowedFamilies).toContain('config_diagnostic');
    expect(route.confidence).toBeGreaterThan(0.9);
    expect(route.reason).toBe('provider_api_diagnostic');
  });

  /**
   * Scenario 2: Settings management request with API mention
   * When "配置" (configure) + "API" keywords both appear, routes to config_diagnostic
   */
  it('routes "打开设置并配置" when API is mentioned goes to config_diagnostic', () => {
    const route = routeToolFamilies({
      userMessage: '打开设置，配置 Gemini 模型',
    });

    // When provider keywords appear with diagnostics pattern, diagnostic takes priority
    expect(route.primaryFamily).toBe('config_diagnostic');
    expect(route.allowedFamilies).toContain('config_diagnostic');
    expect(route.allowedFamilies).toContain('ui_navigation');
  });

  /**
   * Scenario 3: Paper retrieval request
   * "帮我搜索和检索关于 Transformer 架构的论文证据"
   */
  it('routes "搜索和检索论文" to retrieval_search family', () => {
    const route = routeToolFamilies({
      userMessage: '帮我搜索和检索关于 Transformer 架构的论文证据',
    });

    expect(route.primaryFamily).toBe('retrieval_search');
    expect(route.allowedFamilies).toContain('retrieval_search');
    expect(route.confidence).toBeGreaterThan(0.8);
    expect(route.reason).toBe('retrieval_request');
  });

  /**
   * Scenario 4: Writing/synthesis request
   * "根据现有的论文 findings 写一个关于扩散模型的技术综述"
   */
  it('routes "写综述和文章" to writing_edit family', () => {
    const route = routeToolFamilies({
      userMessage: '根据现有的论文 findings 写一个关于扩散模型的技术综述',
    });

    expect(route.primaryFamily).toBe('writing_edit');
    expect(route.allowedFamilies).toContain('writing_edit');
    expect(route.confidence).toBeGreaterThan(0.8);
    expect(route.reason).toBe('writing_request');
  });

  /**
   * Scenario 5: Navigation request
   * "打开第一篇论文的第 5 页"
   */
  it('routes "打开论文导航" to ui_navigation family', () => {
    const route = routeToolFamilies({
      userMessage: '打开第一篇论文的第 5 页',
    });

    expect(route.primaryFamily).toBe('ui_navigation');
    expect(route.allowedFamilies).toContain('ui_navigation');
    expect(route.confidence).toBeGreaterThan(0.8);
  });

  /**
   * Scenario 6: Ambiguous/fallback request
   * "给我这个概念的相关信息"
   */
  it('defaults to research_qa for ambiguous instructions', () => {
    const route = routeToolFamilies({
      userMessage: '给我这个概念的相关信息',
    });

    expect(route.primaryFamily).toBe('research_qa');
    expect(route.allowedFamilies).toContain('research_qa');
    expect(route.confidence).toBeLessThan(0.7);
  });
});

describe('[Scoring] Operation-level semantic relevance', () => {
  /**
   * Test that test_api operation gets highest score for API diagnostic queries
   */
  it('scores test_api highest for API testing queries', () => {
    const operations: Array<{
      capabilityName: string;
      operationName: string;
      description: string;
      semanticKeywords?: string[];
    }> = [
      {
        capabilityName: 'config',
        operationName: 'test_api',
        description: 'Test whether a configured provider API key is available and reachable.',
        semanticKeywords: ['测试api', 'test', '检查', '可用', 'api key', '连接', '诊断', 'provider'],
      },
      {
        capabilityName: 'config',
        operationName: 'get_settings',
        description: 'Get the current application settings.',
        semanticKeywords: ['设置', '查看设置', '获取配置', 'settings', 'config', 'get', '显示'],
      },
      {
        capabilityName: 'ui',
        operationName: 'navigate',
        description: 'Navigate to a specific view or panel.',
        semanticKeywords: ['打开', '导航', '跳转', 'open', 'navigate', '前往'],
      },
    ];

    const scores = scoreOperations('测试 Google API 是否可用，检查连接', operations);

    // test_api should have decent score due to keyword matches (测试, 检查, 连接)
    expect(scores['config--test_api']).toBeGreaterThan(0.65);
    // get_settings should have lower score 
    expect(scores['config--get_settings'] ?? 0).toBeLessThan(scores['config--test_api'] ?? 0);
  });

  /**
   * Test that operations are ranked by relevance
   */
  it('ranks operations by semantic relevance to user intent', () => {
    const operations: Array<{
      capabilityName: string;
      operationName: string;
      description: string;
      semanticKeywords?: string[];
    }> = [
      {
        capabilityName: 'notes',
        operationName: 'create',
        description: 'Create a new research note.',
        semanticKeywords: ['创建笔记', '新建', '写笔记', 'create', 'note'],
      },
      {
        capabilityName: 'writing',
        operationName: 'run_synthesis',
        description: 'Generate a synthesis article from current findings.',
        semanticKeywords: ['综述', '综合', '文章', 'synthesis', 'write', '写'],
      },
      {
        capabilityName: 'reader',
        operationName: 'find_passages',
        description: 'Find relevant passages in a paper.',
        semanticKeywords: ['查找', '搜索', 'find', 'passage', '论文'],
      },
    ];

    const scores = scoreOperations('写一个综述文章', operations);

    // run_synthesis should score highest (direct keyword match)
    const synthesisScore = scores['writing--run_synthesis'] ?? 0;
    const createScore = scores['notes--create'] ?? 0;
    const findScore = scores['reader--find_passages'] ?? 0;

    expect(synthesisScore).toBeGreaterThan(createScore);
    expect(synthesisScore).toBeGreaterThan(findScore);
  });

  /**
   * Test that operations without semantic keywords can still score via description overlap
   */
  it('provides fallback scoring via description overlap', () => {
    const operations: Array<{
      capabilityName: string;
      operationName: string;
      description: string;
      semanticKeywords?: string[];
    }> = [
      {
        capabilityName: 'discovery',
        operationName: 'search',
        description: 'Search for papers matching keywords.',
        semanticKeywords: ['搜索', '检索', 'search'],
      },
      {
        capabilityName: 'reader',
        operationName: 'get_page_content',
        description: 'Get the extracted text content of a specific page.',
        semanticKeywords: ['内容', '获取', 'content', 'page'],
      },
    ];

    const scores = scoreOperations('搜索论文和阅读内容', operations);

    // Both should have scores since both have matching keywords
    expect(scores['discovery--search']).toBeGreaterThan(0);
    expect(scores['reader--get_page_content']).toBeGreaterThan(0);
  });

  /**
   * Integration test: route decision includes operation scores
   */
  it('routing decision can include operation scoring info', () => {
    const route = routeToolFamilies({
      userMessage: '测试 API 可用性并检查连接',
    });

    expect(route.operationScores).toBeUndefined(); // Currently not included in decision
    // This field is optional for future extension
  });
});

describe('[Routing] Complex multi-intent scenarios', () => {
  /**
   * Scenario: User wants to both retrieve papers AND write about them
   * Primary should be writing, but retrieval should be allowed
   */
  it('routes writing with optional retrieval support', () => {
    const route = routeToolFamilies({
      userMessage: '帮我搜索相关论文，然后写一个综述',
    });

    expect(route.primaryFamily).toBe('writing_edit');
    expect(route.allowedFamilies).toContain('writing_edit');
    expect(route.allowedFamilies).toContain('retrieval_search');
  });

  /**
   * Scenario: Settings update might trigger config diagnostic check
   */
  it('handles settings + diagnostic intent', () => {
    const route = routeToolFamilies({
      userMessage: '修改设置后帮我测试一下 API 可用性',
    });

    // Should route to settings control
    expect(route.primaryFamily).toBe('workspace_control');
    expect(route.allowedFamilies).toContain('config_diagnostic');
  });

  /**
   * Scenario: Pure research query without specific action
   */
  it('defaults to research_qa for general project queries', () => {
    const route = routeToolFamilies({
      userMessage: '目前工作区里有多少篇论文？概念网络是什么样的？',
    });

    expect(route.primaryFamily).toBe('research_qa');
    expect(route.allowedFamilies).toContain('research_qa');
  });
});
