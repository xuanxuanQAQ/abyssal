/**
 * KeybindingContext — 三层快捷键映射系统
 *
 * Layer 1: Global（任何视图下可用）
 * Layer 2: View Scoped（当前视图专属）
 * Layer 3: Component Local（编辑器内部）
 *
 * Windows 专用：所有修饰键使用 Ctrl（无 Cmd 映射）。
 * 持久化到 localStorage。
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

// ═══ Layer 1: 全局快捷键 ActionId ═══

export type GlobalActionId =
  | 'global.search'
  | 'global.viewLibrary'
  | 'global.viewReader'
  | 'global.viewAnalysis'
  | 'global.viewGraph'
  | 'global.viewWriting'
  | 'global.toggleContextPanel'
  | 'global.analyzeCurrentPaper'
  | 'global.sendChat'
  | 'global.openSettings'
  | 'global.dismiss'
  | 'global.undo'
  | 'global.redo';

// ═══ Layer 2: 视图级快捷键 ActionId ═══

export type LibraryActionId =
  | 'library.importBibtex'
  | 'library.deleteSelected'
  | 'library.navigateRows'
  | 'library.quickLook'
  | 'library.openInReader'
  | 'library.selectAll';

export type ReaderActionId =
  | 'reader.toolHighlight'
  | 'reader.toolNote'
  | 'reader.toolConceptTag'
  | 'reader.toolNone'
  | 'reader.prevPage'
  | 'reader.nextPage'
  | 'reader.zoomIn'
  | 'reader.zoomOut'
  | 'reader.zoomFitWidth';

export type WritingActionId =
  | 'writing.save'
  | 'writing.aiGenerate'
  | 'writing.aiRewrite';

export type ViewActionId = LibraryActionId | ReaderActionId | WritingActionId;

// ═══ 统一 ActionId ═══

export type ActionId = GlobalActionId | ViewActionId;

// ═══ 层级标注 ═══

export type KeyLayer = 1 | 2 | 3;

export interface KeyBinding {
  key: string;
  layer: KeyLayer;
}

type Bindings = Record<ActionId, KeyBinding>;

// ═══ 默认快捷键 ═══

const DEFAULT_BINDINGS: Bindings = {
  // Layer 1: 全局（§7.3）
  'global.search':               { key: 'Ctrl+K',       layer: 1 },
  'global.viewLibrary':          { key: 'Ctrl+1',       layer: 1 },
  'global.viewReader':           { key: 'Ctrl+2',       layer: 1 },
  'global.viewAnalysis':         { key: 'Ctrl+3',       layer: 1 },
  'global.viewGraph':            { key: 'Ctrl+4',       layer: 1 },
  'global.viewWriting':          { key: 'Ctrl+5',       layer: 1 },
  'global.toggleContextPanel':   { key: 'Ctrl+B',       layer: 1 },
  'global.analyzeCurrentPaper':  { key: 'Ctrl+Shift+A', layer: 1 },
  'global.sendChat':             { key: 'Ctrl+Enter',   layer: 1 },
  'global.openSettings':         { key: 'Ctrl+,',       layer: 1 },
  'global.dismiss':              { key: 'Escape',       layer: 1 },
  'global.undo':                 { key: 'Ctrl+Z',       layer: 1 },
  'global.redo':                 { key: 'Ctrl+Shift+Z', layer: 1 },

  // Layer 2: Library 视图（§7.4）
  'library.importBibtex':        { key: 'Ctrl+I',       layer: 2 },
  'library.deleteSelected':      { key: 'Delete',       layer: 2 },
  'library.navigateRows':        { key: 'ArrowDown',    layer: 2 }, // ↑/↓ 在 handler 中区分
  'library.quickLook':           { key: 'Space',        layer: 2 },
  'library.openInReader':        { key: 'Enter',        layer: 2 },
  'library.selectAll':           { key: 'Ctrl+A',       layer: 2 },

  // Layer 2: Reader 视图（§7.4）
  'reader.toolHighlight':        { key: 'H',            layer: 2 },
  'reader.toolNote':             { key: 'N',            layer: 2 },
  'reader.toolConceptTag':       { key: 'T',            layer: 2 },
  'reader.toolNone':             { key: 'Escape',       layer: 2 },
  'reader.prevPage':             { key: 'ArrowLeft',    layer: 2 },
  'reader.nextPage':             { key: 'ArrowRight',   layer: 2 },
  'reader.zoomIn':               { key: 'Ctrl+Plus',    layer: 2 },
  'reader.zoomOut':              { key: 'Ctrl+Minus',   layer: 2 },
  'reader.zoomFitWidth':         { key: 'Ctrl+0',       layer: 2 },

  // Layer 2: Writing 视图（§7.4）
  'writing.save':                { key: 'Ctrl+S',       layer: 2 },
  'writing.aiGenerate':          { key: 'Ctrl+Shift+G', layer: 2 },
  'writing.aiRewrite':           { key: 'Ctrl+Shift+R', layer: 2 },
};

// ═══ 冲突检测（§7.5）═══

export interface KeyConflict {
  keyCombo: string;
  actions: ActionId[];
  layer: KeyLayer;
}

function detectConflicts(bindings: Bindings): KeyConflict[] {
  const layerMap = new Map<KeyLayer, Map<string, ActionId[]>>();

  for (const [actionId, binding] of Object.entries(bindings) as [ActionId, KeyBinding][]) {
    if (!layerMap.has(binding.layer)) {
      layerMap.set(binding.layer, new Map());
    }
    const comboMap = layerMap.get(binding.layer)!;
    const normalizedKey = binding.key.toLowerCase();
    const existing = comboMap.get(normalizedKey) ?? [];
    existing.push(actionId);
    comboMap.set(normalizedKey, existing);
  }

  const conflicts: KeyConflict[] = [];
  for (const [layer, comboMap] of layerMap) {
    for (const [keyCombo, actions] of comboMap) {
      if (actions.length > 1) {
        conflicts.push({ keyCombo, actions, layer });
      }
    }
  }
  return conflicts;
}

// ═══ 持久化 ═══

const STORAGE_KEY = 'abyssal-keybindings';

type StoredBindings = Record<string, string>;

function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredBindings;
      const merged = { ...DEFAULT_BINDINGS };
      for (const [actionId, key] of Object.entries(stored)) {
        if (actionId in merged) {
          (merged as Record<string, KeyBinding>)[actionId] = {
            key,
            layer: DEFAULT_BINDINGS[actionId as ActionId].layer,
          };
        }
      }
      return merged;
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_BINDINGS };
}

function saveBindings(bindings: Bindings): void {
  // 只保存与默认值不同的绑定
  const diff: StoredBindings = {};
  for (const [actionId, binding] of Object.entries(bindings) as [ActionId, KeyBinding][]) {
    if (binding.key !== DEFAULT_BINDINGS[actionId].key) {
      diff[actionId] = binding.key;
    }
  }
  if (Object.keys(diff).length > 0) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ═══ Context ═══

interface KeybindingContextValue {
  bindings: Bindings;
  conflicts: KeyConflict[];
  updateBinding: (action: ActionId, key: string) => void;
  resetBindings: () => void;
  getKeyForAction: (action: ActionId) => string;
}

const KeybindingContext = createContext<KeybindingContextValue | null>(null);

export function KeybindingProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState<Bindings>(loadBindings);

  const conflicts = useMemo(() => detectConflicts(bindings), [bindings]);

  useEffect(() => {
    saveBindings(bindings);
  }, [bindings]);

  const updateBinding = useCallback((action: ActionId, key: string) => {
    setBindings((b) => ({
      ...b,
      [action]: { key, layer: b[action].layer },
    }));
  }, []);

  const resetBindings = useCallback(() => {
    setBindings({ ...DEFAULT_BINDINGS });
  }, []);

  const getKeyForAction = useCallback(
    (action: ActionId) => bindings[action].key,
    [bindings]
  );

  return (
    <KeybindingContext.Provider
      value={{ bindings, conflicts, updateBinding, resetBindings, getKeyForAction }}
    >
      {children}
    </KeybindingContext.Provider>
  );
}

export function useKeybindings(): KeybindingContextValue {
  const ctx = useContext(KeybindingContext);
  if (!ctx)
    throw new Error('useKeybindings must be used within KeybindingProvider');
  return ctx;
}
