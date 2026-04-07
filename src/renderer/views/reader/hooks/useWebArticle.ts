import { useState, useEffect, useRef } from 'react';
import { getAPI } from '../../../core/ipc/bridge';

export type WebArticleStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WebArticleState {
  status: WebArticleStatus;
  markdown: string | null;
  sourceUrl: string | null;
  title: string | null;
  error: string | null;
}

export function useWebArticle(paperId: string | null): WebArticleState {
  const [status, setStatus] = useState<WebArticleStatus>('idle');
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeLoadRef = useRef<string | null>(null);

  useEffect(() => {
    setMarkdown(null);
    setSourceUrl(null);
    setTitle(null);
    setError(null);

    if (!paperId) {
      setStatus('idle');
      activeLoadRef.current = null;
      return;
    }

    const loadId = paperId;
    activeLoadRef.current = loadId;
    setStatus('loading');

    const load = async () => {
      try {
        const api = getAPI();
        const result = await api.fs.openWebArticle(paperId);
        if (activeLoadRef.current !== loadId) return;
        setMarkdown(result.markdown);
        setSourceUrl(result.sourceUrl);
        setTitle(result.title);
        setStatus('ready');
      } catch (err) {
        if (activeLoadRef.current !== loadId) return;
        setError(err instanceof Error ? err.message : 'Failed to load web article');
        setStatus('error');
      }
    };

    load();

    return () => {
      activeLoadRef.current = null;
    };
  }, [paperId]);

  return { status, markdown, sourceUrl, title, error };
}
