/**
 * NavRail — 垂直导航栏（§4）
 *
 * 48px 固定宽度，5 个核心视图 + Settings，
 * 弹性空白分隔上下两组。
 *
 * 优化：
 * - startTransition 避免切换白闪
 * - onMouseEnter 预加载目标视图代码
 */

import React, { useCallback, useTransition } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  BookOpen,
  BookText,
  Microscope,
  Network,
  PenTool,
  Settings,
  StickyNote,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { NavIcon } from './NavIcon';
import { preloadView } from './MainStage';
import type { ViewType } from '../../../shared-types/enums';
import { Z_INDEX } from '../../styles/zIndex';

interface NavItem {
  icon: React.ReactNode;
  label: string;
  viewType: ViewType;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: <BookOpen size={20} />,    label: 'Library',  viewType: 'library',  shortcut: 'Ctrl+1' },
  { icon: <BookText size={20} />,    label: 'Reader',   viewType: 'reader',   shortcut: 'Ctrl+2' },
  { icon: <Microscope size={20} />,  label: 'Analysis', viewType: 'analysis', shortcut: 'Ctrl+3' },
  { icon: <Network size={20} />,     label: 'Graph',    viewType: 'graph',    shortcut: 'Ctrl+4' },
  { icon: <PenTool size={20} />,     label: 'Writing',  viewType: 'writing',  shortcut: 'Ctrl+5' },
  { icon: <StickyNote size={20} />,  label: 'Notes',    viewType: 'notes',    shortcut: 'Ctrl+6' },
];

const SETTINGS_ITEM: NavItem = {
  icon: <Settings size={20} />,
  label: 'Settings',
  viewType: 'settings',
  shortcut: 'Ctrl+,',
};

export function NavRail() {
  const activeView = useAppStore((s) => s.activeView);
  const navigateTo = useAppStore((s) => s.navigateTo);

  // TODO: §4.4 Badge 数据源——从 PipelineSlice 和 TanStack Query 缓存派生
  // 当前无数据，不显示 badge

  const switchView = useAppStore((s) => s.switchView);
  const [isPending, startTransition] = useTransition();

  const handleNavClick = useCallback((viewType: ViewType) => {
    startTransition(() => {
      switchView(viewType);
    });
  }, [switchView]);

  const handleNavHover = useCallback((viewType: ViewType) => {
    // 鼠标悬停时预加载目标视图代码，用户点击时已就绪
    preloadView(viewType);
  }, []);

  return (
    <Tooltip.Provider>
      <nav
        className="navrail"
        role="tablist"
        aria-orientation="vertical"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 48,
          height: '100%',
          zIndex: Z_INDEX.NAV_RAIL,
        }}
      >
        {/* 上组：5 个核心导航项 */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {NAV_ITEMS.map((item) => (
            <div
              key={item.viewType}
              onMouseEnter={() => handleNavHover(item.viewType)}
            >
              <NavIcon
                id={`nav-${item.viewType}`}
                icon={item.icon}
                label={item.label}
                shortcut={item.shortcut}
                isActive={activeView === item.viewType}
                onClick={() => handleNavClick(item.viewType)}
              />
            </div>
          ))}
        </div>

        {/* 弹性空白 */}
        <div style={{ flex: 1 }} />

        {/* 下组：Settings */}
        <NavIcon
          id={`nav-${SETTINGS_ITEM.viewType}`}
          icon={SETTINGS_ITEM.icon}
          label={SETTINGS_ITEM.label}
          shortcut={SETTINGS_ITEM.shortcut}
          isActive={activeView === SETTINGS_ITEM.viewType}
          onClick={() => handleNavClick(SETTINGS_ITEM.viewType)}
        />
      </nav>
    </Tooltip.Provider>
  );
}
