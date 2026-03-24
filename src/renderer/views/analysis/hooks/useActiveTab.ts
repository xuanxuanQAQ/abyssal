import { useState, useCallback } from 'react';

export type AnalysisTabType = 'heatmap' | 'review' | 'coverage';

export function useActiveTab(initialTab: AnalysisTabType = 'heatmap') {
  const [activeTab, setActiveTab] = useState<AnalysisTabType>(initialTab);

  const switchTab = useCallback((tab: AnalysisTabType) => {
    setActiveTab(tab);
  }, []);

  return { activeTab, switchTab };
}
