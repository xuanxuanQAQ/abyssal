/**
 * Orchestrator — six deterministic workflows.
 * AI is invoked only at reasoning steps, never as pipeline controller.
 */

export async function discover(): Promise<void> {
  throw new Error('Not implemented');
}

export async function acquire(): Promise<void> {
  throw new Error('Not implemented');
}

export async function analyze(): Promise<void> {
  throw new Error('Not implemented');
}

export async function synthesize(conceptIds: string[]): Promise<void> {
  throw new Error('Not implemented');
}

export async function article(articleId: number): Promise<void> {
  throw new Error('Not implemented');
}

export async function bibliography(): Promise<void> {
  throw new Error('Not implemented');
}
