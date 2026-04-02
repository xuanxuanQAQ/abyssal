/**
 * HeatmapTab — Top-level heatmap view.
 *
 * Layout: HeatmapToolbar (32px) + HeatmapGrid (flex fill) + HeatmapLegend (36px).
 * Reads data internally via useProcessedHeatmapData.
 * Manages all shared state and passes it down to children.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { HeatmapToolbar } from './HeatmapToolbar';
import { HeatmapGrid } from './layout/HeatmapGrid';
import { HeatmapLegend } from './HeatmapLegend';
import {
  useProcessedHeatmapData,
  type SortBy,
} from './data/useHeatmapData';
import { computeRowOffsets, computeTotalHeight } from './data/rowOffsets';
import { exportHeatmapCSV } from './export/exportCSV';
import { exportHeatmapPNG } from './export/exportPNG';

export function HeatmapTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── State ──
  const [sortBy, setSortBy] = useState<SortBy>('relevance');
  const [showGrid, setShowGrid] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // ── Data ──
  const {
    sortedPaperIds,
    paperLabels,
    conceptGroups,
    orderedConceptIds,
    cellLookup,
    isLoading,
  } = useProcessedHeatmapData(sortBy, collapsedGroups);

  // Build concept info array from ordered IDs + groups
  const concepts = useMemo(() => {
    const conceptMap = new Map<
      string,
      { id: string; name: string; parentId: string | null; level: number }
    >();
    for (const group of conceptGroups) {
      for (const cid of group.conceptIds) {
        // First concept in each group is the root (level 0), others are level 1
        const isRoot = cid === group.conceptIds[0];
        conceptMap.set(cid, {
          id: cid,
          name: cid, // Will be overridden if framework data populates names
          parentId: isRoot ? null : (group.conceptIds[0] ?? null),
          level: isRoot ? 0 : 1,
        });
      }
    }

    return orderedConceptIds
      .map((id) => conceptMap.get(id))
      .filter(
        (c): c is { id: string; name: string; parentId: string | null; level: number } =>
          c != null,
      );
  }, [conceptGroups, orderedConceptIds]);

  // O(1) adjudication status lookup from cell data
  const adjudicationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cell of cellLookup.values()) {
      map.set(cell.mappingId, cell.adjudicationStatus);
    }
    return map;
  }, [cellLookup]);

  // Compute group boundaries for row offsets
  const groupBoundaries = useMemo(() => {
    const boundaries = new Set<number>();
    let idx = 0;
    for (const group of conceptGroups) {
      if (collapsedGroups.has(group.id)) continue;
      if (idx > 0) {
        boundaries.add(idx);
      }
      idx += group.conceptIds.length;
    }
    return boundaries;
  }, [conceptGroups, collapsedGroups]);

  // Row offsets and total height
  const rowOffsets = useMemo(
    () => computeRowOffsets(concepts.length, groupBoundaries),
    [concepts.length, groupBoundaries],
  );

  const totalContentHeight = useMemo(
    () => computeTotalHeight(rowOffsets, concepts.length),
    [rowOffsets, concepts.length],
  );

  // ── Callbacks ──
  const handleToggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['mappings', 'heatmap'],
    });
  }, [queryClient]);

  const handleExportPNG = useCallback(() => {
    if (!cellLookup.size) return;
    const cells = Array.from(cellLookup.values());
    const conceptNames = concepts.map((c) => c.name);
    void exportHeatmapPNG(
      cells,
      sortedPaperIds.length,
      concepts.length,
      rowOffsets,
      (mappingId) => (adjudicationMap.get(mappingId) ?? 'pending') as any,
      paperLabels,
      conceptNames,
    );
  }, [cellLookup, sortedPaperIds, concepts, rowOffsets, adjudicationMap, paperLabels]);

  const handleExportCSV = useCallback(() => {
    if (!cellLookup.size) return;
    const cells = Array.from(cellLookup.values());
    const conceptNames = concepts.map((c) => c.name);
    exportHeatmapCSV(
      cells,
      sortedPaperIds,
      orderedConceptIds,
      paperLabels,
      conceptNames,
    );
  }, [cellLookup, sortedPaperIds, orderedConceptIds, paperLabels, concepts]);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        {t('analysis.heatmap.loading')}
      </div>
    );
  }

  return (
    <div
      className="analysis-scroll-stage analysis-heatmap-stage"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar — 32px */}
      <HeatmapToolbar
        sortBy={sortBy}
        onSortChange={setSortBy}
        showGrid={showGrid}
        onShowGridChange={setShowGrid}
        onRefresh={handleRefresh}
        onExportPNG={handleExportPNG}
        onExportCSV={handleExportCSV}
      />

      {/* Grid — flex fill */}
      <div className="analysis-main-surface" style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <HeatmapGrid
          paperIds={sortedPaperIds}
          paperLabels={paperLabels}
          concepts={concepts}
          groups={conceptGroups}
          collapsedGroups={collapsedGroups}
          onToggleGroup={handleToggleGroup}
          hoveredCell={hoveredCell}
          selectedCell={selectedCell}
          onHoverCell={setHoveredCell}
          onSelectCell={setSelectedCell}
          showGrid={showGrid}
          rowOffsets={rowOffsets}
          totalContentHeight={totalContentHeight}
          cellLookup={cellLookup}
        />
      </div>

      {/* Legend — 36px */}
      <HeatmapLegend />
    </div>
  );
}
