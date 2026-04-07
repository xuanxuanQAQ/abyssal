import { useState, useEffect, useRef, useCallback } from 'react';
import { getAPI } from '../../../core/ipc/bridge';
import { PDFDocumentManager } from '../core/pdfDocumentManager';
import {
  buildEstimatedPageMetadataMap,
  preloadRemainingPageMetadata,
  readPageMetadata,
  type PageMetadataMap,
} from '../core/pageMetadataPreloader';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { emitUserAction } from '../../../core/hooks/useEventBridge';

export type DocumentStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PDFDocumentState {
  status: DocumentStatus;
  manager: PDFDocumentManager | null;
  pageMetadataMap: PageMetadataMap | null;
  /** Absolute path to the PDF file on disk (for DLA subprocess) */
  pdfPath: string | null;
  error: string | null;
}

export function usePDFDocument(paperId: string | null): PDFDocumentState {
  const [status, setStatus] = useState<DocumentStatus>('idle');
  const [manager, setManager] = useState<PDFDocumentManager | null>(null);
  const [pageMetadataMap, setPageMetadataMap] =
    useState<PageMetadataMap | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const managerRef = useRef<PDFDocumentManager | null>(null);
  const activeLoadRef = useRef<string | null>(null);

  useEffect(() => {
    // Cleanup previous document
    if (managerRef.current) {
      managerRef.current.destroy();
      managerRef.current = null;
      setManager(null);
      setPageMetadataMap(null);
      setPdfPath(null);
      setError(null);
      useReaderStore.getState().resetReader();
    }

    if (!paperId) {
      setStatus('idle');
      activeLoadRef.current = null;
      return;
    }

    const loadId = paperId;
    activeLoadRef.current = loadId;
    setStatus('loading');
    setError(null);
    const metadataAbort = new AbortController();

    const loadDocument = async (): Promise<void> => {
      try {
        const api = getAPI();
        const { path: filePath, data } = await api.fs.openPDF(paperId);

        if (activeLoadRef.current !== loadId) return;

        const docManager = new PDFDocumentManager();
        await docManager.loadDocument({ kind: 'data', data });

        if (activeLoadRef.current !== loadId) {
          docManager.destroy();
          return;
        }

        managerRef.current = docManager;
        setManager(docManager);

        const numPages = docManager.getNumPages();
        useReaderStore.getState().setTotalPages(numPages);
        useReaderStore.getState().setCurrentPage(1);

        const doc = docManager.getDocument();
        if (!doc) throw new Error('Document loaded but proxy is null');
        const pdfDocument = doc as unknown as import('../core/pageMetadataPreloader').PDFDocumentLike;
        const firstPageMetadata = await readPageMetadata(pdfDocument, 1);

        if (activeLoadRef.current !== loadId) {
          docManager.destroy();
          managerRef.current = null;
          return;
        }

        const initialMetadata = buildEstimatedPageMetadataMap(numPages, firstPageMetadata);
        setPageMetadataMap(initialMetadata);
        setPdfPath(filePath);
        setStatus('ready');
        emitUserAction({ action: 'openPaper', paperId: loadId, hasPdf: true });

        void preloadRemainingPageMetadata(pdfDocument, numPages, {
          signal: metadataAbort.signal,
          concurrency: 6,
          batchSize: 8,
          onBatch: (entries) => {
            if (activeLoadRef.current !== loadId || entries.length === 0) return;
            setPageMetadataMap((previous) => {
              const next = new Map(previous ?? initialMetadata);
              for (const [pageNumber, pageMetadata] of entries) {
                next.set(pageNumber, pageMetadata);
              }
              return next;
            });
          },
        }).catch((preloadError) => {
          if (metadataAbort.signal.aborted || activeLoadRef.current !== loadId) return;
          console.warn('[Reader] Background page metadata preload failed:', preloadError);
        });
      } catch (err) {
        if (activeLoadRef.current !== loadId) return;

        const message =
          err instanceof Error ? err.message : 'Failed to load PDF document';
        setError(message);
        setStatus('error');
      }
    };

    loadDocument();

    return () => {
      metadataAbort.abort();
      activeLoadRef.current = null;
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
        setManager(null);
        setPageMetadataMap(null);
        setPdfPath(null);
        useReaderStore.getState().resetReader();
      }
    };
  }, [paperId]);

  return {
    status,
    manager,
    pageMetadataMap,
    pdfPath,
    error,
  };
}
