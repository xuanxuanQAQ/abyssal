/**
 * LibraryView — Library 视图顶层容器（§1.1）
 *
 * 水平 PanelGroup：LibrarySidebar（230px 默认）+ PaperTable（弹性填满）。
 * 视图级快捷键：Ctrl+Shift+B 折叠 Sidebar。
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../../core/store';
import { LibrarySidebar } from './sidebar/LibrarySidebar';
import { PaperTable } from './table/PaperTable';
import { ExternalFileDrop } from './dnd/ExternalFileDrop';
import { usePaperList, usePaperCounts } from '../../core/ipc/hooks/usePapers';
import type { PaperFilter } from '../../../shared-types/ipc';

/**
 * 根据 activeGroupId/Type/TagIds 构建 PaperFilter
 */
function useLibraryFilter(): PaperFilter | undefined {
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const activeGroupType = useAppStore((s) => s.activeGroupType);
  const activeTagIds = useAppStore((s) => s.activeTagIds);

  return useMemo(() => {
    if (activeGroupType === 'smart') {
      switch (activeGroupId) {
        case 'all':
          return undefined;
        case 'seeds':
          return { relevance: ['seed'] };
        case 'high':
          return { relevance: ['high'] };
        case 'medium':
          return { relevance: ['medium'] };
        case 'low':
          return { relevance: ['low'] };
        case 'excluded':
          return { relevance: ['excluded'] };
        case 'pending_analysis':
          return { analysisStatus: ['not_started'] };
        case 'needs_review':
          return { analysisStatus: ['needs_review'] };
        case 'no_fulltext':
          return { fulltextStatus: ['failed', 'not_attempted'] };
        default:
          return undefined;
      }
    }

    if (activeGroupType === 'tag') {
      const tags = activeTagIds.length > 0 ? activeTagIds : [activeGroupId];
      return { tags };
    }

    if (activeGroupType === 'search') {
      return { discoverRunId: activeGroupId };
    }

    return undefined;
  }, [activeGroupId, activeGroupType, activeTagIds]);
}

export function LibraryView() {
  const librarySidebarOpen = useAppStore((s) => s.librarySidebarOpen);
  const toggleLibrarySidebar = useAppStore((s) => s.toggleLibrarySidebar);

  const filter = useLibraryFilter();
  const { data: papers, isLoading } = usePaperList(filter);
  const { data: counts } = usePaperCounts();

  // 视图级快捷键：Ctrl+Shift+B 折叠 Sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        toggleLibrarySidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLibrarySidebar]);

  const handleSidebarResize = useCallback(
    (size: number) => {
      // PanelGroup 使用百分比，转换为像素由内部处理
      // 这里仅用于检测折叠
      if (size === 0 && librarySidebarOpen) {
        toggleLibrarySidebar();
      }
    },
    [librarySidebarOpen, toggleLibrarySidebar]
  );

  return (
    <div className="workspace-view workspace-view--library" style={{ height: '100%', position: 'relative' }}>
      <ExternalFileDrop>
        <PanelGroup
          className="workspace-panel-group"
          direction="horizontal"
          autoSaveId="abyssal-library"
        >
          {librarySidebarOpen && (
            <>
              <Panel
                id="library-sidebar"
                order={1}
                defaultSize={20}
                minSize={10}
                maxSize={25}
                collapsible
                onCollapse={() => {
                  if (librarySidebarOpen) toggleLibrarySidebar();
                }}
              >
                <div className="workspace-side-stage library-sidebar-stage">
                  <LibrarySidebar counts={counts ?? null} />
                </div>
              </Panel>
              <PanelResizeHandle
                style={{
                  width: 4,
                  backgroundColor: 'transparent',
                  cursor: 'col-resize',
                  transition: 'background-color 150ms',
                }}
                className="panel-resize-handle"
              />
            </>
          )}
          <Panel id="library-table" order={2} minSize={50}>
            <div className="workspace-main-stage library-table-stage">
              <PaperTable
                papers={papers ?? []}
                isLoading={isLoading}
                filter={filter}
              />
            </div>
          </Panel>
        </PanelGroup>
      </ExternalFileDrop>
    </div>
  );
}
