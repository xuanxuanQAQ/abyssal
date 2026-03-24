/**
 * IPC Hook 共享工具
 *
 * 统一 mutation 错误处理，减少各 hook 文件中的 onError 样板代码。
 */

import { handleError } from '../../errors/errorHandlers';

/**
 * 标准 mutation onError 回调 — 直接传给 useMutation 的 onError
 *
 * 用法：
 * ```ts
 * useMutation({
 *   mutationFn: ...,
 *   onError: mutationErrorHandler,
 * })
 * ```
 */
export const mutationErrorHandler = (err: unknown): void => {
  handleError(err);
};
