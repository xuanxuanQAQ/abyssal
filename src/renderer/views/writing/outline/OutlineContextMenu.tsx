/**
 * OutlineContextMenu -- Radix ContextMenu wrapping each outline node
 *
 * Menu items:
 *   AI 生成内容 | 设置写作指令 | 添加子节 | 在上方插入节 | 在下方插入节
 *   查看版本历史 | 设置状态 (submenu) | 删除
 */

import React, { useCallback } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  useCreateSection,
  useDeleteSection,
  useUpdateSection,
} from '../../../core/ipc/hooks/useArticles';
import { useAppStore, type AppStoreState } from '../../../core/store';
import type { SectionStatus } from '../../../../shared-types/enums';

interface OutlineContextMenuProps {
  sectionId: string;
  sectionTitle: string;
  parentId: string | null;
  sortIndex: number;
  articleId: string;
  currentStatus: SectionStatus;
  children: React.ReactNode;
}

const STATUS_OPTIONS: Array<{ value: SectionStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'drafted', label: 'Drafted' },
  { value: 'revised', label: 'Revised' },
  { value: 'finalized', label: 'Finalized' },
];

const menuContentStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 4,
  minWidth: 200,
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  zIndex: 35,
};

const menuItemStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  outline: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-subtle)',
  margin: '4px 0',
};

export function OutlineContextMenu({
  sectionId,
  sectionTitle,
  parentId,
  sortIndex,
  articleId,
  currentStatus,
  children,
}: OutlineContextMenuProps) {
  const createSection = useCreateSection();
  const deleteSection = useDeleteSection();
  const updateSection = useUpdateSection();
  const selectSection = useAppStore((s: AppStoreState) => s.selectSection);

  const handleAIGenerate = useCallback(() => {
    // TODO: pipeline.start backend integration
    selectSection(sectionId);
  }, [sectionId, selectSection]);

  const handleWritingInstructions = useCallback(() => {
    // TODO: open Dialog to edit writingInstructions
    selectSection(sectionId);
  }, [sectionId, selectSection]);

  const handleAddChild = useCallback(() => {
    createSection.mutate({
      articleId,
      parentId: sectionId,
      sortIndex: 0,
    });
  }, [articleId, sectionId, createSection]);

  const handleInsertAbove = useCallback(() => {
    createSection.mutate({
      articleId,
      parentId,
      sortIndex: sortIndex - 1,
    });
  }, [articleId, parentId, sortIndex, createSection]);

  const handleInsertBelow = useCallback(() => {
    createSection.mutate({
      articleId,
      parentId,
      sortIndex: sortIndex + 1,
    });
  }, [articleId, parentId, sortIndex, createSection]);

  const handleVersionHistory = useCallback(() => {
    // TODO: open VersionHistoryDialog
    selectSection(sectionId);
  }, [sectionId, selectSection]);

  const handleSetStatus = useCallback(
    (status: SectionStatus) => {
      updateSection.mutate({ sectionId, patch: { status } });
    },
    [sectionId, updateSection],
  );

  const handleDelete = useCallback(() => {
    // Simple confirm guard; a proper Dialog can replace this later
    const confirmed = window.confirm(
      `确认删除节 "${sectionTitle}" 吗？此操作不可撤销。`,
    );
    if (confirmed) {
      deleteSection.mutate({ sectionId, articleId });
    }
  }, [sectionId, articleId, sectionTitle, deleteSection]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content style={menuContentStyle}>
          {/* AI */}
          <ContextMenu.Item style={menuItemStyle} onSelect={handleAIGenerate}>
            AI 生成内容
          </ContextMenu.Item>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleWritingInstructions}
          >
            设置写作指令
          </ContextMenu.Item>

          <ContextMenu.Separator style={separatorStyle} />

          {/* Structure */}
          <ContextMenu.Item style={menuItemStyle} onSelect={handleAddChild}>
            添加子节
          </ContextMenu.Item>
          <ContextMenu.Item style={menuItemStyle} onSelect={handleInsertAbove}>
            在上方插入节
          </ContextMenu.Item>
          <ContextMenu.Item style={menuItemStyle} onSelect={handleInsertBelow}>
            在下方插入节
          </ContextMenu.Item>

          <ContextMenu.Separator style={separatorStyle} />

          {/* History */}
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleVersionHistory}
          >
            查看版本历史
          </ContextMenu.Item>

          {/* Status submenu */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger style={menuItemStyle}>
              设置状态 \u25B8
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent style={menuContentStyle}>
                {STATUS_OPTIONS.map((opt) => (
                  <ContextMenu.Item
                    key={opt.value}
                    style={menuItemStyle}
                    onSelect={() => handleSetStatus(opt.value)}
                  >
                    {opt.label}
                    {currentStatus === opt.value && ' \u2713'}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator style={separatorStyle} />

          {/* Danger */}
          <ContextMenu.Item
            style={{ ...menuItemStyle, color: 'var(--danger)' }}
            onSelect={handleDelete}
          >
            删除
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
