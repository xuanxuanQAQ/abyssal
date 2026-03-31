import React, { useMemo } from 'react';
import type { HeatmapCell } from '../../../../shared-types/models';
import { cellKey } from '../shared/cellKey';

interface HiddenTableProps {
  conceptNames: string[];
  paperLabels: string[];
  cells: HeatmapCell[];
  numPapers: number;
  numConcepts: number;
}

const hiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
};

export function HiddenTable({ conceptNames, paperLabels, cells, numPapers, numConcepts }: HiddenTableProps) {
  // Build a lookup for cells: "conceptIndex:paperIndex" -> HeatmapCell
  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    for (const cell of cells) {
      map.set(cellKey(cell.conceptIndex, cell.paperIndex), cell);
    }
    return map;
  }, [cells]);

  return (
    <div style={hiddenStyle} role="region" aria-label="热力图矩阵数据" aria-hidden="false">
      <table>
        <caption>概念-论文映射热力图</caption>
        <thead>
          <tr>
            <th scope="col">概念</th>
            {paperLabels.map((label, i) => (
              <th key={i} scope="col">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {conceptNames.map((name, r) => (
            <tr key={r}>
              <th scope="row">{name}</th>
              {Array.from({ length: numPapers }, (_, c) => {
                const cell = cellMap.get(cellKey(r, c));
                return (
                  <td key={c}>
                    {cell ? `${cell.relationType}: ${cell.confidence.toFixed(2)}` : '无映射'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { HiddenTableProps };
