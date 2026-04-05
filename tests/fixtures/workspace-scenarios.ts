/**
 * Workspace fixture scenarios for integration and E2E tests.
 *
 * Each scenario defines: initial state, config, and expected behaviors.
 */

import type { JSONContent } from '@tiptap/core';

// ── Minimal workspace (first startup) ──

export const WORKSPACE_FIRST_STARTUP = {
  name: 'first-startup',
  rootDir: 'C:/tmp/abyssal-test-first',
  config: {
    workspace: { name: 'Test Workspace' },
    providers: {},
  },
  papers: [],
  articles: [],
  notes: [],
  memos: [],
  concepts: [],
};

// ── Workspace with papers but no analysis ──

export const WORKSPACE_PAPERS_ONLY = {
  name: 'papers-only',
  rootDir: 'C:/tmp/abyssal-test-papers',
  config: {
    workspace: { name: 'Papers Only Workspace' },
    providers: {
      anthropic: { apiKey: 'test-key-xxx', model: 'claude-opus-4' },
    },
  },
  papers: [
    { id: 'p001', title: 'Affordance Theory in HCI', authors: ['Norman, D.'], year: 2024 },
    { id: 'p002', title: 'Ecological Psychology', authors: ['Gibson, J.'], year: 2023 },
    { id: 'p003', title: 'Sensemaking in Organizations', authors: ['Weick, K.'], year: 2024 },
  ],
  articles: [],
  notes: [],
  memos: [],
  concepts: [],
};

// ── Workspace with full analysis state ──

export const WORKSPACE_FULLY_ANALYZED = {
  name: 'fully-analyzed',
  rootDir: 'C:/tmp/abyssal-test-full',
  config: {
    workspace: { name: 'Full Analysis Workspace' },
    providers: {
      anthropic: { apiKey: 'test-key-xxx', model: 'claude-opus-4' },
    },
  },
  papers: [
    { id: 'p001', title: 'Affordance Theory', authors: ['Norman, D.'], year: 2024 },
    { id: 'p002', title: 'Distributed Cognition', authors: ['Hutchins, E.'], year: 2023 },
  ],
  articles: [
    { id: 'a001', title: '综述：可供性理论', documentJson: '{"type":"doc","content":[{"type":"heading","attrs":{"level":1,"sectionId":"s1"},"content":[{"type":"text","text":"引言"}]},{"type":"paragraph","content":[{"type":"text","text":"本文讨论可供性理论。"}]},{"type":"heading","attrs":{"level":1,"sectionId":"s2"},"content":[{"type":"text","text":"方法"}]},{"type":"paragraph","content":[{"type":"text","text":"我们采用系统综述方法。"}]}]}' },
  ],
  notes: [
    { id: 'n001', paperId: 'p001', text: '关键发现：可供性在界面设计中至关重要' },
  ],
  memos: [
    { id: 'm001', title: '研究方向备忘', content: '探索可供性与分布式认知的交叉领域' },
  ],
  concepts: [
    { id: 'affordance', nameZh: '可供性', nameEn: 'Affordance' },
    { id: 'distributed_cognition', nameZh: '分布式认知', nameEn: 'Distributed Cognition' },
  ],
};

// ── Corrupted config workspace ──

export const WORKSPACE_CORRUPTED_CONFIG = {
  name: 'corrupted-config',
  rootDir: 'C:/tmp/abyssal-test-corrupt',
  config: null, // Missing or unparseable config
  papers: [],
  articles: [],
};

// ── Dual workspace switch scenario ──

export const WORKSPACE_SWITCH_PAIR = {
  from: {
    name: 'workspace-a',
    rootDir: 'C:/tmp/abyssal-test-a',
    papers: [{ id: 'pa1', title: 'Paper A1' }],
  },
  to: {
    name: 'workspace-b',
    rootDir: 'C:/tmp/abyssal-test-b',
    papers: [{ id: 'pb1', title: 'Paper B1' }, { id: 'pb2', title: 'Paper B2' }],
  },
};

// ── Document fixtures for writing tests ──

export function makeArticleDocument(sections: Array<{ id: string; title: string; body: string }>): JSONContent {
  const content: JSONContent[] = [];
  for (const s of sections) {
    content.push({
      type: 'heading',
      attrs: { level: 1, sectionId: s.id },
      content: [{ type: 'text', text: s.title }],
    });
    for (const line of s.body.split('\n').filter(Boolean)) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: line }],
      });
    }
  }
  return { type: 'doc', content };
}
