import React from 'react';
import { useAppStore } from '../../../core/store';

// ---------------------------------------------------------------------------
// GraphCanvas -- Sigma.js rendering container (SS8.1, SS8.2, D-5)
// ---------------------------------------------------------------------------

export interface GraphCanvasProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Full-size container that hosts the Sigma.js WebGL canvas.
 *
 * When the GPU context is lost or being restored the component renders an
 * overlay with a spinner so the user knows something is happening.
 */
export function GraphCanvas({ containerRef }: GraphCanvasProps): React.JSX.Element {
  const graphContextStatus = useAppStore((s) => s.graphContextStatus);

  const showOverlay = graphContextStatus === 'lost' || graphContextStatus === 'restoring';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* Sigma mounts its own canvas into this element */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      />

      {/* GPU context-loss overlay (D-5) */}
      {showOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.5)',
            color: 'var(--text-primary)',
            gap: 12,
          }}
        >
          {/* Simple CSS spinner */}
          <div
            style={{
              width: 32,
              height: 32,
              border: '3px solid var(--text-muted)',
              borderTopColor: 'var(--accent-color)',
              borderRadius: '50%',
              animation: 'abyssal-spin 0.8s linear infinite',
            }}
          />
          <span style={{ fontSize: 'var(--text-sm)' }}>GPU 重置中…</span>

          {/* Inline keyframes -- only injected once */}
          <style>{`
            @keyframes abyssal-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

export default GraphCanvas;
