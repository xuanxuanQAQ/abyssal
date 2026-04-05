/**
 * Citation Actions — unified citation insertion API for cross-component use.
 *
 * Provides a global event-based mechanism for inserting citations into the
 * active Tiptap editor from any surface (RAG cards, AI operations, etc.).
 */

type CitationInsertRequest = {
  paperId: string;
  displayText?: string | undefined;
};

type CitationInsertListener = (request: CitationInsertRequest) => void;

const listeners = new Set<CitationInsertListener>();

/**
 * Subscribe to citation insert requests.
 * Called by the active editor component to listen for external citation insertions.
 */
export function onCitationInsertRequest(listener: CitationInsertListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Request insertion of a citation node into the active editor.
 * Can be called from any component (RAG cards, AI operations, etc.).
 */
export function requestCitationInsert(paperId: string, displayText?: string): boolean {
  if (listeners.size === 0) return false;
  const request: CitationInsertRequest = { paperId, displayText };
  for (const listener of listeners) {
    listener(request);
  }
  return true;
}
