/**
 * App — 顶层组件
 *
 * 组装 Provider 栈与 ErrorBoundary 树。
 * 布局结构：
 *
 * <AbyssalQueryProvider>
 *   <ThemeProvider>
 *     <LayoutProvider>
 *       <KeybindingProvider>
 *         <AppErrorBoundary>
 *           <PipelineListener />
 *           <Toaster />
 *           <MainLayout />    ← 包含 TitleBar, NavRail, MainStage, ContextPanel, StatusBar
 *         </AppErrorBoundary>
 *       </KeybindingProvider>
 *     </LayoutProvider>
 *   </ThemeProvider>
 * </AbyssalQueryProvider>
 */

import React, { useCallback, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { AbyssalQueryProvider } from './QueryProvider';
import { AppErrorBoundary } from './ErrorBoundaries';
import { PipelineListener } from './PipelineListener';
import { AICommandListener } from './AICommandListener';
import { ThemeProvider } from '../core/context/ThemeContext';
import { LayoutProvider } from '../core/context/LayoutContext';
import { KeybindingProvider } from '../core/context/KeybindingContext';
import { MainLayout } from './shell/MainLayout';
import { MemoQuickInput } from '../views/notes/memo/MemoQuickInput';
import { useAppStore } from '../core/store';
import { useHotkey } from '../core/hooks/useHotkey';
import { ProjectSetupWizard } from './wizard/ProjectSetupWizard';
import { useProjectSetup } from './wizard/useProjectSetup';
import { DbChangeListener } from '../core/ipc/useDbChangeListener';
import { getAPI } from '../core/ipc/bridge';
import { setAuthorDisplayThreshold } from '../core/hooks/useAuthorDisplay';

/** Toast 全局样式 — 模块级常量避免每次渲染重建 */
const TOAST_STYLE: React.CSSProperties = {
  maxWidth: 380,
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  fontSize: 'var(--text-sm)',
};

const TOAST_CONTAINER_STYLE: React.CSSProperties = {
  bottom: 32,
  right: 16,
};

export function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <AbyssalQueryProvider>
        <ThemeProvider>
          <LayoutProvider>
            <KeybindingProvider>
              <AppErrorBoundary>
                <AppShell />
              </AppErrorBoundary>
            </KeybindingProvider>
          </LayoutProvider>
        </ThemeProvider>
      </AbyssalQueryProvider>
    </I18nextProvider>
  );
}

/** 内层组件：在 Provider 树内使用 hooks */
function AppShell() {
  const { showWizard: autoShowWizard } = useProjectSetup();
  const projectWizardOpen = useAppStore((s) => s.projectWizardOpen);
  const setProjectWizardOpen = useAppStore((s) => s.setProjectWizardOpen);
  const memoQuickInputOpen = useAppStore((s) => s.memoQuickInputOpen);
  const openMemoQuickInput = useAppStore((s) => s.openMemoQuickInput);
  const closeMemoQuickInput = useAppStore((s) => s.closeMemoQuickInput);
  const queryClient = useQueryClient();

  // 自动弹出向导（首次启动无项目时）
  useEffect(() => {
    if (autoShowWizard) {
      setProjectWizardOpen(true);
    }
  }, [autoShowWizard, setProjectWizardOpen]);

  const handleWizardComplete = useCallback(() => {
    // 项目创建完成后刷新项目信息
    void queryClient.invalidateQueries({ queryKey: ['projectInfo'] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    setProjectWizardOpen(false);
  }, [queryClient, setProjectWizardOpen]);

  // 预加载已由 MainStage 模块级 queueMicrotask 处理，无需 idle callback

  // 启动时从后端同步个性化设置到 localStorage
  useEffect(() => {
    getAPI().settings.getAll().then((data) => {
      if (data?.personalization?.authorDisplayThreshold != null) {
        setAuthorDisplayThreshold(data.personalization.authorDisplayThreshold);
      }
    }).catch((err) => { console.warn('[AppShell] Failed to load settings:', err); });
  }, []);

  // Ctrl+Shift+N 快捷键打开 MemoQuickInput
  useHotkey('Ctrl+Shift+N', () => {
    const store = useAppStore.getState();
    if (memoQuickInputOpen) {
      closeMemoQuickInput();
      return;
    }
    openMemoQuickInput({ sourceView: store.activeView });
  });

  return (
    <>
      <DbChangeListener />
      <PipelineListener />
      <AICommandListener />
      <Toaster
        position="bottom-right"
        containerStyle={TOAST_CONTAINER_STYLE}
        toastOptions={{ style: TOAST_STYLE }}
      />
      <MainLayout />
      <MemoQuickInput />
      <ProjectSetupWizard
        open={projectWizardOpen}
        onOpenChange={setProjectWizardOpen}
        onComplete={handleWizardComplete}
      />
    </>
  );
}
