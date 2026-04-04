/**
 * Tests for context source derivation logic + related store actions.
 *
 * Tests the pure deriveContextSource() function directly (no React rendering needed)
 * and the selectionSlice store actions that feed into it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../../core/store/useAppStore';
import { deriveContextSource, type DeriveContextInput } from './useContextSource';

// ─── Helpers ───

/** Default input: library view, nothing selected */
function defaultInput(overrides?: Partial<DeriveContextInput>): DeriveContextInput {
  return {
    activeView: 'library',
    selectedPaperId: null,
    selectionMode: 'explicit',
    multiIds: [],
    selectedConceptId: null,
    selectedMappingId: null,
    selectedMappingPaperId: null,
    selectedMappingConceptId: null,
    selectedSectionId: null,
    selectedArticleId: null,
    selectedDraftId: null,
    focusedGraphNodeId: null,
    focusedGraphNodeType: null,
    selectedMemoId: null,
    selectedNoteId: null,
    excludedCount: 0,
    ...overrides,
  };
}

// ════════════════════════════════════════
// §1 deriveContextSource — 纯函数测试
// ════════════════════════════════════════

describe('deriveContextSource', () => {
  it('returns empty when nothing selected', () => {
    expect(deriveContextSource(defaultInput())).toEqual({ type: 'empty' });
  });

  // ─── 优先级 2: Reader ───

  it('reader + selectedPaper → paper context with reader origin', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'reader',
      selectedPaperId: 'p1',
    }));
    expect(result).toEqual({ type: 'paper', paperId: 'p1', originView: 'reader' });
  });

  it('reader without selectedPaper → empty', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'reader',
    }));
    expect(result).toEqual({ type: 'empty' });
  });

  // ─── 优先级 3: Writing ───

  it('writing + selectedSection → section context', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'writing',
      selectedSectionId: 's1',
      selectedArticleId: 'a1',
    }));
    expect(result).toEqual({ type: 'section', articleId: 'a1', sectionId: 's1' });
  });

  it('writing + section but no articleId → section with empty articleId', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'writing',
      selectedSectionId: 's1',
      selectedArticleId: null,
    }));
    expect(result).toEqual({ type: 'section', articleId: '', sectionId: 's1' });
  });

  it('writing + selected draft → section context carries draftId', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'writing',
      selectedSectionId: 's1',
      selectedArticleId: 'a1',
      selectedDraftId: 'd1',
    }));

    expect(result).toEqual({ type: 'section', articleId: 'a1', sectionId: 's1', draftId: 'd1' });
  });

  // ─── 优先级 4: Analysis + mapping ───

  it('analysis + selectedMapping → mapping context', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'analysis',
      selectedMappingId: 'm1',
      selectedMappingPaperId: 'p1',
      selectedMappingConceptId: 'c1',
    }));
    expect(result).toEqual({
      type: 'mapping', mappingId: 'm1', paperId: 'p1', conceptId: 'c1',
    });
  });

  // ─── 优先级 5: Analysis + concept ───

  it('analysis + selectedConcept (no mapping) → concept context', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'analysis',
      selectedConceptId: 'c1',
    }));
    expect(result).toEqual({ type: 'concept', conceptId: 'c1' });
  });

  it('analysis + mapping takes priority over concept', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'analysis',
      selectedMappingId: 'm1',
      selectedMappingPaperId: 'p1',
      selectedMappingConceptId: 'c1',
      selectedConceptId: 'c2',
    }));
    expect(result.type).toBe('mapping');
  });

  // ─── 优先级 6: Graph ───

  it('graph + focusedNode → graphNode context', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'graph',
      focusedGraphNodeId: 'n1',
      focusedGraphNodeType: 'concept',
    }));
    expect(result).toEqual({ type: 'graphNode', nodeId: 'n1', nodeType: 'concept' });
  });

  it('graph + focusedNode without type → defaults to paper', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'graph',
      focusedGraphNodeId: 'n1',
      focusedGraphNodeType: null,
    }));
    expect(result).toEqual({ type: 'graphNode', nodeId: 'n1', nodeType: 'paper' });
  });

  // ─── 优先级 7: Library ───

  it('library + single paper → paper context with library origin', () => {
    const result = deriveContextSource(defaultInput({
      selectedPaperId: 'p1',
      selectionMode: 'explicit',
      multiIds: ['p1'],
    }));
    expect(result).toEqual({ type: 'paper', paperId: 'p1', originView: 'library' });
  });

  it('library + multi-select explicit → papers context', () => {
    const result = deriveContextSource(defaultInput({
      selectedPaperId: 'p2',
      selectionMode: 'explicit',
      multiIds: ['p1', 'p2', 'p3'],
    }));
    expect(result).toEqual({
      type: 'papers', paperIds: ['p1', 'p2', 'p3'], originView: 'library',
    });
  });

  it('library + allExcept mode → allSelected context', () => {
    const result = deriveContextSource(defaultInput({
      selectedPaperId: 'p1',
      selectionMode: 'allExcept',
      multiIds: [],
      excludedCount: 0,
    }));
    expect(result).toEqual({ type: 'allSelected', excludedCount: 0 });
  });

  it('library + allExcept mode with exclusions → allSelected with count', () => {
    const result = deriveContextSource(defaultInput({
      selectedPaperId: 'p1',
      selectionMode: 'allExcept',
      multiIds: [],
      excludedCount: 3,
    }));
    expect(result).toEqual({ type: 'allSelected', excludedCount: 3 });
  });

  it('library + allExcept mode without selectedPaper → still allSelected', () => {
    const result = deriveContextSource(defaultInput({
      selectedPaperId: null,
      selectionMode: 'allExcept',
      multiIds: [],
      excludedCount: 0,
    }));
    expect(result).toEqual({ type: 'allSelected', excludedCount: 0 });
  });

  // ─── 优先级 8: Notes ───

  it('notes + selectedNote → note context', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'notes',
      selectedNoteId: 'note1',
    }));
    expect(result).toEqual({ type: 'note', noteId: 'note1' });
  });

  it('notes + selectedMemo → memo context', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'notes',
      selectedMemoId: 'memo1',
    }));
    expect(result).toEqual({ type: 'memo', memoId: 'memo1' });
  });

  it('notes + both note and memo → note takes priority', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'notes',
      selectedNoteId: 'note1',
      selectedMemoId: 'memo1',
    }));
    expect(result.type).toBe('note');
  });

  it('notes + nothing selected → empty', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'notes',
    }));
    expect(result).toEqual({ type: 'empty' });
  });

  // ─── 跨视图优先级 ───

  it('reader takes priority over library selection', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'reader',
      selectedPaperId: 'p1',
      selectionMode: 'explicit',
      multiIds: ['p1', 'p2'],
    }));
    // Reader (priority 2) should win over Library multi-select (priority 7)
    expect(result).toEqual({ type: 'paper', paperId: 'p1', originView: 'reader' });
  });

  it('settings view → empty regardless of selections', () => {
    const result = deriveContextSource(defaultInput({
      activeView: 'settings',
      selectedPaperId: 'p1',
      selectedConceptId: 'c1',
    }));
    expect(result).toEqual({ type: 'empty' });
  });
});

// ════════════════════════════════════════
// §2 SelectionSlice — store action 测试
// ════════════════════════════════════════

describe('selectionSlice', () => {
  beforeEach(() => {
    useAppStore.getState().clearSelection();
  });

  // ─── selectPaper ───

  it('selectPaper: sets explicit mode with single id', () => {
    useAppStore.getState().selectPaper('p1');
    const s = useAppStore.getState();
    expect(s.selectedPaperId).toBe('p1');
    expect(s.selectionMode).toBe('explicit');
    expect(s.explicitIds).toEqual({ p1: true });
    expect(s.selectionAnchorId).toBe('p1');
  });

  it('selectPaper(null): clears paper selection', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectPaper(null);
    const s = useAppStore.getState();
    expect(s.selectedPaperId).toBeNull();
    expect(s.explicitIds).toEqual({});
  });

  // ─── togglePaperSelection ───

  it('toggle adds a second paper to explicit selection', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().togglePaperSelection('p2');
    const s = useAppStore.getState();
    expect(s.explicitIds).toEqual({ p1: true, p2: true });
    expect(s.selectedPaperId).toBe('p2');
  });

  it('toggle removes an already-selected paper', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().togglePaperSelection('p2');
    useAppStore.getState().togglePaperSelection('p1');
    const s = useAppStore.getState();
    expect(s.explicitIds).toEqual({ p2: true });
    // selectedPaperId should point to remaining paper
    expect(s.selectedPaperId).not.toBeNull();
  });

  it('toggle last paper → selectedPaperId becomes null', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().togglePaperSelection('p1');
    const s = useAppStore.getState();
    expect(s.explicitIds).toEqual({});
    expect(s.selectedPaperId).toBeNull();
  });

  // ─── selectPaperRange ───

  it('selectPaperRange replaces selection with range', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectPaperRange(['p2', 'p3', 'p4']);
    const s = useAppStore.getState();
    expect(s.selectionMode).toBe('explicit');
    expect(s.explicitIds).toEqual({ p2: true, p3: true, p4: true });
    expect(s.selectedPaperId).toBe('p4');
  });

  // ─── selectAllPapers / deselectAllPapers ───

  it('selectAllPapers switches to allExcept mode', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectAllPapers();
    const s = useAppStore.getState();
    expect(s.selectionMode).toBe('allExcept');
    expect(s.excludedIds).toEqual({});
    // explicitIds is cleared
    expect(s.explicitIds).toEqual({});
  });

  it('deselectAllPapers resets everything', () => {
    useAppStore.getState().selectAllPapers();
    useAppStore.getState().deselectAllPapers();
    const s = useAppStore.getState();
    expect(s.selectionMode).toBe('explicit');
    expect(s.explicitIds).toEqual({});
    expect(s.excludedIds).toEqual({});
    expect(s.selectedPaperId).toBeNull();
    expect(s.selectionAnchorId).toBeNull();
  });

  // ─── allExcept toggle ───

  it('toggle in allExcept mode adds to excludedIds', () => {
    useAppStore.getState().selectAllPapers();
    useAppStore.getState().togglePaperSelection('p5');
    const s = useAppStore.getState();
    expect(s.selectionMode).toBe('allExcept');
    expect(s.excludedIds).toEqual({ p5: true });
  });

  it('toggle excluded paper in allExcept re-includes it', () => {
    useAppStore.getState().selectAllPapers();
    useAppStore.getState().togglePaperSelection('p5');
    useAppStore.getState().togglePaperSelection('p5');
    const s = useAppStore.getState();
    expect(s.excludedIds).toEqual({});
  });

  // ─── focusGraphNode with nodeType ───

  it('focusGraphNode sets both id and type', () => {
    useAppStore.getState().focusGraphNode('n1', 'concept');
    const s = useAppStore.getState();
    expect(s.focusedGraphNodeId).toBe('n1');
    expect(s.focusedGraphNodeType).toBe('concept');
  });

  it('focusGraphNode without type preserves existing type', () => {
    useAppStore.getState().focusGraphNode('n1', 'concept');
    useAppStore.getState().focusGraphNode('n2');
    const s = useAppStore.getState();
    expect(s.focusedGraphNodeId).toBe('n2');
    expect(s.focusedGraphNodeType).toBe('concept');
  });

  it('focusGraphNode(null) clears both id and type', () => {
    useAppStore.getState().focusGraphNode('n1', 'concept');
    useAppStore.getState().focusGraphNode(null);
    const s = useAppStore.getState();
    expect(s.focusedGraphNodeId).toBeNull();
    expect(s.focusedGraphNodeType).toBeNull();
  });

  // ─── clearSelection ───

  it('clearSelection resets all entity selections', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectConcept('c1');
    useAppStore.getState().selectMapping('m1', 'p1', 'c1');
    useAppStore.getState().selectMemo('memo1');
    useAppStore.getState().selectNote('note1');
    useAppStore.getState().focusGraphNode('n1', 'concept');

    useAppStore.getState().clearSelection();
    const s = useAppStore.getState();

    expect(s.selectedPaperId).toBeNull();
    expect(s.selectedConceptId).toBeNull();
    expect(s.selectedMappingId).toBeNull();
    expect(s.selectedMappingPaperId).toBeNull();
    expect(s.selectedMappingConceptId).toBeNull();
    expect(s.selectedSectionId).toBeNull();
    expect(s.selectedArticleId).toBeNull();
    expect(s.focusedGraphNodeId).toBeNull();
    expect(s.focusedGraphNodeType).toBeNull();
    expect(s.selectedMemoId).toBeNull();
    expect(s.selectedNoteId).toBeNull();
    expect(s.selectionMode).toBe('explicit');
    expect(s.explicitIds).toEqual({});
    expect(s.excludedIds).toEqual({});
  });
});

// ════════════════════════════════════════
// §3 集成测试：store action → deriveContextSource
// ════════════════════════════════════════

describe('store → deriveContextSource integration', () => {
  beforeEach(() => {
    useAppStore.getState().clearSelection();
    // Reset view to library
    useAppStore.getState().switchView('library');
  });

  /** Build DeriveContextInput from current store state */
  function inputFromStore(): DeriveContextInput {
    const s = useAppStore.getState();
    const multiIds = s.selectionMode === 'explicit'
      ? Object.keys(s.explicitIds).sort()
      : [];
    return {
      activeView: s.activeView,
      selectedPaperId: s.selectedPaperId,
      selectionMode: s.selectionMode,
      multiIds,
      selectedConceptId: s.selectedConceptId,
      selectedMappingId: s.selectedMappingId,
      selectedMappingPaperId: s.selectedMappingPaperId,
      selectedMappingConceptId: s.selectedMappingConceptId,
      selectedSectionId: s.selectedSectionId,
      selectedArticleId: s.selectedArticleId,
      selectedDraftId: s.selectedDraftId,
      focusedGraphNodeId: s.focusedGraphNodeId,
      focusedGraphNodeType: s.focusedGraphNodeType,
      selectedMemoId: s.selectedMemoId,
      selectedNoteId: s.selectedNoteId,
      excludedCount: Object.keys(s.excludedIds).length,
    };
  }

  it('single paper click → paper context', () => {
    useAppStore.getState().selectPaper('p1');
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'paper', paperId: 'p1', originView: 'library' });
  });

  it('Ctrl+Click multi-select → papers context', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().togglePaperSelection('p2');
    useAppStore.getState().togglePaperSelection('p3');
    const result = deriveContextSource(inputFromStore());
    expect(result.type).toBe('papers');
    if (result.type === 'papers') {
      expect(result.paperIds).toEqual(['p1', 'p2', 'p3']);
    }
  });

  it('Ctrl+A → allSelected context', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectAllPapers();
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'allSelected', excludedCount: 0 });
  });

  it('Ctrl+A then toggle exclude → allSelected with excludedCount', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectAllPapers();
    useAppStore.getState().togglePaperSelection('p2');
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'allSelected', excludedCount: 1 });
  });

  it('navigate to reader → reader context overrides library', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().togglePaperSelection('p2');
    useAppStore.getState().switchView('reader');
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'paper', paperId: 'p2', originView: 'reader' });
  });

  it('graph focus with nodeType → graphNode context', () => {
    useAppStore.getState().switchView('graph');
    useAppStore.getState().focusGraphNode('n1', 'concept');
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'graphNode', nodeId: 'n1', nodeType: 'concept' });
  });

  it('notes + select memo → memo context', () => {
    useAppStore.getState().switchView('notes');
    useAppStore.getState().selectMemo('memo1');
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'memo', memoId: 'memo1' });
  });

  it('notes + select note → note context', () => {
    useAppStore.getState().switchView('notes');
    useAppStore.getState().selectNote('note1');
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'note', noteId: 'note1' });
  });

  it('notes note→memo transition keeps memo as effective context', () => {
    useAppStore.getState().switchView('notes');
    useAppStore.getState().navigateTo({ type: 'note', noteId: 'note1' });
    useAppStore.getState().navigateTo({ type: 'memo', memoId: 'memo1' });
    const result = deriveContextSource(inputFromStore());
    expect(result).toEqual({ type: 'memo', memoId: 'memo1' });
  });
});
