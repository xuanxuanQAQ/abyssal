/**
 * Dynamic system prompt construction for Agent Loop.
 *
 * Injects project context, active concepts, advisory suggestions,
 * and tool usage guidelines.
 *
 * See spec: section 7.2
 */

import type { FrameworkState } from '../../electron/app-context';

// ─── Input types ───

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
}

// ─── Builder ───

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const lines: string[] = [];

  lines.push('You are an AI research assistant for the Abyssal academic workstation.');
  lines.push('You help the researcher explore their literature database, answer');
  lines.push('questions about papers, and provide analytical insights.');
  lines.push('');

  // Project context
  lines.push('## Project Context');
  lines.push(`- Project: ${ctx.projectName}`);
  lines.push(`- Framework state: ${ctx.frameworkState} (${ctx.conceptCount} concepts: ${ctx.tentativeCount}t/${ctx.workingCount}w/${ctx.establishedCount}e)`);
  lines.push(`- Papers: ${ctx.totalPapers} total, ${ctx.analyzedPapers} analyzed, ${ctx.acquiredPapers} acquired`);
  lines.push(`- Memos: ${ctx.memoCount} research memos`);
  lines.push(`- Notes: ${ctx.noteCount} research notes`);
  lines.push('');

  // Active concepts (top 10)
  if (ctx.frameworkState !== 'zero_concepts' && ctx.topConcepts.length > 0) {
    lines.push('## Active Concepts');
    for (const c of ctx.topConcepts.slice(0, 10)) {
      lines.push(`- ${c.nameEn} (${c.maturity}): ${c.mappedPapers} papers mapped`);
    }
    lines.push('');
  }

  // Advisory suggestions (top 3)
  if (ctx.advisorySuggestions.length > 0) {
    lines.push('## Current Advisor Recommendations');
    for (const s of ctx.advisorySuggestions.slice(0, 3)) {
      lines.push(`- ${s.title}: ${s.description}`);
    }
    lines.push('');
  }

  // Tool guidelines
  lines.push('## Available Tools');
  lines.push(`You have access to ${ctx.toolCount} read-only tools for querying the`);
  lines.push('research database. You cannot modify data — modifications require');
  lines.push("the researcher to use the application's UI or workflow system.");
  lines.push('');
  lines.push('## Guidelines');
  lines.push('- When asked about a paper, use `get_paper` to retrieve full details before answering.');
  lines.push('- When asked about a concept, use `get_concept` to check its current definition and `get_concept_history` to understand its evolution.');
  lines.push('- When asked to find information, prefer `retrieve` (full RAG pipeline) over `search_knowledge` (vector-only) for better results.');
  lines.push('- When discussing memos or notes, use `query_memos` or `query_notes` to find relevant researcher thoughts.');
  lines.push('- Always cite paper IDs when referencing specific papers.');

  return lines.join('\n');
}
