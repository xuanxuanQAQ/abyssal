/**
 * OutlineNode -- single tree row rendered by react-arborist
 *
 * Layout: compact indent | numbering | title (ellipsis) | evidence | word count
 *
 * - Single click  -> select section in store
 * - Double click  -> enter inline rename (react-arborist node.edit())
 */

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NodeRendererProps } from 'react-arborist';
import { useAppStore, type AppStoreState } from '../../../core/store';
import { getAPI } from '../../../core/ipc/bridge';
import { buildWritingContextQueryKey } from '../../../core/ipc/hooks/useRAG';
import type { TreeNodeData } from './useOutlineTree';
import { EvidenceWarningIcon } from './EvidenceWarningIcon';

interface OutlineNodeProps {
  nodeProps: NodeRendererProps<TreeNodeData>;
  articleId: string;
  draftId: string;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingRight: 8,
  cursor: 'pointer',
  height: '100%',
  userSelect: 'none',
  fontSize: 'var(--text-sm)',
  whiteSpace: 'nowrap',
  borderRadius: 8,
  transition: 'background-color 120ms ease, color 120ms ease',
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: 'var(--text-primary)',
  minWidth: 0,
  letterSpacing: '0.01em',
};

const wordCountStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '11px',
  flexShrink: 0,
  textAlign: 'right',
  minWidth: 32,
  opacity: 0.72,
};

const BASE_PADDING_LEFT = 5;
const LEVEL_INDENT = 11;

export function OutlineNode({ nodeProps, articleId, draftId }: OutlineNodeProps) {
  const { node, style, dragHandle } = nodeProps;
  const data = node.data;
  const queryClient = useQueryClient();

  const selectedSectionId = useAppStore((s: AppStoreState) => s.selectedSectionId);
  const selectSection = useAppStore((s: AppStoreState) => s.selectSection);

  const isSelected = selectedSectionId === data.id;
  const level = node.level ?? 0;
  const writingContextRequest = React.useMemo(() => ({
    articleId,
    draftId,
    sectionId: data.id,
    mode: 'draft' as const,
  }), [articleId, data.id, draftId]);

  const primeSectionContext = React.useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: buildWritingContextQueryKey(writingContextRequest),
      queryFn: () => getAPI().rag.getWritingContext(writingContextRequest),
      staleTime: 30_000,
    });
  }, [queryClient, writingContextRequest]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    primeSectionContext();
    selectSection(data.id, articleId, draftId);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    node.edit();
  };

  return (
    <div
      ref={dragHandle}
      style={{
        ...style,
        ...rowStyle,
        backgroundColor: isSelected ? 'color-mix(in srgb, var(--accent-color) 12%, transparent)' : 'transparent',
        boxShadow: isSelected ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent-color) 18%, transparent)' : 'none',
        paddingLeft: BASE_PADDING_LEFT + level * LEVEL_INDENT,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={primeSectionContext}
      title={data.name}
    >
      <span
        style={{
          ...titleStyle,
          fontWeight: isSelected ? 600 : 500,
        }}
      >
        {data.name}
      </span>
      <EvidenceWarningIcon status={(data as TreeNodeData).evidenceStatus} />
      <span style={wordCountStyle}>{data.wordCount}</span>
    </div>
  );
}
