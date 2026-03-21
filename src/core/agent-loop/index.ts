/**
 * Lightweight tool-use loop for ad-hoc researcher requests
 * in the AI chat panel.
 */

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function runAgentLoop(
  userMessage: string,
  conversationHistory?: AgentMessage[],
): Promise<string> {
  throw new Error('Not implemented');
}
