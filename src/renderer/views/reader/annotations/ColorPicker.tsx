import React from 'react';
import type { HighlightColor } from '../../../../shared-types/enums';
import {
  HIGHLIGHT_COLOR_MAP as COLOR_MAP,
  HIGHLIGHT_BORDER_MAP as BORDER_MAP,
  ALL_HIGHLIGHT_COLORS as COLORS,
} from '../shared/highlightColors';

export function ColorPicker({
  value,
  onChange,
}: {
  value: HighlightColor;
  onChange: (color: HighlightColor) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            backgroundColor: COLOR_MAP[color],
            border: value === color ? `2px solid ${BORDER_MAP[color]}` : '2px solid transparent',
            padding: 0,
            cursor: 'pointer',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          aria-label={color}
        />
      ))}
    </div>
  );
}
