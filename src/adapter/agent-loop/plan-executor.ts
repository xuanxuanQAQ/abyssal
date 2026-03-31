/**
 * Plan-then-Execute — two-phase agent execution for complex tasks.
 *
 * Phase 1 (Plan): LLM generates a structured plan with numbered steps
 * Phase 2 (Execute): Agent loop executes each step sequentially, checking
 *   off steps as they complete and adapting if needed.
 *
 * The plan is injected into the system prompt so the LLM stays on track.
 * If a step fails or yields unexpected results, the LLM can revise the plan.
 */

import type { LlmClient, Message, CompletionResult } from '../llm-client/llm-client';

// ─── Types ───

export interface PlanStep {
  index: number;
  description: string;
  toolHint?: string | undefined; // Suggested tool to use
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: string | undefined;
}

export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  reasoning: string;
  createdAt: number;
}

// ─── Plan generation prompt ───

const PLAN_GENERATION_PROMPT = `You are a research assistant planning how to answer a user's question.

Analyze the user's request and create a structured execution plan.

Output your plan in this EXACT format:
<plan>
<goal>Brief description of the overall goal</goal>
<reasoning>Why this approach is best</reasoning>
<step index="1" tool="tool_name">Description of step 1</step>
<step index="2" tool="tool_name">Description of step 2</step>
...
</plan>

Rules:
- Keep plans to 3-7 steps maximum
- Each step should be a single, concrete action
- Use tool hints to suggest which tool to use (optional)
- Order steps logically: gather context → analyze → synthesize → respond`;

// ─── Plan generator ───

export async function generatePlan(
  userMessage: string,
  systemPrompt: string,
  llmClient: LlmClient,
): Promise<ExecutionPlan | null> {
  const planPrompt = systemPrompt + '\n\n' + PLAN_GENERATION_PROMPT;

  const result: CompletionResult = await llmClient.complete({
    systemPrompt: planPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 1024,
    temperature: 0.3,
    workflowId: 'agent',
  });

  return parsePlan(result.text, userMessage);
}

// ─── Plan parser ───

function parsePlan(text: string, originalGoal: string): ExecutionPlan | null {
  const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) return null;

  const planXml = planMatch[1]!;

  const goalMatch = planXml.match(/<goal>([\s\S]*?)<\/goal>/);
  const reasoningMatch = planXml.match(/<reasoning>([\s\S]*?)<\/reasoning>/);

  const steps: PlanStep[] = [];
  const stepRegex = /<step\s+index="(\d+)"(?:\s+tool="([^"]*)")?\s*>([\s\S]*?)<\/step>/g;
  let match: RegExpExecArray | null;

  while ((match = stepRegex.exec(planXml)) !== null) {
    steps.push({
      index: parseInt(match[1]!, 10),
      description: match[3]!.trim(),
      ...(match[2] ? { toolHint: match[2] } : {}),
      status: 'pending',
    });
  }

  if (steps.length === 0) return null;

  return {
    goal: goalMatch?.[1]?.trim() ?? originalGoal,
    steps,
    reasoning: reasoningMatch?.[1]?.trim() ?? '',
    createdAt: Date.now(),
  };
}

// ─── Plan formatting for injection ───

export function formatPlanForPrompt(plan: ExecutionPlan): string {
  const stepLines = plan.steps.map((s) => {
    const statusIcon = s.status === 'completed' ? '✓'
      : s.status === 'in_progress' ? '→'
      : s.status === 'failed' ? '✗'
      : s.status === 'skipped' ? '⊘'
      : '○';
    const resultSuffix = s.result ? ` — ${s.result.slice(0, 100)}` : '';
    return `  ${statusIcon} ${s.index}. ${s.description}${resultSuffix}`;
  });

  return `<execution_plan>
Goal: ${plan.goal}
${stepLines.join('\n')}
</execution_plan>

Follow the plan above. Execute the next pending step (marked ○). Mark it complete when done.
If a step is impossible or unnecessary, skip it and explain why.`;
}

/** Advance plan state: mark current step as completed with result. */
export function advancePlan(plan: ExecutionPlan, stepIndex: number, result: string): void {
  const step = plan.steps.find((s) => s.index === stepIndex);
  if (step) {
    step.status = 'completed';
    step.result = result;
  }
  // Auto-advance: mark next pending step as in_progress
  const nextPending = plan.steps.find((s) => s.status === 'pending');
  if (nextPending) {
    nextPending.status = 'in_progress';
  }
}

/** Check if all steps are done. */
export function isPlanComplete(plan: ExecutionPlan): boolean {
  return plan.steps.every((s) => s.status === 'completed' || s.status === 'skipped' || s.status === 'failed');
}
