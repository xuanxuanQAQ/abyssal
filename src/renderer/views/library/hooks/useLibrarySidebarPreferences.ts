import { useCallback, useEffect, useState } from 'react';
import { loadFromStorage, saveToStorage } from '../../../core/utils/localStorage';

const LIBRARY_SIDEBAR_WIDTH_KEY = 'abyssal-library-sidebar-width';
const LIBRARY_SIDEBAR_SECTIONS_KEY = 'abyssal-library-sidebar-sections';

const DEFAULT_LIBRARY_SIDEBAR_WIDTH = 20;
const MIN_LIBRARY_SIDEBAR_WIDTH = 10;
const MAX_LIBRARY_SIDEBAR_WIDTH = 25;

export interface LibrarySidebarSectionsState {
  smartGroups: boolean;
  tags: boolean;
  searchHistory: boolean;
}

const DEFAULT_LIBRARY_SIDEBAR_SECTIONS: LibrarySidebarSectionsState = {
  smartGroups: true,
  tags: true,
  searchHistory: false,
};

function clampLibrarySidebarWidth(value: number): number {
  return Math.max(MIN_LIBRARY_SIDEBAR_WIDTH, Math.min(MAX_LIBRARY_SIDEBAR_WIDTH, value));
}

function loadLibrarySidebarWidth(): number {
  const value = loadFromStorage<number>(LIBRARY_SIDEBAR_WIDTH_KEY, DEFAULT_LIBRARY_SIDEBAR_WIDTH);
  return clampLibrarySidebarWidth(value);
}

function loadLibrarySidebarSections(): LibrarySidebarSectionsState {
  const stored = loadFromStorage<Partial<LibrarySidebarSectionsState>>(
    LIBRARY_SIDEBAR_SECTIONS_KEY,
    DEFAULT_LIBRARY_SIDEBAR_SECTIONS,
  );

  return {
    smartGroups: stored.smartGroups ?? DEFAULT_LIBRARY_SIDEBAR_SECTIONS.smartGroups,
    tags: stored.tags ?? DEFAULT_LIBRARY_SIDEBAR_SECTIONS.tags,
    searchHistory: stored.searchHistory ?? DEFAULT_LIBRARY_SIDEBAR_SECTIONS.searchHistory,
  };
}

export function useLibrarySidebarWidthPreference(): [number, (value: number) => void] {
  const [width, setWidth] = useState<number>(loadLibrarySidebarWidth);

  useEffect(() => {
    saveToStorage(LIBRARY_SIDEBAR_WIDTH_KEY, width);
  }, [width]);

  const updateWidth = useCallback((value: number) => {
    setWidth(clampLibrarySidebarWidth(value));
  }, []);

  return [width, updateWidth];
}

export function useLibrarySidebarSectionsPreference(): [
  LibrarySidebarSectionsState,
  (section: keyof LibrarySidebarSectionsState, open: boolean) => void,
] {
  const [sections, setSections] = useState<LibrarySidebarSectionsState>(loadLibrarySidebarSections);

  useEffect(() => {
    saveToStorage(LIBRARY_SIDEBAR_SECTIONS_KEY, sections);
  }, [sections]);

  const setSectionOpen = useCallback((section: keyof LibrarySidebarSectionsState, open: boolean) => {
    setSections((current) => ({ ...current, [section]: open }));
  }, []);

  return [sections, setSectionOpen];
}