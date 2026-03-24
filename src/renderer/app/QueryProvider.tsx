/**
 * TanStack QueryClient 全局配置与 Provider
 *
 * 配置项遵循文档 §6.1：
 * - 默认 staleTime 30s, gcTime 5min
 * - retry 仅对 retryable 错误重试（最多 3 次）
 * - retryDelay 指数退避，上限 30s
 * - refetchOnWindowFocus 默认关闭
 * - mutations 默认不重试
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { shouldRetry, getRetryDelay } from '../core/errors/errorHandlers';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: shouldRetry,
      retryDelay: getRetryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function AbyssalQueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * 注意：queryClient 不再直接导出。
 * 所有消费方应通过 useQueryClient() hook 获取实例，
 * 确保与 Provider 一致。
 */
