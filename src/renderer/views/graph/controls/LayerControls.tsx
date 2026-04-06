import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../core/store';
import { LayerCheckbox } from './LayerCheckbox';
import { SimilaritySlider } from './SimilaritySlider';
import { FocusDepthSelector } from './FocusDepthSelector';

export interface LayerControlsProps {
  semanticNeighborCount: number;
  onRelayout: () => void;
}

export function LayerControls({ semanticNeighborCount, onRelayout }: LayerControlsProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const showConceptNodes = useAppStore((s) => s.showConceptNodes);
  const setShowConceptNodes = useAppStore((s) => s.setShowConceptNodes);
  const showNoteNodes = useAppStore((s) => s.showNoteNodes);
  const setShowNoteNodes = useAppStore((s) => s.setShowNoteNodes);

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 25,
        width: 220,
        background: 'var(--bg-surface)',
        backdropFilter: 'blur(8px)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)',
        }}
      >
        <span>{t('graph.layerControls')}</span>
        <span style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
          ▾
        </span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Layer checkboxes */}
          <LayerCheckbox
            label={t('graph.layers.citation')}
            checked={layerVisibility.citation}
            onChange={() => toggleLayer('citation')}
            color="#4A90D9"
            lineStyle="solid"
          />
          <LayerCheckbox
            label={t('graph.layers.conceptAgree')}
            checked={layerVisibility.conceptAgree}
            onChange={() => toggleLayer('conceptAgree')}
            color="#7ED321"
            lineStyle="solid"
          />
          <LayerCheckbox
            label={t('graph.layers.conceptConflict')}
            checked={layerVisibility.conceptConflict}
            onChange={() => toggleLayer('conceptConflict')}
            color="#D0021B"
            lineStyle="dashed"
          />
          <LayerCheckbox
            label={t('graph.layers.conceptExtend')}
            checked={layerVisibility.conceptExtend}
            onChange={() => toggleLayer('conceptExtend')}
            color="#F59E0B"
            lineStyle="solid"
          />
          <LayerCheckbox
            label={t('graph.layers.conceptMapping')}
            checked={layerVisibility.conceptMapping}
            onChange={() => toggleLayer('conceptMapping')}
            color="#8B5CF6"
            lineStyle="solid"
          />
          <LayerCheckbox
            label={t('graph.layers.semanticNeighbor')}
            checked={layerVisibility.semanticNeighbor}
            onChange={() => toggleLayer('semanticNeighbor')}
            color="#F5A623"
            lineStyle="curved"
          />

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

          {/* Show Concept Nodes */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showConceptNodes}
              onChange={(e) => setShowConceptNodes(e.target.checked)}
              style={{ width: 16, height: 16, margin: 0 }}
            />
            {t('graph.showConceptNodes')}
          </label>

          {/* Show Note Nodes */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={showNoteNodes}
              onChange={(e) => {
                setShowNoteNodes(e.target.checked);
                if (layerVisibility.notes !== e.target.checked) {
                  toggleLayer('notes');
                }
              }}
              style={{ width: 16, height: 16, margin: 0 }}
            />
            {t('graph.showNoteNodes')}
          </label>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

          {/* Similarity Slider */}
          <SimilaritySlider visibleCount={semanticNeighborCount} />

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

          {/* Focus Depth Selector */}
          <FocusDepthSelector />

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

          {/* Relayout button */}
          <button
            onClick={onRelayout}
            style={{
              width: '100%',
              padding: '6px 0',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            {t('graph.reLayout')}
          </button>
        </div>
      )}
    </div>
  );
}
