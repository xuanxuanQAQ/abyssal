import React, { useRef, useEffect } from 'react';

export interface ThumbnailItemProps {
  pageNumber: number;
  thumbWidth: number;
  thumbHeight: number;
  isCurrent: boolean;
  hasAnnotations: boolean;
  annotationColor: string | null;
  renderThumbnail: (canvas: HTMLCanvasElement, pageNumber: number) => Promise<void>;
  onClick: (pageNumber: number) => void;
}

const ThumbnailItem = React.memo(function ThumbnailItem(props: ThumbnailItemProps) {
  const {
    pageNumber,
    thumbWidth,
    thumbHeight,
    isCurrent,
    hasAnnotations,
    annotationColor,
    renderThumbnail,
    onClick,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderThumbnail(canvas, pageNumber);
    // Only render once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = () => {
    onClick(pageNumber);
  };

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

  return (
    <div
      style={{
        position: 'relative',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        width={thumbWidth * dpr}
        height={thumbHeight * dpr}
        style={{
          width: thumbWidth,
          height: thumbHeight,
          border: isCurrent
            ? '2px solid var(--accent-color)'
            : '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          display: 'block',
        }}
      />
      {hasAnnotations && annotationColor != null && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: annotationColor,
          }}
        />
      )}
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginTop: 2,
          userSelect: 'none',
        }}
      >
        {pageNumber}
      </span>
    </div>
  );
});

export { ThumbnailItem };
