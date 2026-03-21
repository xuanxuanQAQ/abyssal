import type { CompleteOptions, CompleteResult } from '../types';

export async function complete(
  systemPrompt: string,
  userMessage: string,
  options?: CompleteOptions,
): Promise<CompleteResult> {
  throw new Error('Not implemented');
}

export async function embed(texts: string[]): Promise<number[][]> {
  throw new Error('Not implemented');
}
