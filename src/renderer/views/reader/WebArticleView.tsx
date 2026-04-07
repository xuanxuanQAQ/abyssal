/**
 * WebArticleView — 网页文章阅读器
 *
 * 渲染从网页抓取并提取的 Markdown 内容。
 * 支持：
 * - 文本选取 → 自动注入 Chat 上下文
 * - 标注工具栏（高亮 / 笔记 / 概念标签）
 * - 已保存标注的持久化渲染
 *
 * 选区视觉完全由自定义覆盖层实现（禁用浏览器原生 ::selection），
 * 保证焦点移走后高亮仍然可见，且全程只有一层选取反馈。
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import Markdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { useWebArticle } from './hooks/useWebArticle';
import { useReaderStore } from '../../core/store/useReaderStore';
import { emitUserAction } from '../../core/hooks/useEventBridge';
import { SelectionToolbar } from './annotations/SelectionToolbar';
import { NotePopover } from './annotations/NotePopover';
import { ConceptSelector } from './annotations/ConceptSelector';
import { CreateConceptDialog } from '../analysis/tabs/concepts/CreateConceptDialog';
import { useAnnotations } from '../../core/ipc/hooks/useAnnotations';
import { useAnnotationCRUD } from './hooks/useAnnotationCRUD';
import { useConceptList } from '../../core/ipc/hooks/useConcepts';
import { HIGHLIGHT_COLOR_MAP } from './shared/highlightColors';
import type { Paper, AnnotationPosition, Concept } from '../../../shared-types/models';
import type { HighlightColor } from '../../../shared-types/enums';

interface WebArticleViewProps {
  paperId: string;
  paper?: Paper | null;
}

type HighlightRect = { top: number; left: number; width: number; height: number };

/** 捕获 Range 的客户端矩形，转换为相对于容器元素的绝对定位坐标 */
function captureSelectionRects(range: Range, container: HTMLElement): HighlightRect[] {
  const containerRect = container.getBoundingClientRect();
  const clientRects = range.getClientRects();
  const result: HighlightRect[] = [];
  for (let i = 0; i < clientRects.length; i++) {
    const r = clientRects[i]!;
    if (r.width < 1 || r.height < 1) continue;
    result.push({
      top: r.top - containerRect.top,
      left: r.left - containerRect.left,
      width: r.width,
      height: r.height,
    });
  }
  return result;
}

/** 安全地清除高亮：仅在有内容时产生新引用，避免无意义的 React 重渲染 */
function clearRects(prev: HighlightRect[]): HighlightRect[] {
  return prev.length > 0 ? [] : prev;
}

/** 从当前浏览器选区构建 AnnotationPosition（像素坐标，相对于 contentRef） */
function buildAnnotationPosition(container: HTMLElement): AnnotationPosition | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const rects = captureSelectionRects(sel.getRangeAt(0), container);
  if (rects.length === 0) return null;
  return {
    rects: rects.map((r) => ({ x: r.left, y: r.top, width: r.width, height: r.height })),
    pageWidth: container.scrollWidth,
    pageHeight: container.scrollHeight,
    coordinateSystem: 'pdf_points',
  };
}

/** 待确认标注的临时数据 */
interface PendingAnnotation {
  position: AnnotationPosition;
  selectedText: string;
  anchor: { x: number; y: number };
}

export function WebArticleView({ paperId, paper }: WebArticleViewProps) {
  const { t } = useTranslation();
  const { status, markdown, sourceUrl, title: articleTitle, error } = useWebArticle(paperId);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipCollapseRef = useRef(false);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const selectedTextRef = useRef('');

  // ── 标注相关 ──
  const highlightColor = useReaderStore((s) => s.highlightColor);
  const { data: annotations = [] } = useAnnotations(paperId);
  const annotationCRUD = useAnnotationCRUD(paperId);
  const { data: conceptsData } = useConceptList();
  const concepts: Concept[] = conceptsData ?? [];

  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingNote, setPendingNote] = useState<PendingAnnotation | null>(null);
  const [pendingConcept, setPendingConcept] = useState<PendingAnnotation | null>(null);
  const [showCreateConcept, setShowCreateConcept] = useState(false);

  const title = paper?.title ?? articleTitle;

  // ── 清除当前选区 ──
  const dismissSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setHighlightRects(clearRects);
    setToolbarPos(null);
    selectedTextRef.current = '';
    useReaderStore.getState().setQuotedSelection(null);
  }, []);

  // ── 文本选取 → 实时渲染覆盖层 + Chat 上下文注入 ──
  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !contentRef.current) return;

    if (sel.isCollapsed) {
      if (skipCollapseRef.current) {
        skipCollapseRef.current = false;
        return;
      }
      const node = sel.anchorNode;
      if (node && contentRef.current.contains(node)) {
        setHighlightRects(clearRects);
        setToolbarPos(null);
        selectedTextRef.current = '';
        useReaderStore.getState().setQuotedSelection(null);
      }
      return;
    }

    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if (!anchor || !focus) return;
    if (!contentRef.current.contains(anchor) && !contentRef.current.contains(focus)) return;

    const text = sel.toString().trim();
    if (text.length > 0) {
      const range = sel.getRangeAt(0);
      const rects = captureSelectionRects(range, contentRef.current);
      setHighlightRects(rects);
      selectedTextRef.current = text;

      // 工具栏定位：选区第一个矩形的上方居中
      const firstClientRect = range.getClientRects()[0];
      if (firstClientRect) {
        setToolbarPos({
          x: firstClientRect.left + firstClientRect.width / 2,
          y: firstClientRect.top - 8,
        });
      }

      useReaderStore.getState().setQuotedSelection({ text, page: 1 });
      emitUserAction({
        action: 'selectText',
        paperId,
        text: text.slice(0, 200),
        page: 1,
      });
    }
  }, [paperId]);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      useReaderStore.getState().setQuotedSelection(null);
      useReaderStore.getState().setSelectionPayload(null);
    };
  }, [handleSelectionChange]);

  // ── pointerdown capture 阶段 ──
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!contentRef.current) return;
      if (useReaderStore.getState().quotedSelection === null) return;
      if (!contentRef.current.contains(e.target as Node)) {
        skipCollapseRef.current = true;
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  // 工具栏跟随滚动
  useEffect(() => {
    if (!toolbarPos || !scrollRef.current) return;
    const container = scrollRef.current;
    const handleScroll = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setToolbarPos(null);
        return;
      }
      const firstRect = sel.getRangeAt(0).getClientRects()[0];
      if (firstRect) {
        setToolbarPos({ x: firstRect.left + firstRect.width / 2, y: firstRect.top - 8 });
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [toolbarPos]);

  // 外部清除同步
  useEffect(() => {
    const unsub = useReaderStore.subscribe(
      (s) => s.quotedSelection,
      (qs) => {
        if (qs === null) {
          setHighlightRects(clearRects);
          setToolbarPos(null);
          selectedTextRef.current = '';
        }
      },
    );
    return unsub;
  }, []);

  // ── 标注动作 ──
  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      if (!contentRef.current) return;
      const pos = buildAnnotationPosition(contentRef.current);
      const text = selectedTextRef.current;
      if (!pos || !text) return;
      annotationCRUD.createHighlight(1, pos, text, color);
      dismissSelection();
    },
    [annotationCRUD, dismissSelection],
  );

  const handleNote = useCallback(() => {
    if (!contentRef.current || !toolbarPos) return;
    const pos = buildAnnotationPosition(contentRef.current);
    const text = selectedTextRef.current;
    if (!pos || !text) return;
    setPendingNote({ position: pos, selectedText: text, anchor: toolbarPos });
    dismissSelection();
  }, [toolbarPos, dismissSelection]);

  const handleConceptTag = useCallback(() => {
    if (!contentRef.current || !toolbarPos) return;
    const pos = buildAnnotationPosition(contentRef.current);
    const text = selectedTextRef.current;
    if (!pos || !text) return;
    setPendingConcept({ position: pos, selectedText: text, anchor: toolbarPos });
    dismissSelection();
  }, [toolbarPos, dismissSelection]);

  const handleColorChange = useCallback(
    (color: HighlightColor) => useReaderStore.getState().setHighlightColor(color),
    [],
  );

  // ── Markdown 渲染隔离 ──
  const markdownComponents = useMemo(
    () => ({
      h1: ({ children }: any) => (
        <h1 style={{ fontSize: '1.4em', fontWeight: 600, textAlign: 'center', margin: '1.2em 0 0.6em', color: 'var(--text-primary)' }}>{children}</h1>
      ),
      h2: ({ children }: any) => (
        <h2 style={{ fontSize: '1.2em', fontWeight: 600, margin: '1em 0 0.5em', color: 'var(--text-primary)' }}>{children}</h2>
      ),
      h3: ({ children }: any) => (
        <h3 style={{ fontSize: '1.05em', fontWeight: 600, margin: '0.8em 0 0.4em', color: 'var(--text-primary)' }}>{children}</h3>
      ),
      p: ({ children }: any) => {
        const text = typeof children === 'string' ? children
          : Array.isArray(children) ? String(children[0] ?? '') : '';
        const noIndent =
          /^\d+[.、)）]/.test(text) ||
          /^[（(]\d+[)）]/.test(text) ||
          /^\d{4}年\d{1,2}月\d{1,2}日/.test(text) ||
          (text.length > 0 && text.length <= 20 && !text.includes('。'));
        return (
          <p style={{ margin: '0.8em 0', textAlign: 'justify', textIndent: noIndent ? 0 : '2em' }}>{children}</p>
        );
      },
      blockquote: ({ children }: any) => (
        <blockquote style={{ borderLeft: '3px solid var(--accent-color, #3b82f6)', paddingLeft: 16, margin: '0.8em 0', color: 'var(--text-secondary)' }}>{children}</blockquote>
      ),
      a: ({ href, children }: any) => (
        <a href={href} onClick={(e: React.MouseEvent) => { e.preventDefault(); if (href) window.open(href, '_blank'); }} style={{ color: 'var(--accent-color, #3b82f6)', textDecoration: 'underline' }}>{children}</a>
      ),
      table: ({ children }: any) => (
        <div style={{ overflowX: 'auto', margin: '0.8em 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' }}>{children}</table>
        </div>
      ),
      th: ({ children }: any) => (
        <th style={{ border: '1px solid var(--border-default)', padding: '6px 10px', background: 'var(--bg-surface)', textAlign: 'left' }}>{children}</th>
      ),
      td: ({ children }: any) => (
        <td style={{ border: '1px solid var(--border-subtle)', padding: '6px 10px' }}>{children}</td>
      ),
      hr: () => (
        <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '1.5em 0' }} />
      ),
    }),
    [],
  );

  const markdownElement = useMemo(
    () => markdown ? <Markdown components={markdownComponents}>{markdown}</Markdown> : null,
    [markdown, markdownComponents],
  );

  if (status === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        {t('common.loading')}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {error ?? t('reader.loadFailed')}
      </div>
    );
  }

  if (!markdown) return null;

  const metaItems: string[] = [];
  if (paper?.authors && paper.authors.length > 0) {
    metaItems.push(paper.authors.map((a) => a.name).join('、'));
  }
  if (paper?.year) metaItems.push(String(paper.year));
  const venue = (paper as any)?.venue ?? (paper as any)?.publisher;
  if (venue) metaItems.push(venue);

  const showToolbar = highlightRects.length > 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`.web-article-content ::selection { background: transparent; color: inherit; }`}</style>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }}>
        <div
          ref={contentRef}
          className="web-article-content"
          style={{
            position: 'relative',
            maxWidth: 760,
            margin: '0 auto',
            padding: '40px 48px 60px',
            color: 'var(--text-primary)',
            lineHeight: 1.9,
            fontSize: '15px',
          }}
        >
          {/* ── 已保存标注覆盖层 ── */}
          {annotations.map((ann) =>
            ann.position.rects.map((rect, i) => (
              <div
                key={`${ann.id}-${i}`}
                style={{
                  position: 'absolute',
                  top: rect.y,
                  left: rect.x,
                  width: rect.width,
                  height: rect.height,
                  backgroundColor: HIGHLIGHT_COLOR_MAP[ann.color],
                  mixBlendMode: 'multiply',
                  borderRadius: 2,
                  pointerEvents: 'none',
                }}
              />
            )),
          )}

          {/* ── 当前选区覆盖层 ── */}
          {highlightRects.length > 0 &&
            highlightRects.map((rect, i) => (
              <div
                key={`sel-${i}`}
                style={{
                  position: 'absolute',
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                  backgroundColor: 'color-mix(in srgb, var(--accent-color, #3b82f6) 18%, transparent)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                }}
              />
            ))}

          {/* 文档标题 */}
          {title && (
            <h1 style={{ fontSize: '1.5em', fontWeight: 700, textAlign: 'center', margin: '0 0 8px', lineHeight: 1.4, color: 'var(--text-primary)' }}>
              {title}
            </h1>
          )}

          {(metaItems.length > 0 || sourceUrl) && (
            <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)', marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {metaItems.length > 0 && <span>{metaItems.join(' · ')}</span>}
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  onClick={(e) => { e.preventDefault(); window.open(sourceUrl, '_blank'); }}
                  style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '12px', opacity: 0.8, transition: 'opacity 150ms' }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                >
                  <ExternalLink size={11} />
                  {t('reader.webArticle.viewOriginal')}
                </a>
              )}
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '0 0 28px' }} />

          {markdownElement}
        </div>
      </div>

      {/* ── 选区工具栏 ── */}
      {showToolbar && (
        <SelectionToolbar
          position={toolbarPos}
          highlightColor={highlightColor}
          onHighlight={handleHighlight}
          onNote={handleNote}
          onConceptTag={handleConceptTag}
          onColorChange={handleColorChange}
        />
      )}

      {/* ── 笔记弹窗 ── */}
      {pendingNote && (
        <NotePopover
          open
          onOpenChange={(open) => { if (!open) setPendingNote(null); }}
          anchorRect={pendingNote.anchor}
          initialText=""
          onSave={(noteText) => {
            annotationCRUD.createNote(1, pendingNote.position, pendingNote.selectedText, highlightColor, noteText);
            setPendingNote(null);
          }}
          onCancel={() => setPendingNote(null)}
        />
      )}

      {/* ── 概念选择器 ── */}
      {pendingConcept && (
        <ConceptSelector
          open
          onOpenChange={(open) => { if (!open) setPendingConcept(null); }}
          anchorRect={pendingConcept.anchor}
          concepts={concepts}
          onSelect={(conceptId) => {
            annotationCRUD.createConceptTag(1, pendingConcept.position, pendingConcept.selectedText, highlightColor, conceptId);
            setPendingConcept(null);
          }}
          onCreateNew={() => {
            setShowCreateConcept(true);
          }}
        />
      )}

      {/* ── 新建概念对话框 ── */}
      {showCreateConcept && (
        <CreateConceptDialog
          open={showCreateConcept}
          onOpenChange={setShowCreateConcept}
          onCreated={(conceptId) => {
            if (pendingConcept) {
              annotationCRUD.createConceptTag(1, pendingConcept.position, pendingConcept.selectedText, highlightColor, conceptId);
              setPendingConcept(null);
            }
            setShowCreateConcept(false);
          }}
        />
      )}
    </div>
  );
}
