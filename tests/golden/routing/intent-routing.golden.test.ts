/**
 * Golden tests — Chinese request → intent classification & tool routing.
 *
 * Freezes the routing table so that refactoring doesn't silently change
 * how user messages are classified and routed.
 */
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../../../src/copilot-runtime/intent-router';
import { routeToolFamilies } from '../../../src/adapter/orchestrator/tool-routing';
import { classifyPromptGate } from '../../../src/adapter/orchestrator/prompt-injection-gating';

const router = new IntentRouter();

function makeOp(prompt: string, overrides?: Record<string, unknown>) {
  return {
    id: 'op-1',
    sessionId: 'sess-1',
    surface: 'chat' as const,
    intent: 'ask' as const,
    prompt,
    context: {
      activeView: 'library' as const,
      workspaceId: 'ws-1',
      article: null,
      selection: null,
      focusEntities: { paperIds: [], conceptIds: [] },
      conversation: { recentTurns: [] },
      retrieval: { evidence: [] },
      writing: null,
      budget: { policy: 'standard' as const, tokenBudget: 4000, includedLayers: ['surface' as const, 'working' as const] },
      frozenAt: Date.now(),
    },
    outputTarget: { type: 'chat-message' as const },
    ...overrides,
  };
}

describe('intent routing golden — Chinese requests', () => {
  it('routes 改写 to rewrite-selection', async () => {
    const result = await router.classify(makeOp('帮我改写这段话'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.8999999999999999,
        "intent": "rewrite-selection",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 扩展 to expand-selection', async () => {
    const result = await router.classify(makeOp('请扩展这个段落'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.8999999999999999,
        "intent": "expand-selection",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 续写 to continue-writing', async () => {
    const result = await router.classify(makeOp('接着写下去'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.8999999999999999,
        "intent": "continue-writing",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 生成一节 to generate-section', async () => {
    const result = await router.classify(makeOp('生成方法论一节'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.87,
        "intent": "generate-section",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 检索证据 to retrieve-evidence', async () => {
    const result = await router.classify(makeOp('帮我检索关于可供性的证据'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.8099999999999999,
        "intent": "retrieve-evidence",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 审查论证 to review-argument', async () => {
    const result = await router.classify(makeOp('审查这篇论文的论证逻辑'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.8099999999999999,
        "intent": "review-argument",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 压缩选中内容 to compress-selection', async () => {
    const result = await router.classify(makeOp('压缩这段文字'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.8999999999999999,
        "intent": "compress-selection",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes unrecognized Chinese to ask (default)', async () => {
    const result = await router.classify(makeOp('这篇论文的主要贡献是什么？'));
    expect(result).toMatchInlineSnapshot(`
      {
        "ambiguous": false,
        "confidence": 0.8,
        "intent": "ask",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 带引用句子 to insert-citation-sentence', async () => {
    const result = await router.classify(makeOp('帮我写一个带引用的句子'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [
          {
            "confidence": 0.84,
            "intent": "draft-citation",
          },
        ],
        "ambiguous": true,
        "confidence": 0.87,
        "intent": "insert-citation-sentence",
        "outputTarget": {
          "type": "chat-message",
        },
      }
    `);
  });

  it('routes 导航 to navigate', async () => {
    const result = await router.classify(makeOp('跳转到图书馆'));
    expect(result).toMatchInlineSnapshot(`
      {
        "alternatives": [],
        "ambiguous": false,
        "confidence": 0.75,
        "intent": "navigate",
        "outputTarget": {
          "type": "navigate",
          "view": "library",
        },
      }
    `);
  });
});

describe('tool routing golden — Chinese requests', () => {
  it('routes provider diagnostic request', () => {
    const route = routeToolFamilies({
      userMessage: '测试一下 Anthropic API 是否可用',
    });
    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "config_diagnostic",
          "ui_navigation",
        ],
        "confidence": 0.97,
        "primaryFamily": "config_diagnostic",
        "reason": "provider_api_diagnostic",
      }
    `);
  });

  it('routes writing request with retrieval support', () => {
    const route = routeToolFamilies({
      userMessage: '根据这几篇论文写一个中文综述草稿',
    });
    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "writing_edit",
          "research_qa",
          "retrieval_search",
        ],
        "confidence": 0.82,
        "primaryFamily": "writing_edit",
        "reason": "writing_request",
      }
    `);
  });

  it('routes retrieval/search request', () => {
    const route = routeToolFamilies({
      userMessage: '搜索关于可供性理论的文献',
    });
    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "retrieval_search",
          "research_qa",
        ],
        "confidence": 0.83,
        "primaryFamily": "retrieval_search",
        "reason": "retrieval_request",
      }
    `);
  });

  it('routes settings/config request', () => {
    const route = routeToolFamilies({
      userMessage: '切换模型到 GPT-4o',
    });
    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "workspace_control",
          "config_diagnostic",
          "ui_navigation",
        ],
        "confidence": 0.9,
        "primaryFamily": "workspace_control",
        "reason": "settings_or_control_request",
      }
    `);
  });

  it('routes navigation request', () => {
    const route = routeToolFamilies({
      userMessage: '打开分析面板',
    });
    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "ui_navigation",
          "workspace_control",
        ],
        "confidence": 0.85,
        "primaryFamily": "ui_navigation",
        "reason": "ui_navigation_request",
      }
    `);
  });

  it('routes ambiguous request to default research_qa', () => {
    const route = routeToolFamilies({
      userMessage: '这篇论文的方法论有什么问题？',
    });
    expect(route).toMatchInlineSnapshot(`
      {
        "allowedFamilies": [
          "research_qa",
          "retrieval_search",
          "writing_edit",
        ],
        "confidence": 0.62,
        "primaryFamily": "research_qa",
        "reason": "default_research_qa",
      }
    `);
  });
});

describe('prompt gate golden — Chinese requests', () => {
  it('classifies greeting', () => {
    const gate = classifyPromptGate({ userMessage: '你好', hasRecentSelection: false });
    expect(gate.type).toBe('greeting');
    expect(gate.confidence).toBeGreaterThan(0.9);
  });

  it('classifies task execution', () => {
    const gate = classifyPromptGate({ userMessage: '帮我创建一个新的笔记并搜索相关文献', hasRecentSelection: false });
    expect(gate.type).toBe('task-execution');
    expect(gate.confidence).toBeGreaterThan(0.8);
  });

  it('classifies focused analysis with paper selection', () => {
    const gate = classifyPromptGate({
      userMessage: '分析这篇论文的主要发现',
      hasRecentSelection: true,
      chatContext: { selectedPaperId: 'p001' } as any,
    });
    expect(gate.type).toBe('focused-analysis');
  });

  it('classifies cross-paper synthesis', () => {
    const gate = classifyPromptGate({
      userMessage: '对比这三篇论文的方法论差异，综合分析他们的贡献',
      hasRecentSelection: false,
    });
    expect(gate.type).toBe('cross-paper-synthesis');
    expect(gate.confidence).toBeGreaterThan(0.8);
  });
});
