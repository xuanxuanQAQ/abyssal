/**
 * ProjectSelector — 项目选择下拉按钮（§3.4）
 *
 * 显示当前项目名称，点击弹出项目列表。
 * 工作区热切换：无需重启 app，主进程切换 DB 后通知 renderer 刷新。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FolderOpen, Plus, ChevronDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getAPI } from '../../core/ipc/bridge';
import { isShutdownError } from '../../core/errors/types';
import { resetAppStoreForProjectSwitch, useAppStore } from '../../core/store';
import type { ProjectInfo } from '../../../shared-types/models';
import { Z_INDEX } from '../../styles/zIndex';

export function ProjectSelector() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  // 加载当前项目信息
  useEffect(() => {
    getAPI()
      .app.getProjectInfo()
      .then(setCurrentProject)
      .catch((err: unknown) => {
        if (!isShutdownError(err)) console.warn('[ProjectSelector] Failed to load projects:', err);
      });
  }, []);

  // 监听工作区热切换事件 — 主进程切换完成后刷新前端
  useEffect(() => {
    const unsub = getAPI().workspace.onSwitched((event) => {
      // 清空所有缓存 + 重置 store
      queryClient.clear();
      resetAppStoreForProjectSwitch();

      // 更新当前项目显示
      setCurrentProject({ name: event.name, paperCount: 0, conceptCount: 0, lastModified: new Date().toISOString() });

      // 重新拉取真实数据
      getAPI().app.getProjectInfo().then(setCurrentProject).catch(() => {});

      toast.success(t('projectSelector.switchedTo', { name: event.name }));
    });
    return unsub;
  }, [queryClient]);

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    try {
      const list = await getAPI().app.listProjects();
      setProjects(list);
    } catch {
      // stub 模式下静默
    }
  }, []);

  const handleSwitchProject = useCallback(
    async (projectPath: string) => {
      try {
        await getAPI().workspace.switch(projectPath);
        // renderer 侧刷新由 onSwitched 事件处理
      } catch (err) {
        toast.error(`${t('projectSelector.switchFailed')}: ${err instanceof Error ? err.message : ''}`);
      }
    },
    [],
  );

  const handleNewProject = useCallback(() => {
    useAppStore.getState().setProjectWizardOpen(true);
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const wsPath = await getAPI().workspace.openDialog();
      if (!wsPath) return;
      await getAPI().workspace.switch(wsPath);
    } catch (err) {
      toast.error(`${t('projectSelector.openFailed')}: ${err instanceof Error ? err.message : ''}`);
    }
  }, []);

  return (
    <DropdownMenu.Root onOpenChange={(open: boolean) => {
      setIsOpen(open);
      if (open) loadProjects();
    }}>
      <DropdownMenu.Trigger asChild>
        <button
          className="titlebar__interactive project-selector-trigger"
          data-open={isOpen}
          type="button"
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 200,
            height: 30,
            padding: '0 10px',
            border: '1px solid var(--project-selector-border, var(--lens-border))',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--project-selector-bg, var(--lens-surface))',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            boxShadow: 'var(--project-selector-shadow, var(--lens-shadow-soft, var(--lens-shadow)))',
            transition: 'transform var(--duration-fast) var(--easing-default), box-shadow var(--duration-fast) var(--easing-default), background-color var(--duration-fast) var(--easing-default), border-color var(--duration-fast) var(--easing-default)',
          }}
        >
          <FolderOpen size={14} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentProject?.name ?? t('projectSelector.noProject')}
          </span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="project-selector-content"
          sideOffset={4}
          align="start"
          style={{
            minWidth: 200,
            maxWidth: 280,
            backgroundColor: 'var(--lens-surface-strong)',
            border: '1px solid var(--lens-border)',
            borderRadius: 'var(--radius-xl)',
            padding: '4px',
            boxShadow: 'var(--lens-shadow)',
            backdropFilter: 'blur(24px) saturate(1.08)',
            transformOrigin: 'var(--radix-dropdown-menu-content-transform-origin)',
            zIndex: Z_INDEX.DROPDOWN,
          }}
        >
          {/* 项目列表 */}
          {projects.map((project) => (
            <DropdownMenu.Item
              key={project.name}
              onSelect={() => {
                const wsPath = (project as unknown as Record<string, unknown>)['workspacePath'] as string | undefined;
                if (wsPath) handleSwitchProject(wsPath);
              }}
              style={{
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                color:
                  project.name === currentProject?.name
                    ? 'var(--accent-color)'
                    : 'var(--text-primary)',
                outline: 'none',
              }}
            >
              {project.name}
              {project.name === currentProject?.name && ' ✓'}
            </DropdownMenu.Item>
          ))}

          {projects.length > 0 && <DropdownMenu.Separator style={{ height: 1, backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />}

          {/* 新建项目 */}
          <DropdownMenu.Item
            onSelect={handleNewProject}
            style={{
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              outline: 'none',
            }}
          >
            <Plus size={14} /> {t('projectSelector.newProject')}
          </DropdownMenu.Item>

          {/* 打开项目文件夹 */}
          <DropdownMenu.Item
            onSelect={handleOpenFolder}
            style={{
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              outline: 'none',
            }}
          >
            <FolderOpen size={14} /> {t('projectSelector.openFolder')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
