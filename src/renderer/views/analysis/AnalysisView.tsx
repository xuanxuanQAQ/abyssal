import React from 'react';
import { HeatmapTab } from './tabs/heatmap/HeatmapTab';
import { PaperReviewTab } from './tabs/review/PaperReviewTab';
import { CoverageTab } from './tabs/coverage/CoverageTab';
import { useActiveTab, type AnalysisTabType } from './hooks/useActiveTab';
import { useAnalysisNavigation } from './hooks/useAnalysisNavigation';

const TAB_LABELS: Record<AnalysisTabType, string> = {
  heatmap: 'Heatmap',
  review: 'Paper Review',
  coverage: 'Coverage',
};

const TAB_KEYS: readonly AnalysisTabType[] = ['heatmap', 'review', 'coverage'] as const;

export function AnalysisView() {
  const { activeTab, switchTab } = useActiveTab();
  useAnalysisNavigation({ switchTab });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: 36,
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        {TAB_KEYS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => switchTab(tab)}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: 'none',
              borderBottom:
                activeTab === tab
                  ? '2px solid var(--accent-color)'
                  : '2px solid transparent',
              color: activeTab === tab ? 'var(--accent-color)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: 13,
              lineHeight: '20px',
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Heatmap uses keep-alive: always mounted, hidden via display */}
        <div
          style={{
            display: activeTab === 'heatmap' ? 'block' : 'none',
            height: '100%',
          }}
        >
          <HeatmapTab />
        </div>

        {/* Paper Review and Coverage unmount/remount on switch */}
        {activeTab === 'review' && <PaperReviewTab />}
        {activeTab === 'coverage' && <CoverageTab />}
      </div>
    </div>
  );
}
