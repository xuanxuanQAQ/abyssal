import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../../core/store';

interface NodeContextMenuProps {
  nodeId: string | null;
  nodeType: 'paper' | 'concept' | null;
  position: { x: number; y: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnpin: (nodeId: string) => void;
  isPinned: boolean;
}

const menuContentStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 30,
  minWidth: 180,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 0',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
};

const menuItemStyle: React.CSSProperties = {
  padding: '6px 12px',
  cursor: 'pointer',
  userSelect: 'none',
};

const menuItemHoverStyle: React.CSSProperties = {
  background: 'var(--accent-color)',
  color: '#fff',
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  margin: '4px 0',
  background: 'var(--border-subtle)',
};

function MenuItem({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      role="menuitem"
      tabIndex={-1}
      style={{
        ...menuItemStyle,
        ...(hovered ? menuItemHoverStyle : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {label}
    </div>
  );
}

function NodeContextMenu({
  nodeId,
  nodeType,
  position,
  open,
  onOpenChange,
  onUnpin,
  isPinned,
}: NodeContextMenuProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const focusGraphNode = useAppStore((s) => s.focusGraphNode);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside handler
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onOpenChange]);

  if (!open || !nodeId || !position) return null;

  const isPaper = nodeType === 'paper';

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        ...menuContentStyle,
        left: position.x,
        top: position.y,
      }}
    >
      {isPaper && (
        <MenuItem
          label="在 Library 中查看"
          onClick={() => {
            navigateTo({ type: 'paper', id: nodeId, view: 'library' });
            onOpenChange(false);
          }}
        />
      )}
      {isPaper && (
        <MenuItem
          label="在 Reader 中打开"
          onClick={() => {
            // TODO: check fulltextStatus before navigating
            navigateTo({ type: 'paper', id: nodeId, view: 'reader' });
            onOpenChange(false);
          }}
        />
      )}
      {isPaper && (
        <MenuItem
          label="查看分析报告"
          onClick={() => {
            // TODO: check analysisStatus before navigating
            navigateTo({ type: 'paper', id: nodeId, view: 'analysis' });
            onOpenChange(false);
          }}
        />
      )}
      {isPaper && <div style={separatorStyle} />}
      <MenuItem
        label="以此为焦点展开"
        onClick={() => {
          focusGraphNode(nodeId);
          onOpenChange(false);
        }}
      />
      {isPinned && (
        <MenuItem
          label="释放固定位置"
          onClick={() => {
            onUnpin(nodeId);
            onOpenChange(false);
          }}
        />
      )}
    </div>
  );
}

export { NodeContextMenu };
export type { NodeContextMenuProps };
