/**
 * 渲染进程测试示例 —— useAppStore (Zustand)
 *
 * 演示：
 *  - jsdom 环境下直接测试 Zustand store 逻辑（不渲染 React 组件）
 *  - beforeEach 重置 store 状态
 *  - NavigationTarget 导航协议
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

describe('useAppStore - selection slice', () => {
  beforeEach(() => {
    useAppStore.getState().clearSelection();
  });

  it('should start with null selection', () => {
    const state = useAppStore.getState();
    expect(state.selectedPaperId).toBeNull();
    expect(state.selectedConceptId).toBeNull();
  });

  it('should select a paper', () => {
    useAppStore.getState().selectPaper('paper_123');
    expect(useAppStore.getState().selectedPaperId).toBe('paper_123');
  });

  it('should select a paper with explicit mode', () => {
    useAppStore.getState().selectPaper('p1');
    const state = useAppStore.getState();
    expect(state.selectionMode).toBe('explicit');
    expect(state.explicitIds).toEqual({ p1: true });
  });

  it('should clear all selections', () => {
    useAppStore.getState().selectPaper('p1');
    useAppStore.getState().selectConcept('c1');
    useAppStore.getState().clearSelection();

    const state = useAppStore.getState();
    expect(state.selectedPaperId).toBeNull();
    expect(state.selectedConceptId).toBeNull();
    expect(state.selectionMode).toBe('explicit');
    expect(state.explicitIds).toEqual({});
  });
});

describe('useAppStore - navigation slice', () => {
  beforeEach(() => {
    useAppStore.getState().clearSelection();
    useAppStore.setState({
      activeView: 'library',
      previousView: null,
      navigationStack: [],
    });
  });

  it('should have library as default active view', () => {
    expect(useAppStore.getState().activeView).toBe('library');
  });

  it('should navigate to paper in reader view', () => {
    useAppStore.getState().navigateTo({
      type: 'paper',
      id: 'paper_1',
      view: 'reader',
    });

    expect(useAppStore.getState().activeView).toBe('reader');
  });

  it('should navigate to concept in analysis view', () => {
    useAppStore.getState().navigateTo({
      type: 'concept',
      id: 'concept_1',
    });

    expect(useAppStore.getState().activeView).toBe('analysis');
  });

  it('should clear selected note when navigating to memo', () => {
    useAppStore.getState().navigateTo({
      type: 'note',
      noteId: 'note_1',
    });

    useAppStore.getState().navigateTo({
      type: 'memo',
      memoId: 'memo_1',
    });

    const state = useAppStore.getState();
    expect(state.activeView).toBe('notes');
    expect(state.selectedMemoId).toBe('memo_1');
    expect(state.selectedNoteId).toBeNull();
  });

  it('should clear selected memo when navigating to note', () => {
    useAppStore.getState().navigateTo({
      type: 'memo',
      memoId: 'memo_1',
    });

    useAppStore.getState().navigateTo({
      type: 'note',
      noteId: 'note_1',
    });

    const state = useAppStore.getState();
    expect(state.activeView).toBe('notes');
    expect(state.selectedNoteId).toBe('note_1');
    expect(state.selectedMemoId).toBeNull();
  });

  it('should restore previous note target when going back from memo', () => {
    useAppStore.getState().navigateTo({
      type: 'note',
      noteId: 'note_1',
    });
    useAppStore.getState().navigateTo({
      type: 'memo',
      memoId: 'memo_1',
    });

    useAppStore.getState().goBack();

    const state = useAppStore.getState();
    expect(state.activeView).toBe('notes');
    expect(state.previousView).toBe('notes');
    expect(state.selectedNoteId).toBe('note_1');
    expect(state.selectedMemoId).toBeNull();
    expect(state.navigationStack).toEqual([{ type: 'note', noteId: 'note_1' }]);
  });

  it('should restore paper selection state when going back', () => {
    useAppStore.getState().navigateTo({
      type: 'paper',
      id: 'paper_1',
      view: 'reader',
    });
    useAppStore.getState().navigateTo({
      type: 'concept',
      id: 'concept_1',
    });

    useAppStore.getState().goBack();

    const state = useAppStore.getState();
    expect(state.activeView).toBe('reader');
    expect(state.selectedPaperId).toBe('paper_1');
    expect(state.explicitIds).toEqual({ paper_1: true });
    expect(state.selectionAnchorId).toBe('paper_1');
    expect(state.selectedConceptId).toBeNull();
    expect(state.navigationStack).toEqual([{ type: 'paper', id: 'paper_1', view: 'reader' }]);
  });

  it('should restore section target metadata when going back', () => {
    useAppStore.getState().navigateTo({
      type: 'section',
      articleId: 'article_1',
      sectionId: 'section_1',
    });
    useAppStore.getState().navigateTo({
      type: 'note',
      noteId: 'note_1',
    });

    useAppStore.getState().goBack();

    const state = useAppStore.getState();
    expect(state.activeView).toBe('writing');
    expect(state.selectedSectionId).toBe('section_1');
    expect(state.selectedArticleId).toBe('article_1');
    expect(state.selectedDraftId).toBeNull();
    expect(state.selectedNoteId).toBeNull();
  });
});
