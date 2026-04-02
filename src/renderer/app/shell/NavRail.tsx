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

import React, { startTransition, useCallback } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useTranslation } from 'react-i18next';
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
import { emitUserAction } from '../../core/hooks/useEventBridge';
import type { ViewType } from '../../../shared-types/enums';
import { Z_INDEX } from '../../styles/zIndex';

interface NavItem {
  icon: React.ReactNode;
  labelKey: string;
  viewType: ViewType;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: <BookOpen size={20} />,    labelKey: 'nav.library',  viewType: 'library',  shortcut: 'Ctrl+1' },
  { icon: <BookText size={20} />,    labelKey: 'nav.reader',   viewType: 'reader',   shortcut: 'Ctrl+2' },
  { icon: <Microscope size={20} />,  labelKey: 'nav.analysis', viewType: 'analysis', shortcut: 'Ctrl+3' },
  { icon: <Network size={20} />,     labelKey: 'nav.graph',    viewType: 'graph',    shortcut: 'Ctrl+4' },
  { icon: <PenTool size={20} />,     labelKey: 'nav.writing',  viewType: 'writing',  shortcut: 'Ctrl+5' },
  { icon: <StickyNote size={20} />,  labelKey: 'nav.notes',    viewType: 'notes',    shortcut: 'Ctrl+6' },
];

const SETTINGS_ITEM: NavItem = {
  icon: <Settings size={20} />,
  labelKey: 'nav.settings',
  viewType: 'settings',
  shortcut: 'Ctrl+,',
};

export function NavRail() {
  const { t } = useTranslation();
  const activeView = useAppStore((s) => s.activeView);

  // TODO: §4.4 Badge 数据源——从 PipelineSlice 和 TanStack Query 缓存派生
  // 当前无数据，不显示 badge

  const switchView = useAppStore((s) => s.switchView);

  const previousView = useAppStore((s) => s.previousView);

  const handleNavClick = useCallback((viewType: ViewType) => {
    const prev = activeView;
    startTransition(() => switchView(viewType));
    emitUserAction({ action: 'navigate', view: viewType as any, previousView: prev as any });
  }, [switchView, activeView]);

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
          padding: '10px 0 8px',
          gap: 2,
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
                label={t(item.labelKey)}
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
          label={t(SETTINGS_ITEM.labelKey)}
          shortcut={SETTINGS_ITEM.shortcut}
          isActive={activeView === SETTINGS_ITEM.viewType}
          onClick={() => {
            if (activeView === 'settings' && previousView) {
              handleNavClick(previousView);
            } else {
              handleNavClick(SETTINGS_ITEM.viewType);
            }
          }}
        />
      </nav>
    </Tooltip.Provider>
  );
}
