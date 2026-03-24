/**
 * OutlineTree -- main tree container using react-arborist
 *
 * - Uses `useOutlineTree` for data + DnD/rename callbacks
 * - Renders `OutlineNode` for each row, wrapped by `OutlineContextMenu`
 * - Uses `OutlineNodeTitle` for inline editing
 * - Fixed width, scrollable container
 * - TODO: @dnd-kit DropTarget registration for cross-view drops from Library
 */

import React, { useRef, useMemo } from 'react';
import { Tree } from 'react-arborist';
import type { NodeRendererProps } from 'react-arborist';
import type { ArticleOutline } from '../../../../shared-types/models';
import { useOutlineTree } from './useOutlineTree';
import type { TreeNodeData } from './useOutlineTree';
import { OutlineNode } from './OutlineNode';
import { OutlineNodeTitle } from './OutlineNodeTitle';
import { OutlineContextMenu } from './OutlineContextMenu';
import { OutlineMetadata } from './OutlineMetadata';
import { computeNumbering } from './useNumbering';

interface OutlineTreeProps {
  article: ArticleOutline;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 280,
  height: '100%',
  borderRight: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-base)',
  overflow: 'hidden',
};

const treeContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
};

const ROW_HEIGHT = 32;

export function OutlineTree({ article }: OutlineTreeProps) {
  const treeRef = useRef<HTMLDivElement>(null);

  const { treeData, disableDrop, onMove, onRename } = useOutlineTree(
    article.id,
    article.sections,
  );

  const numberingMap = useMemo(
    () => computeNumbering(article.sections),
    [article.sections],
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
            paddingLeft: `${(node.level ?? 0) * 20 + 8}px`,
            paddingRight: 8,
            height: '100%',
          }}
        >
          <OutlineNodeTitle node={node} />
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
        articleId={article.id}
        currentStatus={data.status}
      >
        <div>
          <OutlineNode nodeProps={nodeProps} numberingMap={numberingMap} />
        </div>
      </OutlineContextMenu>
    );
  };

  return (
    <div style={containerStyle}>
      <div ref={treeRef} style={treeContainerStyle}>
        <Tree<TreeNodeData>
          data={treeData}
          rowHeight={ROW_HEIGHT}
          indent={20}
          openByDefault
          disableDrop={disableDrop}
          onMove={onMove}
          onRename={onRename}
        >
          {renderNode}
        </Tree>
      </div>
      <OutlineMetadata article={article} />
    </div>
  );
}
