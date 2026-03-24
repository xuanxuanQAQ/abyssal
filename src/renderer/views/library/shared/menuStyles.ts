/**
 * Library 上下文菜单共享样式
 *
 * 替代 RowContextMenu / BatchActionBar / TableToolbar 中的重复定义。
 */

export const menuContentStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 4,
  minWidth: 200,
  boxShadow: 'var(--shadow-md)',
  zIndex: 35,
};

export const menuItemStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  outline: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

export const menuSeparatorStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-subtle)',
  margin: '4px 0',
};
