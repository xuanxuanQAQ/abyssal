/**
 * ContextPanel — 顶层容器（§1.1）
 *
 * 垂直 PanelGroup 分割：ContextBody + ChatDock
 * ContextBody 内部通过 CrossfadeTransition 切换 ContentPane
 *
 * §12.1 折叠时不渲染 ContentPane（条件渲染）
 * §1.2 ChatDock 全屏态：条件渲染移除 ContextBody
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ContextHeader } from './ContextHeader';
import { ChatDock } from './chat/ChatDock';
import { CrossfadeTransition } from './transitions/CrossfadeTransition';
import { useEffectiveSource } from './engine/useEffectiveSource';
import { contextSourceKey } from './engine/contextSourceKey';
import { useChatStore } from '../../core/store/useChatStore';

// ContentPanes
import { LibraryPaperPane } from './panes/LibraryPaperPane';
import { ReaderPaperPane } from './panes/ReaderPaperPane';
import { ConceptPane } from './panes/ConceptPane';
import { MappingPane } from './panes/MappingPane';
import { WritingSectionPane } from './panes/WritingSectionPane';
import { GraphPaperNodePane } from './panes/GraphPaperNodePane';
import { GraphConceptNodePane } from './panes/GraphConceptNodePane';
import { NoteContextPane } from './panes/NoteContextPane';
import { MultiPaperPane } from './panes/MultiPaperPane';
import { AllPapersSummaryPane } from './panes/AllPapersSummaryPane';

import { AdvisoryNotifications } from './advisory/AdvisoryNotifications';
import { ContextPanelErrorBoundary } from '../../app/ErrorBoundaries';

import type { ContextSource } from '../../../shared-types/models';

/**
 * §3.1 分发策略：根据 ContextSource.type 决定渲染哪个 ContentPane
 */
function renderContentPane(source: ContextSource): React.ReactNode {
  switch (source.type) {
    case 'paper':
      return source.originView === 'reader' ? (
        <ReaderPaperPane paperId={source.paperId} />
      ) : (
        <LibraryPaperPane paperId={source.paperId} />
      );
    case 'papers':
      return <MultiPaperPane paperIds={source.paperIds} />;
    case 'allSelected':
      return <AllPapersSummaryPane excludedCount={source.excludedCount} />;
    case 'concept':
      return <ConceptPane conceptId={source.conceptId} />;
    case 'mapping':
      return (
        <MappingPane
          mappingId={source.mappingId}
          paperId={source.paperId}
          conceptId={source.conceptId}
        />
      );
    case 'section':
      return (
        <WritingSectionPane
          articleId={source.articleId}
          sectionId={source.sectionId}
        />
      );
    case 'memo':
      return <NoteContextPane nodeId={source.memoId} nodeType="memo" />;
    case 'note':
      return <NoteContextPane nodeId={source.noteId} nodeType="note" />;
    case 'graphNode':
      return source.nodeType === 'paper' ? (
        <GraphPaperNodePane nodeId={source.nodeId} />
      ) : (
        <GraphConceptNodePane nodeId={source.nodeId} />
      );
    case 'empty':
      return null; // ContextBody is hidden when empty — handled by EmptyContextHint
  }
}

export function ContextPanel() {
  const { t } = useTranslation();
  const effectiveSource = useEffectiveSource();
  // 多论文模式下 transitionKey 固定为 'papers'，
  // 避免每增减一篇论文触发整面板 crossfade 动画。
  // 列表增删动画由 MultiPaperPane 内部处理。
  const transitionKey = effectiveSource.type === 'papers'
    ? 'papers'
    : contextSourceKey(effectiveSource);
  const chatDockMode = useChatStore((s) => s.chatDockMode);
  const isFullscreen = chatDockMode === 'fullscreen';
  const isEmpty = effectiveSource.type === 'empty';

  const showContextBody = !isFullscreen && !isEmpty;

  return (
    <div
      role="complementary"
      aria-label={t('context.title')}
      style={{
        height: '100%',
        backgroundColor: 'var(--bg-surface-low)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* §4 ContextHeader — 始终可见 */}
      <ContextHeader />

      {/* v1.2 Advisory Agent 建议通知 */}
      <AdvisoryNotifications />

      {/* 空状态提示条 — 仅入场动画 */}
      {isEmpty && !isFullscreen && <EmptyContextHint />}

      {/* §1.2 ContextBody + ChatDock 空间竞争 */}
      <PanelGroup
        direction="vertical"
        autoSaveId="abyssal-context-body-chat"
        style={{ flex: 1 }}
      >
        {/* ContextBody — 有实体时显示，入场淡入 */}
        {showContextBody && (
          <>
            <Panel
              id="context-body"
              minSize={15}
              defaultSize={35}
              order={1}
            >
              <div className="ctx-body-enter" style={{ height: '100%' }}>
                <ContextPanelErrorBoundary>
                  <CrossfadeTransition transitionKey={transitionKey}>
                    {renderContentPane(effectiveSource)}
                  </CrossfadeTransition>
                </ContextPanelErrorBoundary>
              </div>
            </Panel>

            <PanelResizeHandle className="panel-resize-handle" />
          </>
        )}

        {/* ChatDock */}
        <Panel
          id="chat-dock"
          minSize={isFullscreen || isEmpty ? 100 : 20}
          defaultSize={isFullscreen || isEmpty ? 100 : 65}
          collapsible={!isFullscreen && !isEmpty}
          order={2}
        >
          <ContextPanelErrorBoundary>
            <ChatDock />
          </ContextPanelErrorBoundary>
        </Panel>
      </PanelGroup>
    </div>
  );
}

// ─── EmptyContextHint ───

import { Search, BookOpen, FileText, BarChart3, Network } from 'lucide-react';

const hintItems = [
  { icon: <BookOpen size={11} />, label: 'Library', color: '#60a5fa' },
  { icon: <FileText size={11} />, label: 'Reader', color: '#34d399' },
  { icon: <BarChart3 size={11} />, label: 'Analysis', color: '#f472b6' },
  { icon: <Network size={11} />, label: 'Graph', color: '#a78bfa' },
];

function EmptyContextHint() {
  const { t } = useTranslation();
  return (
    <div
      className="ctx-hint-enter"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        flexShrink: 0,
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      <Search size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
      <span>{t('context.selectEntity')}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        {hintItems.map((item) => (
          <span
            key={item.label}
            title={item.label}
            style={{ color: item.color, display: 'flex', opacity: 0.6 }}
          >
            {item.icon}
          </span>
        ))}
      </div>
    </div>
  );
}
