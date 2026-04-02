import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HeatmapTab } from './tabs/heatmap/HeatmapTab';
import { PaperReviewTab } from './tabs/review/PaperReviewTab';
import { CoverageTab } from './tabs/coverage/CoverageTab';
import { ConceptsTab } from './tabs/concepts/ConceptsTab';
import { useActiveTab, type AnalysisTabType } from './hooks/useActiveTab';
import { useAnalysisNavigation } from './hooks/useAnalysisNavigation';

const TAB_KEYS: readonly AnalysisTabType[] = ['heatmap', 'review', 'coverage', 'concepts'] as const;

const TAB_I18N_KEYS: Record<AnalysisTabType, string> = {
  heatmap: 'analysis.tabs.heatmap',
  review: 'analysis.tabs.review',
  coverage: 'analysis.tabs.coverage',
  concepts: 'analysis.tabs.concepts',
};

export function AnalysisView() {
  const { t } = useTranslation();
  const { activeTab, switchTab } = useActiveTab();
  useAnalysisNavigation({ switchTab });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const setTabRef = useCallback((tab: AnalysisTabType) => (el: HTMLButtonElement | null) => {
    tabRefs.current[tab] = el;
  }, []);

  return (
    <div className="workspace-view workspace-view--analysis" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {/* Tab bar */}
      <div
        className="analysis-tab-bar"
        role="tablist"
        aria-label={t('analysis.tabBar', { defaultValue: 'Analysis views' })}
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
            className="analysis-tab"
            role="tab"
            ref={setTabRef(tab)}
            id={`analysis-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`analysis-tabpanel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => switchTab(tab)}
            onKeyDown={(e) => {
              const idx = TAB_KEYS.indexOf(tab);
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                const next = TAB_KEYS[(idx + 1) % TAB_KEYS.length]!;
                switchTab(next);
                tabRefs.current[next]?.focus();
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prev = TAB_KEYS[(idx - 1 + TAB_KEYS.length) % TAB_KEYS.length]!;
                switchTab(prev);
                tabRefs.current[prev]?.focus();
              }
            }}
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
            {t(TAB_I18N_KEYS[tab])}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="analysis-content-stage" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Heatmap uses keep-alive: always mounted, hidden via display + aria-hidden */}
        <div
          className="analysis-tab-panel"
          role="tabpanel"
          id="analysis-tabpanel-heatmap"
          aria-labelledby="analysis-tab-heatmap"
          aria-hidden={activeTab !== 'heatmap'}
          style={{
            display: activeTab === 'heatmap' ? 'block' : 'none',
            height: '100%',
          }}
        >
          <HeatmapTab />
        </div>

        {activeTab === 'review' && (
          <div
            className="analysis-tab-panel"
            role="tabpanel"
            id="analysis-tabpanel-review"
            aria-labelledby="analysis-tab-review"
            style={{ height: '100%' }}
          >
            <PaperReviewTab />
          </div>
        )}
        {activeTab === 'coverage' && (
          <div
            className="analysis-tab-panel"
            role="tabpanel"
            id="analysis-tabpanel-coverage"
            aria-labelledby="analysis-tab-coverage"
            style={{ height: '100%' }}
          >
            <CoverageTab />
          </div>
        )}
        {activeTab === 'concepts' && (
          <div
            className="analysis-tab-panel"
            role="tabpanel"
            id="analysis-tabpanel-concepts"
            aria-labelledby="analysis-tab-concepts"
            style={{ height: '100%' }}
          >
            <ConceptsTab />
          </div>
        )}
      </div>
    </div>
  );
}
