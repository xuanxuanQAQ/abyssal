import type { StateCreator } from 'zustand';
import type { NavigationSlice } from './navigationSlice';
import type { SelectionSlice } from './selectionSlice';
import type { PanelSlice } from './panelSlice';
import type { SearchSlice } from './searchSlice';
import type { PipelineSlice } from './pipelineSlice';
import type { LibrarySlice } from './librarySlice';
import type { LayerVisibility } from '../../../../shared-types/models';

export interface GraphSlice {
  layerVisibility: LayerVisibility;
  showConceptNodes: boolean;
  similarityThreshold: number;
  focusDepth: '1-hop' | '2-hop' | 'global';
  layoutPaused: boolean;
  graphContextStatus: 'ready' | 'lost' | 'restoring';
  /** 当前焦点节点的类型（Graph 视图点击时设置） */
  focusedGraphNodeType: 'paper' | 'concept' | null;

  setLayerVisibility(visibility: LayerVisibility): void;
  toggleLayer(layer: keyof LayerVisibility): void;
  setShowConceptNodes(show: boolean): void;
  setSimilarityThreshold(threshold: number): void;
  setFocusDepth(depth: '1-hop' | '2-hop' | 'global'): void;
  setLayoutPaused(paused: boolean): void;
  setGraphContextStatus(status: 'ready' | 'lost' | 'restoring'): void;
  setFocusedGraphNodeType(type: 'paper' | 'concept' | null): void;
}

type FullStore =
  & NavigationSlice
  & SelectionSlice
  & PanelSlice
  & SearchSlice
  & PipelineSlice
  & LibrarySlice
  & GraphSlice;

export const createGraphSlice: StateCreator<
  FullStore,
  [['zustand/immer', never]],
  [],
  GraphSlice
> = (set) => ({
  layerVisibility: {
    citation: true,
    conceptAgree: true,
    conceptConflict: true,
    semanticNeighbor: false,
  },
  showConceptNodes: false,
  similarityThreshold: 0.5,
  focusDepth: '2-hop',
  layoutPaused: false,
  graphContextStatus: 'ready',
  focusedGraphNodeType: null,

  setLayerVisibility(visibility: LayerVisibility) {
    set((state) => {
      state.layerVisibility = visibility;
    });
  },

  toggleLayer(layer: keyof LayerVisibility) {
    set((state) => {
      state.layerVisibility[layer] = !state.layerVisibility[layer];
    });
  },

  setShowConceptNodes(show: boolean) {
    set((state) => {
      state.showConceptNodes = show;
    });
  },

  setSimilarityThreshold(threshold: number) {
    set((state) => {
      state.similarityThreshold = threshold;
    });
  },

  setFocusDepth(depth: '1-hop' | '2-hop' | 'global') {
    set((state) => {
      state.focusDepth = depth;
    });
  },

  setLayoutPaused(paused: boolean) {
    set((state) => {
      state.layoutPaused = paused;
    });
  },

  setGraphContextStatus(status: 'ready' | 'lost' | 'restoring') {
    set((state) => {
      state.graphContextStatus = status;
    });
  },

  setFocusedGraphNodeType(type: 'paper' | 'concept' | null) {
    set((state) => {
      state.focusedGraphNodeType = type;
    });
  },
});
