/**
 * OutlineContextMenu -- Radix ContextMenu wrapping each outline node
 *
 * Menu items:
 *   AI 生成内容 | 设置写作指令 | 添加子节 | 在上方插入节 | 在下方插入节
 *   查看版本历史 | 设置状态 (submenu) | 删除
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  useCreateDraftSection,
  useDeleteDraftSection,
  useUpdateDraftSection,
} from '../../../core/ipc/hooks/useDrafts';
import { useStartPipeline } from '../../../core/ipc/hooks/usePipeline';
import { useDeferredMenuAction } from '../../../shared/useDeferredMenuAction';
import { useAppDialog } from '../../../shared/useAppDialog';
import { useAppStore, type AppStoreState } from '../../../core/store';
import type { SectionStatus } from '../../../../shared-types/enums';

interface OutlineContextMenuProps {
  sectionId: string;
  sectionTitle: string;
  parentId: string | null;
  sortIndex: number;
  articleId: string;
  draftId: string;
  currentStatus: SectionStatus;
  children: React.ReactNode;
}

const STATUS_KEYS: Array<{ value: SectionStatus; key: string }> = [
  { value: 'pending', key: 'writing.outline.statuses.pending' },
  { value: 'drafted', key: 'writing.outline.statuses.drafted' },
  { value: 'revised', key: 'writing.outline.statuses.revised' },
  { value: 'finalized', key: 'writing.outline.statuses.finalized' },
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
  draftId,
  currentStatus,
  children,
}: OutlineContextMenuProps) {
  const { t } = useTranslation();
  const createSection = useCreateDraftSection();
  const deleteSection = useDeleteDraftSection();
  const updateSection = useUpdateDraftSection();
  const startPipeline = useStartPipeline();
  const deferMenuAction = useDeferredMenuAction();
  const { confirm, prompt: promptDialog, dialog } = useAppDialog();
  const selectSection = useAppStore((s: AppStoreState) => s.selectSection);

  const handleAIGenerate = useCallback(() => {
    deferMenuAction(() => {
      selectSection(sectionId, articleId, draftId);
      startPipeline.mutate({ workflow: 'generate', config: { articleId, draftId, sectionId } });
    });
  }, [articleId, deferMenuAction, draftId, sectionId, selectSection, startPipeline]);

  const handleWritingInstructions = useCallback(() => {
    deferMenuAction(async () => {
      selectSection(sectionId, articleId, draftId);
      const instructions = await promptDialog({
        title: t('writing.outline.setInstruction'),
        description: '写作指令 / Writing instructions:',
        confirmLabel: t('common.confirm'),
      });
      if (instructions !== null) {
        updateSection.mutate({ draftId, sectionId, patch: { writingInstructions: instructions } });
      }
    });
  }, [articleId, deferMenuAction, draftId, promptDialog, sectionId, selectSection, t, updateSection]);

  const handleAddChild = useCallback(() => {
    deferMenuAction(() => {
      createSection.mutate({
        draftId,
        parentId: sectionId,
        sortIndex: 0,
      });
    });
  }, [createSection, deferMenuAction, draftId, sectionId]);

  const handleInsertAbove = useCallback(() => {
    deferMenuAction(() => {
      createSection.mutate({
        draftId,
        parentId,
        sortIndex: sortIndex - 1,
      });
    });
  }, [createSection, deferMenuAction, draftId, parentId, sortIndex]);

  const handleInsertBelow = useCallback(() => {
    deferMenuAction(() => {
      createSection.mutate({
        draftId,
        parentId,
        sortIndex: sortIndex + 1,
      });
    });
  }, [createSection, deferMenuAction, draftId, parentId, sortIndex]);

  const handleVersionHistory = useCallback(() => {
    deferMenuAction(() => {
      selectSection(sectionId, articleId, draftId);
      window.dispatchEvent(new CustomEvent('abyssal:openVersionHistory', { detail: { sectionId, draftId } }));
    });
  }, [articleId, deferMenuAction, draftId, sectionId, selectSection]);

  const handleSetStatus = useCallback(
    (status: SectionStatus) => {
      deferMenuAction(() => {
        updateSection.mutate({ draftId, sectionId, patch: { status } });
      });
    },
    [deferMenuAction, draftId, sectionId, updateSection],
  );

  const handleDelete = useCallback(() => {
    deferMenuAction(async () => {
      const confirmed = await confirm({
        title: t('common.delete'),
        description: t('writing.outline.deleteConfirm', { title: sectionTitle }),
        confirmLabel: t('common.delete'),
        confirmTone: 'danger',
      });
      if (confirmed) {
        deleteSection.mutate({ draftId, sectionId });
      }
    });
  }, [confirm, deferMenuAction, draftId, sectionId, sectionTitle, deleteSection, t]);

  return (
    <>
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content style={menuContentStyle}>
          {/* AI */}
          <ContextMenu.Item style={menuItemStyle} onSelect={handleAIGenerate}>
            {t('writing.outline.aiGenerate')}
          </ContextMenu.Item>
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleWritingInstructions}
          >
            {t('writing.outline.setInstruction')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={separatorStyle} />

          {/* Structure */}
          <ContextMenu.Item style={menuItemStyle} onSelect={handleAddChild}>
            {t('writing.outline.addChild')}
          </ContextMenu.Item>
          <ContextMenu.Item style={menuItemStyle} onSelect={handleInsertAbove}>
            {t('writing.outline.insertAbove')}
          </ContextMenu.Item>
          <ContextMenu.Item style={menuItemStyle} onSelect={handleInsertBelow}>
            {t('writing.outline.insertBelow')}
          </ContextMenu.Item>

          <ContextMenu.Separator style={separatorStyle} />

          {/* History */}
          <ContextMenu.Item
            style={menuItemStyle}
            onSelect={handleVersionHistory}
          >
            {t('writing.outline.viewHistory')}
          </ContextMenu.Item>

          {/* Status submenu */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger style={menuItemStyle}>
              {t('writing.outline.setStatus')} &#x25B8;
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent style={menuContentStyle}>
                {STATUS_KEYS.map((opt) => (
                  <ContextMenu.Item
                    key={opt.value}
                    style={menuItemStyle}
                    onSelect={() => handleSetStatus(opt.value)}
                  >
                    {t(opt.key)}
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
            {t('common.delete')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
    {dialog}
    </>
  );
}
