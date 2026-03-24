import React, { useEffect, useState } from 'react';

export function AnnotationFlash({
  targetRects,
  color,
  onComplete,
}: {
  targetRects: Array<{ left: number; top: number; width: number; height: number }>;
  color: string;
  onComplete: () => void;
}) {
  const [opacity, setOpacity] = useState(0.3);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    let count = 0;
    let goingUp = true;

    const interval = setInterval(() => {
      if (goingUp) {
        setOpacity(0.8);
        goingUp = false;
      } else {
        setOpacity(0.3);
        goingUp = true;
        count++;
        setCycle(count);
      }

      if (count >= 3) {
        clearInterval(interval);
        onComplete();
      }
    }, 300);

    return () => clearInterval(interval);
  }, [onComplete]);

  if (cycle >= 3) {
    return null;
  }

  return (
    <>
      {targetRects.map((rect, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            backgroundColor: color,
            opacity,
            pointerEvents: 'none',
            transition: 'opacity 150ms ease-in-out',
          }}
        />
      ))}
    </>
  );
}
