import React, { useEffect, useRef } from 'react';
import type { HeatmapCell } from '../../../../../../shared-types/models';

interface CellContextMenuProps {
  cell: HeatmapCell | null;
  position: { x: number; y: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewEvidence: () => void;
  onOpenInReader: () => void;
  onAccept: () => void;
  onReject: () => void;
}

const menuContentStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 40,
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

const menuItemDisabledStyle: React.CSSProperties = {
  ...menuItemStyle,
  opacity: 0.4,
  cursor: 'default',
  pointerEvents: 'none',
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
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? undefined : -1}
      aria-disabled={disabled}
      style={{
        ...(disabled ? menuItemDisabledStyle : menuItemStyle),
        ...(!disabled && hovered ? menuItemHoverStyle : {}),
      }}
      onMouseEnter={() => {
        if (!disabled) setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {label}
    </div>
  );
}

function CellContextMenu({
  cell,
  position,
  open,
  onOpenChange,
  onViewEvidence,
  onOpenInReader,
  onAccept,
  onReject,
}: CellContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside and Escape handler
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

  if (!open || !cell || !position) return null;

  // Determine disabled states based on cell existence
  // Accept/reject are disabled when already in that state
  const isAccepted = false; // Adjudication status is not on HeatmapCell; caller controls via callbacks
  const isRejected = false;

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
      <MenuItem
        label="查看证据详情"
        onClick={() => {
          onViewEvidence();
          onOpenChange(false);
        }}
        disabled={false}
      />
      <MenuItem
        label="在Reader中打开"
        onClick={() => {
          onOpenInReader();
          onOpenChange(false);
        }}
        disabled={false}
      />
      <div style={separatorStyle} />
      <MenuItem
        label="接受映射"
        onClick={() => {
          onAccept();
          onOpenChange(false);
        }}
        disabled={isAccepted}
      />
      <MenuItem
        label="拒绝映射"
        onClick={() => {
          onReject();
          onOpenChange(false);
        }}
        disabled={isRejected}
      />
    </div>
  );
}

export { CellContextMenu };
export type { CellContextMenuProps };
