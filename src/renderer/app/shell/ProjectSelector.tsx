/**
 * ProjectSelector — 项目选择下拉按钮（§3.4）
 *
 * 显示当前项目名称，点击弹出项目列表。
 * 项目切换时清空 TanStack Query 缓存 + 重置 Zustand Store。
 */

import React, { useState, useEffect, useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FolderOpen, Plus, ChevronDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getAPI } from '../../core/ipc/bridge';
import { resetAppStoreForProjectSwitch } from '../../core/store';
import { useReaderStore } from '../../core/store/useReaderStore';
import { useEditorStore } from '../../core/store/useEditorStore';
import { useChatStore } from '../../core/store/useChatStore';
import type { ProjectInfo } from '../../../shared-types/models';
import { Z_INDEX } from '../../styles/zIndex';

export function ProjectSelector() {
  const queryClient = useQueryClient();
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  // 加载当前项目信息
  useEffect(() => {
    getAPI()
      .app.getProjectInfo()
      .then(setCurrentProject)
      .catch((err: unknown) => {
        console.warn('[ProjectSelector] Failed to load projects:', err);
      });
  }, []);

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    try {
      const list = await getAPI().app.listProjects();
      setProjects(list);
    } catch {
      // stub 模式下静默
    }
  }, []);

  /**
   * §3.4 项目切换流程
   * 1. 调用 switchProject IPC
   * 2. queryClient.clear()
   * 3. 重置所有 Zustand Store（集中式方法）
   * 4. 导航到 Library
   */
  const handleSwitchProject = useCallback(
    async (projectPath: string) => {
      try {
        await getAPI().app.switchProject(projectPath);

        // 清空 TanStack Query 缓存
        queryClient.clear();

        // 重置所有 Zustand Store — 集中式 reset，避免遗漏新增字段
        resetAppStoreForProjectSwitch();
        useReaderStore.getState().resetReader();
        useEditorStore.getState().resetEditor();
        useChatStore.getState().clearChatHistory();

        // 刷新当前项目信息
        const info = await getAPI().app.getProjectInfo();
        setCurrentProject(info);

        toast.success('项目已切换');
      } catch (err) {
        toast.error(`项目切换失败：${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [queryClient]
  );

  const handleNewProject = useCallback(() => {
    // TODO: 弹出新建项目 Dialog（Sub-Doc 2 不涉及 Dialog 内部实现）
  }, []);

  const handleOpenFolder = useCallback(() => {
    // TODO: 调用系统文件选择器打开已有项目目录
  }, []);

  return (
    <DropdownMenu.Root onOpenChange={(open: boolean) => { if (open) loadProjects(); }}>
      <DropdownMenu.Trigger asChild>
        <button
          className="titlebar__interactive"
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: 200,
            height: 28,
            padding: '0 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          <FolderOpen size={14} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentProject?.name ?? 'No Project'}
          </span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          align="start"
          style={{
            minWidth: 200,
            maxWidth: 280,
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '4px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: Z_INDEX.DROPDOWN,
          }}
        >
          {/* 项目列表 */}
          {projects.map((project) => (
            <DropdownMenu.Item
              key={project.name}
              onSelect={() => {
                // TODO: 项目需要 path 字段，当前 ProjectInfo 无此字段
                handleSwitchProject(project.name);
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
            <Plus size={14} /> 新建项目
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
            <FolderOpen size={14} /> 打开项目文件夹…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
