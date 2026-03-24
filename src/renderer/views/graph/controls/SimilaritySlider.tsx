import React, { useCallback, useRef } from 'react';
import { useAppStore } from '../../../core/store';

export interface SimilaritySliderProps {
  visibleCount: number;
}

export function SimilaritySlider({ visibleCount }: SimilaritySliderProps) {
  const similarityThreshold = useAppStore((s) => s.similarityThreshold);
  const setSimilarityThreshold = useAppStore((s) => s.setSimilarityThreshold);

  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValue = useRef(similarityThreshold);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      latestValue.current = value;

      if (throttleTimer.current === null) {
        setSimilarityThreshold(value);
        throttleTimer.current = setTimeout(() => {
          throttleTimer.current = null;
          // Apply the latest value if it changed during the throttle window
          if (latestValue.current !== value) {
            setSimilarityThreshold(latestValue.current);
          }
        }, 50);
      }
    },
    [setSimilarityThreshold],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          Similarity Threshold
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', fontWeight: 500 }}>
          {similarityThreshold.toFixed(2)}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={similarityThreshold}
        onChange={handleChange}
        style={{ width: '100%', margin: 0 }}
      />

      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
        显示 {visibleCount} 条语义邻居边
      </span>
    </div>
  );
}
