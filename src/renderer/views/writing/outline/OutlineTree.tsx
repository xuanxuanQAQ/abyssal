/**
 * OutlineTree -- main tree container using react-arborist
 *
 * - Uses `useOutlineTree` for data + DnD/rename callbacks
 * - Renders `OutlineNode` for each row, wrapped by `OutlineContextMenu`
 * - Uses `OutlineNodeTitle` for inline editing
 * - Fixed width, scrollable container
 * - TODO: @dnd-kit DropTarget registration for cross-view drops from Library
 */

import React, { useRef, useCallback } from 'react';
import { Tree } from 'react-arborist';
import type { NodeRendererProps } from 'react-arborist';
import { useTranslation } from 'react-i18next';
import type { DraftOutline } from '../../../../shared-types/models';
import { useOutlineTree } from './useOutlineTree';
import type { TreeNodeData } from './useOutlineTree';
import { OutlineNode } from './OutlineNode';
import { OutlineNodeTitle } from './OutlineNodeTitle';
import { OutlineContextMenu } from './OutlineContextMenu';
import { OutlineMetadata } from './OutlineMetadata';
import { useCreateDraftSection } from '../../../core/ipc/hooks/useDrafts';

interface OutlineTreeProps {
  articleId: string;
  draft: DraftOutline;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  backgroundColor: 'var(--bg-base)',
  overflow: 'hidden',
};

const treeContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '4px 6px 0 5px',
};

const ROW_HEIGHT = 32;
const BASE_PADDING_LEFT = 5;
const LEVEL_INDENT = 11;

// ── Empty state: no sections yet ──

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 12,
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm)',
  userSelect: 'none',
};

const addButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: 'var(--text-on-accent)',
  backgroundColor: 'var(--accent-color)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

function EmptyOutline({ draftId }: { draftId: string }) {
  const { t } = useTranslation();
  const createSection = useCreateDraftSection();

  const handleCreate = useCallback(() => {
    createSection.mutate({ draftId, parentId: null, sortIndex: 0 });
  }, [draftId, createSection]);

  return (
    <div style={emptyStyle}>
      <span>{t('writing.outline.empty', '暂无大纲节点')}</span>
      <button
        type="button"
        style={addButtonStyle}
        onClick={handleCreate}
        disabled={createSection.isPending}
      >
        {t('writing.outline.addFirst', '+ 添加第一个节')}
      </button>
    </div>
  );
}

export function OutlineTree({ articleId, draft }: OutlineTreeProps) {
  const treeRef = useRef<HTMLDivElement>(null);

  const { treeData, disableDrop, onMove, onRename } = useOutlineTree(
    draft.id,
    draft.sections,
  );

  /** react-arborist node renderer */
  const renderNode = (nodeProps: NodeRendererProps<TreeNodeData>) => {
    const { node } = nodeProps;
    const data = node.data;

    // When editing, render the inline title editor
    if (node.isEditing) {
      return (
        <div
          style={{
            ...nodeProps.style,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: `${BASE_PADDING_LEFT + (node.level ?? 0) * LEVEL_INDENT}px`,
            paddingRight: 8,
            height: '100%',
          }}
        >
          <OutlineNodeTitle node={node} draftId={draft.id} />
        </div>
      );
    }

    // Normal view: OutlineNode wrapped by ContextMenu
    return (
      <OutlineContextMenu
        sectionId={data.id}
        sectionTitle={data.name}
        parentId={data.parentId}
        sortIndex={data.sortIndex}
          articleId={articleId}
          draftId={draft.id}
        currentStatus={data.status}
      >
          <div>
            <OutlineNode nodeProps={nodeProps} articleId={articleId} draftId={draft.id} />
        </div>
      </OutlineContextMenu>
    );
  };

  return (
    <div style={containerStyle}>
      <div ref={treeRef} style={treeContainerStyle}>
        {treeData.length > 0 ? (
          <Tree<TreeNodeData>
            data={treeData}
            rowHeight={ROW_HEIGHT}
            indent={LEVEL_INDENT}
            openByDefault
            disableDrop={disableDrop}
            onMove={onMove}
            onRename={onRename}
          >
            {renderNode}
          </Tree>
        ) : (
          <EmptyOutline draftId={draft.id} />
        )}
      </div>
      <OutlineMetadata draft={draft} />
    </div>
  );
}
