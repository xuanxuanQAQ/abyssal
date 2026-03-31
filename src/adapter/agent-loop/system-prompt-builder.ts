/**
 * Dynamic system prompt construction for Agent Loop.
 *
 * Injects project context, active paper focus, active concepts,
 * advisory suggestions, and tool usage guidelines.
 *
 * Budget target: <1500 tokens typical, <3000 tokens worst-case.
 * Large fields (abstract, analysisSummary) are aggressively truncated
 * because they repeat on every LLM round in a tool-use loop.
 */

import type { FrameworkState } from '../../electron/app-context';

// ─── Input types ───

/** Paper context injected when user is viewing / chatting about a specific paper */
export interface ActivePaperContext {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  abstract: string;
  doi?: string | undefined;
  analysisStatus: string;
  fulltextStatus: string;
  /** AI analysis summary (if completed) */
  analysisSummary?: string | undefined;
  /** Mapped concept names */
  mappedConcepts?: string[] | undefined;
}

/** Concept context injected when user is viewing a specific concept */
export interface ActiveConceptContext {
  id: string;
  nameEn: string;
  definition: string;
  maturity: string;
  mappedPaperCount: number;
}

export interface SystemPromptContext {
  projectName: string;
  frameworkState: FrameworkState;
  conceptCount: number;
  tentativeCount: number;
  workingCount: number;
  establishedCount: number;
  totalPapers: number;
  analyzedPapers: number;
  acquiredPapers: number;
  memoCount: number;
  noteCount: number;
  topConcepts: Array<{ nameEn: string; maturity: string; mappedPapers: number }>;
  advisorySuggestions: Array<{ title: string; description: string }>;
  toolCount: number;
  /** Currently focused paper (user is viewing this paper) */
  activePaper?: ActivePaperContext | undefined;
  /** Multiple papers selected (Library multi-select) */
  activePapers?: ActivePaperContext[] | undefined;
  /** Currently focused concept */
  activeConcept?: ActiveConceptContext | undefined;
  /** Current PDF page number (if reader is open) */
  pdfPage?: number | undefined;
  /** Default output language (BCP 47, e.g. "zh-CN", "en") */
  defaultOutputLanguage?: string | undefined;
}

// ─── Builder ───

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const lines: string[] = [];

  // ── Role (compact) ──
  lines.push('You are an AI research assistant for the Abyssal academic workstation.');
  lines.push('');

  // ── Active focus (highest priority — what the user is looking at) ──
  if (ctx.activePapers && ctx.activePapers.length > 1) {
    // Multi-paper context (Library multi-select)
    lines.push(`## Selected Papers (${ctx.activePapers.length})`);
    for (const p of ctx.activePapers.slice(0, 8)) {
      lines.push(`- **${p.title}** (${p.authors}${p.year ? `, ${p.year}` : ''}) [ID: ${p.id}]`);
      if (p.abstract) {
        lines.push(`  Abstract: ${p.abstract.slice(0, 200)}${p.abstract.length > 200 ? '...' : ''}`);
      }
      if (p.mappedConcepts && p.mappedConcepts.length > 0) {
        lines.push(`  Concepts: ${p.mappedConcepts.join(', ')}`);
      }
    }
    if (ctx.activePapers.length > 8) {
      lines.push(`- ... and ${ctx.activePapers.length - 8} more`);
    }
    lines.push('');
    lines.push('These papers\' details are already above — do NOT call `get_paper` for them.');
    lines.push('Use `retrieve` to search across their fulltext if needed.');
    lines.push('');
  } else if (ctx.activePaper) {
    const p = ctx.activePaper;
    lines.push('## Current Paper');
    lines.push(`**${p.title}** (${p.authors}${p.year ? `, ${p.year}` : ''}) [ID: ${p.id}]`);
    lines.push(`Analysis: ${p.analysisStatus} | Fulltext: ${p.fulltextStatus}${p.doi ? ` | DOI: ${p.doi}` : ''}`);
    if (p.abstract) {
      lines.push(`Abstract: ${p.abstract.slice(0, 500)}${p.abstract.length > 500 ? '...' : ''}`);
    }
    if (p.analysisSummary) {
      lines.push(`AI Summary: ${p.analysisSummary.slice(0, 800)}${p.analysisSummary.length > 800 ? '...' : ''}`);
    }
    if (p.mappedConcepts && p.mappedConcepts.length > 0) {
      lines.push(`Concepts: ${p.mappedConcepts.join(', ')}`);
    }
    if (ctx.pdfPage) {
      lines.push(`User is on PDF page ${ctx.pdfPage}.`);
    }
    lines.push('');
    lines.push('This paper\'s details are already above — do NOT call `get_paper` for it.');
    lines.push('Use `retrieve` only if you need specific fulltext passages.');
    lines.push('');
  }

  if (ctx.activeConcept) {
    const c = ctx.activeConcept;
    lines.push('## Current Concept');
    lines.push(`**${c.nameEn}** [ID: ${c.id}] — ${c.maturity}, ${c.mappedPaperCount} papers`);
    if (c.definition) {
      lines.push(`Definition: ${c.definition.slice(0, 500)}${c.definition.length > 500 ? '...' : ''}`);
    }
    lines.push('');
    lines.push('This concept\'s details are already above — do NOT call `get_concept` for it.');
    lines.push('');
  }

  // ── Project context (single line) ──
  lines.push(`## Project: ${ctx.projectName}`);
  lines.push(`${ctx.totalPapers} papers (${ctx.analyzedPapers} analyzed, ${ctx.acquiredPapers} acquired) · ${ctx.conceptCount} concepts (${ctx.tentativeCount}t/${ctx.workingCount}w/${ctx.establishedCount}e) · ${ctx.memoCount} memos · ${ctx.noteCount} notes`);
  lines.push('');

  // ── Top concepts (top 5, compact) ──
  if (ctx.frameworkState !== 'zero_concepts' && ctx.topConcepts.length > 0) {
    const conceptList = ctx.topConcepts.slice(0, 5)
      .map((c) => `${c.nameEn}(${c.maturity},${c.mappedPapers}p)`)
      .join(', ');
    lines.push(`Key concepts: ${conceptList}`);
    lines.push('');
  }

  // ── Advisory (top 2, compact) ──
  if (ctx.advisorySuggestions.length > 0) {
    for (const s of ctx.advisorySuggestions.slice(0, 2)) {
      lines.push(`> Advisor: ${s.title} — ${s.description}`);
    }
    lines.push('');
  }

  // ── Guidelines (compact, context-aware) ──
  lines.push('## Rules');
  const rules: string[] = [];

  if (ctx.defaultOutputLanguage) {
    rules.push(`Always respond in ${ctx.defaultOutputLanguage}`);
  } else {
    rules.push('Respond in the same language as the user');
  }

  if (ctx.activePapers && ctx.activePapers.length > 1) {
    rules.push('Answer from the papers context above; only call tools for papers NOT listed above or fulltext search');
  } else if (ctx.activePaper) {
    rules.push('Answer from the paper context above; only call tools for OTHER papers or fulltext search');
  }
  if (ctx.activeConcept) {
    rules.push('Answer from the concept context above; only call tools for OTHER concepts');
  }

  rules.push('Use `retrieve` for fulltext search, `get_paper`/`get_concept` for other entities');
  rules.push('Cite paper IDs when referencing papers');
  rules.push(`${ctx.toolCount} tools available (mostly read-only; you can also create memos, annotations, import papers, and trigger fulltext acquisition)`);

  for (const r of rules) {
    lines.push(`- ${r}`);
  }

  // Workflow instruction — prominent, step-by-step
  lines.push('');
  lines.push('## Paper Download Workflow');
  lines.push('When user asks to find/download a paper, follow ALL steps:');
  lines.push('1. `query_papers` — check if it already exists in the library');
  lines.push('2. If not found → `search_papers` to search Semantic Scholar');
  lines.push('3. If search finds the paper → immediately call `import_paper` with the result metadata (title, authors, year, doi, arxivId, abstract, venue). Set `acquire: true` to auto-download.');
  lines.push('4. Report the result to the user (imported + acquisition started, or not found)');
  lines.push('IMPORTANT: Do NOT stop after searching — always proceed to import_paper if results are found.');

  return lines.join('\n');
}
