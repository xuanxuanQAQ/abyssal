/**
 * OutlineNode -- single tree row rendered by react-arborist
 *
 * Layout: indent | numbering | status icon | title (ellipsis) | word count
 *
 * - Single click  -> select section in store
 * - Double click  -> enter inline rename (react-arborist node.edit())
 */

import React from 'react';
import type { NodeRendererProps } from 'react-arborist';
import { useAppStore, type AppStoreState } from '../../../core/store';
import type { NumberingMap } from './useNumbering';
import type { SectionStatus } from '../../../../shared-types/enums';
import type { TreeNodeData } from './useOutlineTree';
import { EvidenceWarningIcon } from './EvidenceWarningIcon';

const STATUS_ICON: Record<SectionStatus, string> = {
  pending: '\u2B1C',   // white square
  drafted: '\u270F\uFE0F',   // pencil
  revised: '\uD83D\uDD04',   // cycle arrows
  finalized: '\u2705', // check mark
};

interface OutlineNodeProps {
  nodeProps: NodeRendererProps<TreeNodeData>;
  numberingMap: NumberingMap;
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
};

const numberStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs)',
  flexShrink: 0,
  minWidth: 24,
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: 'var(--text-primary)',
};

const wordCountStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs)',
  flexShrink: 0,
  textAlign: 'right',
  minWidth: 32,
};

export function OutlineNode({ nodeProps, numberingMap }: OutlineNodeProps) {
  const { node, style, dragHandle } = nodeProps;
  const data = node.data;

  const selectedSectionId = useAppStore((s: AppStoreState) => s.selectedSectionId);
  const selectSection = useAppStore((s: AppStoreState) => s.selectSection);

  const isSelected = selectedSectionId === data.id;
  const numbering = numberingMap[data.id] ?? '';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectSection(data.id);
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
        backgroundColor: isSelected ? 'var(--accent-color-10)' : 'transparent',
        paddingLeft: `${(node.level ?? 0) * 20 + 8}px`,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <span style={numberStyle}>{numbering}</span>
      <span style={{ flexShrink: 0 }}>{STATUS_ICON[(data as TreeNodeData).status]}</span>
      <EvidenceWarningIcon status={(data as TreeNodeData).evidenceStatus} />
      <span style={titleStyle}>{data.name}</span>
      <span style={wordCountStyle}>{data.wordCount}</span>
    </div>
  );
}
