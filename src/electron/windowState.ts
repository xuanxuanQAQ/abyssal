/**
 * 窗口状态持久化与恢复
 *
 * 将窗口位置、尺寸、最大化状态保存到 JSON 文件，
 * 下次启动时恢复。支持多显示器校验回退。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, screen } from 'electron';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  isMaximized: boolean;
  displayId: string;
}

const DEFAULT_STATE: WindowState = {
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  isMaximized: false,
  displayId: '',
};

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/**
 * 加载持久化窗口状态
 *
 * 校验 bounds 是否仍在可用显示器范围内，
 * 若超出范围（如用户断开外接屏幕），回退到主显示器居中默认尺寸。
 */
export function loadWindowState(): WindowState {
  try {
    const filePath = getStatePath();
    if (!fs.existsSync(filePath)) return centerOnPrimary();

    const raw = fs.readFileSync(filePath, 'utf-8');
    const saved = JSON.parse(raw) as WindowState;

    // 校验 bounds 是否落在当前可用显示器中
    const displays = screen.getAllDisplays();
    const targetDisplay = displays.find((d) => {
      const { x, y, width, height } = d.workArea;
      return (
        saved.bounds.x >= x &&
        saved.bounds.y >= y &&
        saved.bounds.x + saved.bounds.width <= x + width &&
        saved.bounds.y + saved.bounds.height <= y + height
      );
    });

    if (targetDisplay) {
      return saved;
    }

    // bounds 部分可见也允许（至少标题栏区域在屏幕内）
    const partiallyVisible = displays.some((d) => {
      const { x, y, width, height } = d.workArea;
      return (
        saved.bounds.x < x + width &&
        saved.bounds.x + saved.bounds.width > x &&
        saved.bounds.y < y + height &&
        saved.bounds.y + 44 > y // 至少标题栏可见
      );
    });

    if (partiallyVisible) {
      return saved;
    }

    // 完全不可见，回退到主显示器居中
    return centerOnPrimary();
  } catch {
    return centerOnPrimary();
  }
}

/**
 * 保存窗口状态到文件
 */
export function saveWindowState(state: WindowState): void {
  try {
    const filePath = getStatePath();
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // 静默忽略写入失败
  }
}

/**
 * 在主显示器居中的默认状态
 */
function centerOnPrimary(): WindowState {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workArea;
  const w = DEFAULT_STATE.bounds.width;
  const h = DEFAULT_STATE.bounds.height;

  return {
    bounds: {
      x: Math.round((width - w) / 2) + primary.workArea.x,
      y: Math.round((height - h) / 2) + primary.workArea.y,
      width: w,
      height: h,
    },
    isMaximized: false,
    displayId: String(primary.id),
  };
}
