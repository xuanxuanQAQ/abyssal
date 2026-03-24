import { useEffect } from 'react';
import { useAppStore } from '../../../core/store';
import type { AnalysisTabType } from './useActiveTab';

interface UseAnalysisNavigationOptions {
  switchTab: (tab: AnalysisTabType) => void;
}

export function useAnalysisNavigation({ switchTab }: UseAnalysisNavigationOptions) {
  const selectedMappingId = useAppStore((s) => s.selectedMappingId);

  // When a mapping is selected from outside (e.g., ContextPanel), switch to heatmap
  useEffect(() => {
    if (selectedMappingId) {
      switchTab('heatmap');
    }
  }, [selectedMappingId, switchTab]);
}
