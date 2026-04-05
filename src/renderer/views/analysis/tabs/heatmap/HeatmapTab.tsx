/**
 * HeatmapTab — Top-level heatmap view.
 *
 * Layout: HeatmapToolbar (32px) + HeatmapGrid (flex fill) + HeatmapLegend (36px).
 * Reads data internally via useProcessedHeatmapData.
 * Manages all shared state and passes it down to children.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../../../core/store';
import { cellKey } from '../../shared/cellKey';
import { useAdjudicateMapping } from '../../../../core/ipc/hooks/useMappings';
import { HeatmapToolbar } from './HeatmapToolbar';
import { HeatmapGrid } from './layout/HeatmapGrid';
import { HeatmapLegend } from './HeatmapLegend';
import { CellTooltip } from './interaction/CellTooltip';
import { CellContextMenu } from './interaction/CellContextMenu';
import {
  useProcessedHeatmapData,
  type SortBy,
} from './data/useHeatmapData';
import { computeRowOffsets, computeTotalHeight } from './data/rowOffsets';
import { exportHeatmapCSV } from './export/exportCSV';
import { exportHeatmapPNG } from './export/exportPNG';

function sameCell(
  left: { row: number; col: number } | null,
  right: { row: number; col: number } | null,
) {
  return left?.row === right?.row && left?.col === right?.col;
}

export function HeatmapTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const selectedMappingId = useAppStore((s) => s.selectedMappingId);
  const selectMapping = useAppStore((s) => s.selectMapping);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const adjudicateMapping = useAdjudicateMapping();

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
  const [hoveredPosition, setHoveredPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    cell: { row: number; col: number };
    position: { x: number; y: number };
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // ── Data ──
  const {
    sortedPaperIds,
    paperLabels,
    conceptGroups,
    concepts,
    orderedConceptIds,
    cellLookup,
    isLoading,
  } = useProcessedHeatmapData(sortBy, collapsedGroups);

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
      if (idx > 0 && group.conceptIds.length > 1) {
        boundaries.add(idx);
      }
      idx += collapsedGroups.has(group.id) ? 1 : group.conceptIds.length;
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

  const getCellAt = useCallback((cell: { row: number; col: number } | null) => {
    if (!cell) return null;
    return cellLookup.get(cellKey(cell.row, cell.col)) ?? null;
  }, [cellLookup]);

  const hoveredHeatmapCell = useMemo(
    () => getCellAt(hoveredCell),
    [getCellAt, hoveredCell],
  );

  const contextMenuCell = useMemo(
    () => getCellAt(contextMenuState?.cell ?? null),
    [contextMenuState, getCellAt],
  );

  const selectedCellFromStore = useMemo(() => {
    if (!selectedMappingId) return null;
    for (const cell of cellLookup.values()) {
      if (cell.mappingId === selectedMappingId) {
        return { row: cell.conceptIndex, col: cell.paperIndex };
      }
    }
    return null;
  }, [selectedMappingId, cellLookup]);

  const getAdjudicationLabel = useCallback((status: string) => {
    switch (status) {
      case 'accepted':
        return t('context.adjudication.accepted');
      case 'rejected':
        return t('context.adjudication.rejected');
      case 'revised':
        return t('context.adjudication.revised');
      default:
        return t('context.adjudication.pending');
    }
  }, [t]);

  const syncSelectedMapping = useCallback((cell: { row: number; col: number } | null) => {
    setSelectedCell(cell);

    const heatmapCell = getCellAt(cell);
    if (!heatmapCell) {
      selectMapping(null);
      return;
    }

    selectMapping(
      heatmapCell.mappingId,
      sortedPaperIds[heatmapCell.paperIndex] ?? null ?? undefined,
      concepts[heatmapCell.conceptIndex]?.id,
    );
  }, [concepts, getCellAt, selectMapping, sortedPaperIds]);

  useEffect(() => {
    if (!sameCell(selectedCell, selectedCellFromStore)) {
      setSelectedCell(selectedCellFromStore);
    }
  }, [selectedCell, selectedCellFromStore]);

  useEffect(() => {
    if (contextMenuState && !contextMenuCell) {
      setContextMenuState(null);
    }
  }, [contextMenuCell, contextMenuState]);

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

  const handleSelectCell = useCallback((cell: { row: number; col: number } | null) => {
    syncSelectedMapping(cell);
  }, [syncSelectedMapping]);

  const handleOpenCellMenu = useCallback((
    cell: { row: number; col: number } | null,
    position: { x: number; y: number } | null,
  ) => {
    if (!cell || !position) {
      setContextMenuState(null);
      return;
    }

    syncSelectedMapping(cell);
    setContextMenuState({ cell, position });
  }, [syncSelectedMapping]);

  const handleViewEvidence = useCallback(() => {
    if (!contextMenuState) return;
    syncSelectedMapping(contextMenuState.cell);
  }, [contextMenuState, syncSelectedMapping]);

  const handleOpenInReader = useCallback(() => {
    if (!contextMenuCell) return;
    const paperId = sortedPaperIds[contextMenuCell.paperIndex];
    if (!paperId) return;

    navigateTo({
      type: 'paper',
      id: paperId,
      view: 'reader',
    });
  }, [contextMenuCell, navigateTo, sortedPaperIds]);

  const handleAdjudication = useCallback((decision: 'accept' | 'reject') => {
    if (!contextMenuCell) return;
    const paperId = sortedPaperIds[contextMenuCell.paperIndex];
    if (!paperId) return;

    adjudicateMapping.mutate({
      mappingId: contextMenuCell.mappingId,
      decision,
      paperId,
    });
  }, [adjudicateMapping, contextMenuCell, sortedPaperIds]);

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
          onHoverPositionChange={setHoveredPosition}
          onSelectCell={handleSelectCell}
          onOpenCellMenu={handleOpenCellMenu}
          showGrid={showGrid}
          rowOffsets={rowOffsets}
          totalContentHeight={totalContentHeight}
          cellLookup={cellLookup}
        />
        <CellTooltip
          cell={contextMenuState ? null : hoveredHeatmapCell}
          conceptName={hoveredCell ? (concepts[hoveredCell.row]?.name ?? '') : ''}
          paperLabel={hoveredCell ? (paperLabels[hoveredCell.col] ?? '') : ''}
          position={contextMenuState ? null : hoveredPosition}
          adjudicationLabel={hoveredHeatmapCell ? getAdjudicationLabel(hoveredHeatmapCell.adjudicationStatus) : ''}
        />
        <CellContextMenu
          cell={contextMenuCell}
          position={contextMenuState?.position ?? null}
          open={Boolean(contextMenuState && contextMenuCell)}
          acceptDisabled={contextMenuCell?.adjudicationStatus === 'accepted'}
          rejectDisabled={contextMenuCell?.adjudicationStatus === 'rejected'}
          onOpenChange={(open) => {
            if (!open) {
              setContextMenuState(null);
            }
          }}
          onViewEvidence={handleViewEvidence}
          onOpenInReader={handleOpenInReader}
          onAccept={() => handleAdjudication('accept')}
          onReject={() => handleAdjudication('reject')}
        />
      </div>

      {/* Legend — 36px */}
      <HeatmapLegend />
    </div>
  );
}
