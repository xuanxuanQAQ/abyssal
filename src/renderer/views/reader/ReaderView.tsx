/**
 * ReaderView — 顶层 Reader 视图容器
 *
 * 三面板水平布局：ThumbnailNav + PDFViewport + AnnotationList
 * 使用 react-resizable-panels 管理面板尺寸。
 */

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../../core/store';
import { useAnnotations } from '../../core/ipc/hooks/useAnnotations';
import { usePDFDocument } from './hooks/usePDFDocument';
import { PDFViewport } from './viewport/PDFViewport';
import { ThumbnailNav } from './thumbnails/ThumbnailNav';
import { AnnotationList } from './annotations/AnnotationList';
import type { ScrollContainerHandle } from './viewport/ScrollContainer';

export function ReaderView() {
  const { t } = useTranslation();
  const selectedPaperId = useAppStore((s) => s.selectedPaperId);
  const readerThumbsOpen = useAppStore((s) => s.readerThumbsOpen);
  const readerAnnotationListOpen = useAppStore(
    (s) => s.readerAnnotationListOpen,
  );

  const { manager, pageMetadataMap, pdfPath, status, error } =
    usePDFDocument(selectedPaperId);
  const { data: annotations = [] } = useAnnotations(selectedPaperId);

  const scrollContainerRef = useRef<ScrollContainerHandle>(null);
  const [flashingAnnotationId, setFlashingAnnotationId] = useState<
    string | null
  >(null);

  const renderThumbnail = useCallback(
    (canvas: HTMLCanvasElement, pageNumber: number): { promise: Promise<void>; cancel: () => void } => {
      let renderTask: { promise: Promise<void>; cancel(): void } | null = null;
      const promise = (async () => {
        const doc = manager?.getDocument();
        if (!doc || !pageMetadataMap) return;

        const page = await doc.getPage(pageNumber);
        const meta = pageMetadataMap.get(pageNumber);
        const baseWidth =
          meta?.baseWidth ?? page.getViewport({ scale: 1 }).width;
        const scale = 60 / baseWidth;
        const viewport = page.getViewport({ scale });

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.scale(dpr, dpr);
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      })();
      return {
        promise,
        cancel: () => { renderTask?.cancel(); },
      };
    },
    [manager, pageMetadataMap],
  );

  const handleScrollToPage = useCallback((pageNumber: number) => {
    scrollContainerRef.current?.scrollToPage(pageNumber);
  }, []);

  const handleScrollToAnnotation = useCallback(
    (page: number, annotationId: string) => {
      scrollContainerRef.current?.scrollToPage(page);
      setFlashingAnnotationId(annotationId);
      setTimeout(() => setFlashingAnnotationId(null), 1500);
    },
    [],
  );

  if (selectedPaperId == null) {
    return (
      <div
        className="workspace-view workspace-view--reader workspace-empty-state"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {t('reader.selectPaper')}
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div
        className="workspace-view workspace-view--reader workspace-empty-state"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {t('common.loading')}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        className="workspace-view workspace-view--reader workspace-empty-state"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {error ?? t('reader.loadFailed')}
      </div>
    );
  }

  if (!manager || !pageMetadataMap) {
    return null;
  }

  return (
    <div className="workspace-view workspace-view--reader" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelGroup className="workspace-panel-group" direction="horizontal" style={{ flex: 1 }}>
        {readerThumbsOpen && (
          <>
            <Panel
              defaultSize={7}
              minSize={4}
              maxSize={10}
              collapsible
              style={{
                background: 'var(--bg-surface-low)',
                borderRight: '1px solid var(--border-subtle)',
              }}
            >
              <div className="workspace-lens-panel reader-side-panel reader-thumbnails-shell">
                <ThumbnailNav
                  pageMetadataMap={pageMetadataMap}
                  annotations={annotations}
                  onScrollToPage={handleScrollToPage}
                  renderThumbnail={renderThumbnail}
                />
              </div>
            </Panel>
            <PanelResizeHandle
              style={{
                width: 1,
                background: 'var(--border-subtle)',
              }}
            />
          </>
        )}

        <Panel style={{ overflow: 'hidden' }}>
          <div className="workspace-main-stage reader-viewport-stage">
            <PDFViewport
              paperId={selectedPaperId}
              pdfPath={pdfPath}
              manager={manager}
              pageMetadataMap={pageMetadataMap}
              scrollRef={scrollContainerRef}
            />
          </div>
        </Panel>

        {readerAnnotationListOpen && (
          <>
            <PanelResizeHandle
              style={{
                width: 1,
                background: 'var(--border-subtle)',
              }}
            />
            <Panel
              defaultSize={20}
              minSize={14}
              maxSize={28}
              collapsible
              style={{
                background: 'var(--bg-surface-low)',
                borderLeft: '1px solid var(--border-subtle)',
              }}
            >
              <div className="workspace-lens-panel reader-side-panel reader-annotations-shell">
                <AnnotationList
                  paperId={selectedPaperId}
                  onScrollToAnnotation={handleScrollToAnnotation}
                />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
