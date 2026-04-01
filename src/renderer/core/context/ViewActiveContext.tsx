/**
 * ViewActiveContext — 让 keep-alive 视图的子组件感知自身是否为当前活跃视图。
 *
 * Provider 由 MainStage 注入，query hooks 通过 useViewActive() 读取，
 * 非活跃视图的 query 自动暂停，避免后台 refetch 争抢资源。
 *
 * 默认值 true：不在 MainStage 内的组件（如 App 层弹窗）始终视为活跃。
 */

import { createContext, useContext } from 'react';

export const ViewActiveContext = createContext(true);

export function useViewActive(): boolean {
  return useContext(ViewActiveContext);
}
