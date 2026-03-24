/**
 * React Error Boundary 分层策略
 *
 * 按视图隔离原则部署：
 * - AppErrorBoundary: 最外层兜底
 * - ViewErrorBoundary: 视图级，key 绑定 activeView 自动重置
 * - ContextPanelErrorBoundary: ContextPanel 独立隔离
 */

import React, { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  name: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 通用 Error Boundary 基类
 */
class BaseErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[ErrorBoundary:${this.props.name}]`,
      error,
      errorInfo.componentStack
    );
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '2rem',
            gap: '1rem',
          }}
        >
          <h2 style={{ color: 'var(--text-primary)' }}>出了点问题</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 480, textAlign: 'center' }}>
            {this.state.error?.message ?? '发生了未知错误。'}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 最外层 Error Boundary — 兜底致命错误
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <BaseErrorBoundary
      name="App"
      fallback={
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '1rem',
            backgroundColor: 'var(--bg-base)',
            color: 'var(--text-primary)',
          }}
        >
          <h1>Abyssal 遇到了致命错误</h1>
          <p style={{ color: 'var(--text-muted)' }}>请重新加载应用。</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
            }}
          >
            重新加载
          </button>
        </div>
      }
    >
      {children}
    </BaseErrorBoundary>
  );
}

/**
 * 视图级 Error Boundary
 *
 * key 属性绑定到 activeView，切换视图时自动重置错误状态。
 */
export function ViewErrorBoundary({
  children,
  viewKey,
}: {
  children: ReactNode;
  viewKey: string;
}) {
  return (
    <BaseErrorBoundary key={viewKey} name={`View:${viewKey}`}>
      {children}
    </BaseErrorBoundary>
  );
}

/**
 * ContextPanel 独立 Error Boundary
 */
export function ContextPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <BaseErrorBoundary name="ContextPanel">{children}</BaseErrorBoundary>
  );
}
