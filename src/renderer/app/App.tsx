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

import React, { useCallback } from 'react';
import { Toaster } from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { AbyssalQueryProvider } from './QueryProvider';
import { AppErrorBoundary } from './ErrorBoundaries';
import { PipelineListener } from './PipelineListener';
import { ThemeProvider } from '../core/context/ThemeContext';
import { LayoutProvider } from '../core/context/LayoutContext';
import { KeybindingProvider } from '../core/context/KeybindingContext';
import { MainLayout } from './shell/MainLayout';
import { ProjectSetupWizard } from './wizard/ProjectSetupWizard';
import { useProjectSetup } from './wizard/useProjectSetup';

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
  );
}

/** 内层组件：在 Provider 树内使用 hooks */
function AppShell() {
  const { showWizard, setShowWizard } = useProjectSetup();
  const queryClient = useQueryClient();

  const handleWizardComplete = useCallback(() => {
    // 项目创建完成后刷新项目信息
    void queryClient.invalidateQueries({ queryKey: ['projectInfo'] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }, [queryClient]);

  return (
    <>
      <PipelineListener />
      <Toaster
        position="bottom-right"
        containerStyle={TOAST_CONTAINER_STYLE}
        toastOptions={{ style: TOAST_STYLE }}
      />
      <MainLayout />
      <ProjectSetupWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        onComplete={handleWizardComplete}
      />
    </>
  );
}
