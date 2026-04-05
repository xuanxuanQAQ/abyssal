/**
 * System prompt builder — language injection & structural tests.
 *
 * These tests ensure the system prompt:
 * 1. Contains explicit language instruction when defaultOutputLanguage is set
 * 2. Falls back to "same language as user" when no preference is configured
 * 3. Includes project context, rules, and tool hints
 */

import { buildSystemPrompt, type SystemPromptContext } from './system-prompt-builder';

function makeMinimalContext(overrides?: Partial<SystemPromptContext>): SystemPromptContext {
  return {
    projectName: 'Test Project',
    frameworkState: 'framework_forming',
    conceptCount: 5,
    tentativeCount: 2,
    workingCount: 2,
    establishedCount: 1,
    totalPapers: 10,
    analyzedPapers: 4,
    acquiredPapers: 8,
    memoCount: 3,
    noteCount: 1,
    topConcepts: [
      { nameEn: 'Self-Regulation', maturity: 'working', mappedPapers: 3 },
    ],
    advisorySuggestions: [],
    toolCount: 21,
    ...overrides,
  };
}

describe('buildSystemPrompt — language injection', () => {
  it('injects "Always respond in zh-CN" when defaultOutputLanguage is zh-CN', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({ defaultOutputLanguage: 'zh-CN' }));
    expect(prompt).toContain('Always respond in zh-CN');
    expect(prompt).not.toContain('Respond in the same language as the user');
  });

  it('injects "Always respond in en" when defaultOutputLanguage is en', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({ defaultOutputLanguage: 'en' }));
    expect(prompt).toContain('Always respond in en');
  });

  it('falls back to "same language as user" when no defaultOutputLanguage', () => {
    const prompt = buildSystemPrompt(makeMinimalContext());
    expect(prompt).toContain('Respond in the same language as the user');
    expect(prompt).not.toContain('Always respond in');
  });

  it('falls back to "same language as user" when defaultOutputLanguage is empty string', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({ defaultOutputLanguage: '' }));
    expect(prompt).toContain('Respond in the same language as the user');
  });
});

describe('buildSystemPrompt — structural integrity', () => {
  it('includes project name and paper stats', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({ projectName: 'Cognition Lab' }));
    expect(prompt).toContain('Cognition Lab');
    expect(prompt).toContain('10 papers');
  });

  it('includes top concepts for non-zero framework state', () => {
    const prompt = buildSystemPrompt(makeMinimalContext());
    expect(prompt).toContain('Self-Regulation');
  });

  it('skips top concepts when framework state is zero_concepts', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({
      frameworkState: 'zero_concepts',
      conceptCount: 0,
      tentativeCount: 0,
      workingCount: 0,
      establishedCount: 0,
    }));
    expect(prompt).not.toContain('Key concepts:');
  });

  it('includes active paper context', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({
      activePaper: {
        id: 'p-1',
        title: 'Metacognition in Education',
        authors: 'Flavell (1979)',
        year: 1979,
        abstract: 'A study of metacognitive processes.',
        analysisStatus: 'completed',
        fulltextStatus: 'available',
      },
    }));
    expect(prompt).toContain('Metacognition in Education');
    expect(prompt).toContain('Flavell (1979)');
    expect(prompt).toContain('do NOT call `get_paper`');
  });

  it('includes tool count in rules', () => {
    const prompt = buildSystemPrompt(makeMinimalContext({ toolCount: 25 }));
    expect(prompt).toContain('25 tools available');
  });

  it('includes cache boundary marker', () => {
    const prompt = buildSystemPrompt(makeMinimalContext());
    expect(prompt).toContain('<!-- cache-boundary -->');
  });

  it('respects bundle selection', () => {
    const prompt = buildSystemPrompt(makeMinimalContext(), { bundles: ['project_meta'] });
    expect(prompt).toContain('Test Project');
    expect(prompt).not.toContain('## Rules');
  });

  it('uses a minimal greeting mode without project dump', () => {
    const prompt = buildSystemPrompt(makeMinimalContext(), { bundles: [], interactionMode: 'greeting' });
    expect(prompt).toContain('Reply briefly in 1-2 sentences');
    expect(prompt).not.toContain('## Project:');
    expect(prompt).not.toContain('tools available');
  });

  it('adds assistant-profile guidance for identity questions', () => {
    const prompt = buildSystemPrompt(makeMinimalContext(), {
      bundles: ['project_meta', 'capability_hints'],
      interactionMode: 'assistant_profile',
    });
    expect(prompt).toContain('The user is explicitly asking who you are or what you can do');
    expect(prompt).toContain('Test Project');
  });
});
