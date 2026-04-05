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

export type SystemPromptBundle = 'project_meta' | 'active_focus' | 'capability_hints';

export type SystemPromptInteractionMode = 'default' | 'greeting' | 'assistant_profile';

export interface SystemPromptBuildOptions {
  bundles?: SystemPromptBundle[];
  interactionMode?: SystemPromptInteractionMode;
}

// ─── Builder ───

export function buildSystemPrompt(
  ctx: SystemPromptContext,
  opts: SystemPromptBuildOptions = {},
): string {
  const interactionMode = opts.interactionMode ?? 'default';
  const enabled = new Set<SystemPromptBundle>(
    opts.bundles ?? ['project_meta', 'active_focus', 'capability_hints'],
  );
  const lines: string[] = [];

  lines.push('You are an AI research assistant for the Abyssal academic workstation.');
  lines.push('');

  if (interactionMode === 'greeting') {
    lines.push('<!-- cache-boundary -->');
    lines.push('');
    lines.push('## Rules');
    for (const rule of buildBaseRules(ctx)) {
      lines.push(`- ${rule}`);
    }
    lines.push('- The user only sent a greeting or light social opener. Reply briefly in 1-2 sentences.');
    lines.push('- Do NOT list capabilities, project statistics, tools, concepts, or suggested workflows unless the user explicitly asks who you are or what you can do.');
    return lines.join('\n');
  }

  if (enabled.has('project_meta')) {
    // ── Project context (stable across calls — cached separately by Claude adapter) ──
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
  }

  // Cache boundary: everything above is stable project context (changes rarely).
  // Everything below is per-request variable context (active paper, rules, etc.).
  // The Claude adapter splits on this marker for two-block prefix caching.
  lines.push('<!-- cache-boundary -->');
  lines.push('');

  if (enabled.has('active_focus')) {
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
  }

  if (enabled.has('capability_hints')) {
    // ── Advisory (top 2, compact) ──
    if (ctx.advisorySuggestions.length > 0) {
      for (const s of ctx.advisorySuggestions.slice(0, 2)) {
        lines.push(`> Advisor: ${s.title} — ${s.description}`);
      }
      lines.push('');
    }

    // ── Guidelines (compact, context-aware) ──
    lines.push('## Rules');
    const rules = buildBaseRules(ctx);

    if (enabled.has('active_focus')) {
      if (ctx.activePapers && ctx.activePapers.length > 1) {
        rules.push('Answer from the papers context above; only call tools for papers NOT listed above or fulltext search');
      } else if (ctx.activePaper) {
        rules.push('Answer from the paper context above; only call tools for OTHER papers or fulltext search');
      }
      if (ctx.activeConcept) {
        rules.push('Answer from the concept context above; only call tools for OTHER concepts');
      }
    }

    rules.push('Use `retrieve` for fulltext search, `get_paper`/`get_concept` for other entities');
    rules.push('Cite paper IDs when referencing papers');
    rules.push('When the user only sends a greeting, reply briefly and do not proactively list capabilities or project state.');
    if (interactionMode === 'assistant_profile') {
      rules.push('The user is explicitly asking who you are or what you can do. Introduce yourself as the Abyssal academic workstation AI research assistant, summarize your core capabilities, and keep any current project snapshot brief.');
    }
    rules.push(`${ctx.toolCount} tools available (mostly read-only; you can also create memos, annotations, import papers, and trigger fulltext acquisition)`);

    for (const r of rules) {
      lines.push(`- ${r}`);
    }

    // Paper download workflow — injected as a tool-use guideline, not repeated every turn.
    // Moved from a standalone section to a compact instruction to save ~100 tokens.
    lines.push('');
    lines.push('When asked to find/download a paper: (1) `query_papers` to check library → (2) if not found, `search_papers` → (3) if found, `import_paper` with metadata + `acquire: true` → (4) report result. Always proceed to import, do not stop after searching.');
  }

  return lines.join('\n');
}

function buildBaseRules(ctx: SystemPromptContext): string[] {
  if (ctx.defaultOutputLanguage) {
    return [`Always respond in ${ctx.defaultOutputLanguage}`];
  }
  return ['Respond in the same language as the user'];
}
