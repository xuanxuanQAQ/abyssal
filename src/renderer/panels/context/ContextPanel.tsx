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
import { EmptyPane } from './panes/EmptyPane';

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
      return <EmptyPane />;
  }
}

export function ContextPanel() {
  const effectiveSource = useEffectiveSource();
  const transitionKey = contextSourceKey(effectiveSource);
  const chatDockMode = useChatStore((s) => s.chatDockMode);
  const isFullscreen = chatDockMode === 'fullscreen';

  return (
    <div
      role="complementary"
      aria-label="上下文面板"
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

      {/* §1.2 ContextBody + ChatDock 空间竞争 */}
      <PanelGroup
        direction="vertical"
        autoSaveId="abyssal-context-body-chat"
        style={{ flex: 1 }}
      >
        {/* ContextBody — ChatDock 全屏时条件渲染移除 */}
        {!isFullscreen && (
          <>
            <Panel
              id="context-body"
              minSize={20}
              defaultSize={60}
              order={1}
            >
              <ContextPanelErrorBoundary>
                <CrossfadeTransition transitionKey={transitionKey}>
                  {renderContentPane(effectiveSource)}
                </CrossfadeTransition>
              </ContextPanelErrorBoundary>
            </Panel>

            <PanelResizeHandle className="panel-resize-handle" />
          </>
        )}

        {/* ChatDock */}
        <Panel
          id="chat-dock"
          minSize={isFullscreen ? 100 : 10}
          defaultSize={isFullscreen ? 100 : 40}
          collapsible={!isFullscreen}
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
