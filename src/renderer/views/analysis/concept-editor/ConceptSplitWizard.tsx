/**
 * ConceptSplitWizard -- 3-step concept split wizard (v2.0 §2.6)
 *
 * Step 1: Define new concepts -- two name + definition inputs. Can copy from original.
 * Step 2: Assign mappings -- dual-column transfer list. "AI 预分配" placeholder for 20+ items.
 * Step 3: Confirm -- summary + execute split.
 */

import React, { useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  Scissors,
  AlertTriangle,
  Copy,
  ChevronRight,
  ChevronLeft,
  Check,
  Sparkles,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import { useConceptList } from '../../../core/ipc/hooks/useConcepts';
import type {
  Concept,
  ConceptMapping,
  ConceptDraft,
} from '../../../../shared-types/models';

// ── Props ──

interface ConceptSplitWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The concept being split. */
  conceptId: string;
}

// ── Reducer ──

type Step = 1 | 2 | 3;

interface DraftConcept {
  name: string;
  definition: string;
}

/** Where a mapping is assigned: 'a1' | 'a2' | 'both'. */
type AssignTarget = 'a1' | 'a2' | 'both';

interface SplitState {
  step: Step;
  /** Draft for concept A1 (first new concept). */
  draft1: DraftConcept;
  /** Draft for concept A2 (second new concept). */
  draft2: DraftConcept;
  /** Original concept's mappings fetched from backend. */
  mappings: ConceptMapping[];
  /** Paper titles keyed by paperId (best-effort). */
  paperTitles: Record<string, string>;
  /** Assignment of each mapping id -> 'a1' | 'a2' | 'both'. */
  assignments: Record<string, AssignTarget>;
  loading: boolean;
  aiLoading: boolean;
  error: string | null;
}

type SplitAction =
  | { type: 'SET_STEP'; step: Step }
  | { type: 'UPDATE_DRAFT'; which: 1 | 2; field: 'name' | 'definition'; value: string }
  | { type: 'COPY_FROM_ORIGINAL'; which: 1 | 2; name: string; definition: string }
  | { type: 'SET_MAPPINGS'; mappings: ConceptMapping[]; paperTitles: Record<string, string> }
  | { type: 'ASSIGN_MAPPING'; mappingId: string; target: AssignTarget }
  | { type: 'ASSIGN_ALL'; target: AssignTarget }
  | { type: 'BULK_ASSIGN'; assignments: Record<string, AssignTarget> }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_AI_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

const emptyDraft: DraftConcept = { name: '', definition: '' };

const initialState: SplitState = {
  step: 1,
  draft1: { ...emptyDraft },
  draft2: { ...emptyDraft },
  mappings: [],
  paperTitles: {},
  assignments: {},
  loading: false,
  aiLoading: false,
  error: null,
};

function reducer(state: SplitState, action: SplitAction): SplitState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step, error: null };
    case 'UPDATE_DRAFT': {
      const key = action.which === 1 ? 'draft1' : 'draft2';
      return {
        ...state,
        [key]: { ...state[key], [action.field]: action.value },
      };
    }
    case 'COPY_FROM_ORIGINAL': {
      const key = action.which === 1 ? 'draft1' : 'draft2';
      return {
        ...state,
        [key]: { name: action.name, definition: action.definition },
      };
    }
    case 'SET_MAPPINGS': {
      // Default: all assigned to 'a1'.
      const assignments: Record<string, AssignTarget> = {};
      for (const m of action.mappings) {
        assignments[m.id] = 'a1';
      }
      return {
        ...state,
        mappings: action.mappings,
        paperTitles: action.paperTitles,
        assignments,
      };
    }
    case 'ASSIGN_MAPPING':
      return {
        ...state,
        assignments: { ...state.assignments, [action.mappingId]: action.target },
      };
    case 'ASSIGN_ALL': {
      const next: Record<string, AssignTarget> = {};
      for (const id of Object.keys(state.assignments)) {
        next[id] = action.target;
      }
      return { ...state, assignments: next };
    }
    case 'BULK_ASSIGN':
      return { ...state, assignments: { ...state.assignments, ...action.assignments } };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'SET_AI_LOADING':
      return { ...state, aiLoading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Helpers ──

const STEP_LABELS: Record<Step, string> = {
  1: '定义新概念',
  2: '分配映射',
  3: '确认执行',
};

const TARGET_LABELS: Record<AssignTarget, string> = {
  a1: '概念 A1',
  a2: '概念 A2',
  both: '两者',
};

// ── Component ──

export function ConceptSplitWizard({
  open,
  onOpenChange,
  conceptId,
}: ConceptSplitWizardProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const { data: conceptListData } = useConceptList();
  const concepts: Concept[] = conceptListData ?? [];

  const originalConcept = useMemo(
    () => concepts.find((c) => c.id === conceptId) ?? null,
    [concepts, conceptId]
  );

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  // Validation: both drafts must have name and definition, names must differ and be unique.
  const draft1NameTrimmed = state.draft1.name.trim();
  const draft2NameTrimmed = state.draft2.name.trim();
  const namesAreDifferent = draft1NameTrimmed.toLowerCase() !== draft2NameTrimmed.toLowerCase();
  const namesAreUnique = !concepts.some(
    (c) =>
      c.id !== conceptId &&
      (c.name.toLowerCase() === draft1NameTrimmed.toLowerCase() ||
        c.name.toLowerCase() === draft2NameTrimmed.toLowerCase() ||
        c.nameZh.toLowerCase() === draft1NameTrimmed.toLowerCase() ||
        c.nameZh.toLowerCase() === draft2NameTrimmed.toLowerCase()),
  );

  const draftsValid =
    draft1NameTrimmed.length > 0 &&
    state.draft1.definition.trim().length > 0 &&
    draft2NameTrimmed.length > 0 &&
    state.draft2.definition.trim().length > 0 &&
    namesAreDifferent &&
    namesAreUnique;

  // ── Step transitions ──

  const goToStep2 = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const api = getAPI();
      const mappings: ConceptMapping[] =
        await api.db.mappings.getForConcept(conceptId);

      // Resolve paper titles (best-effort).
      let paperTitles: Record<string, string> = {};
      if (mappings.length > 0) {
        try {
          const paperIds = [...new Set(mappings.map((m) => m.paperId))];
          const papers = await Promise.all(
            paperIds.map((pid) => api.db.papers.get(pid).catch(() => null))
          );
          paperTitles = Object.fromEntries(
            papers.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => [p.id, p.title])
          );
        } catch {
          // Paper title resolution is best-effort.
        }
      }

      dispatch({ type: 'SET_MAPPINGS', mappings, paperTitles });
      dispatch({ type: 'SET_STEP', step: 2 });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [conceptId]);

  const goToStep3 = useCallback(() => {
    dispatch({ type: 'SET_STEP', step: 3 });
  }, []);

  // ── AI pre-assignment (placeholder) ──

  const handleAIPreAssign = useCallback(async () => {
    if (!mountedRef.current) return;
    dispatch({ type: 'SET_AI_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const api = getAPI();
      // Use LLM to classify mappings based on semantic similarity to each draft's definition
      const prompt = `Given two new concept definitions:
Concept A1: "${state.draft1.name}" - ${state.draft1.definition}
Concept A2: "${state.draft2.name}" - ${state.draft2.definition}

For each of the following paper-concept mappings, classify which concept (a1, a2, or both) the mapping best fits. Return a JSON object mapping mappingId to "a1", "a2", or "both".

Mappings:
${state.mappings.map((m) => `- ${m.id}: ${m.relationType} (confidence: ${m.confidence.toFixed(2)}) evidence: "${(m.evidenceText ?? '').slice(0, 100)}"`).join('\n')}

Respond ONLY with a JSON object, no other text.`;

      const result = await api.chat.send(prompt);

      // Parse the LLM response as JSON — use non-greedy match to avoid spanning multiple objects
      const jsonMatch = result.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse AI response');
      }

      const assignments: Record<string, AssignTarget> = {};
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;

      for (const [mappingId, target] of Object.entries(parsed)) {
        const normalized = (target as string).toLowerCase().trim();
        if (normalized === 'a1' || normalized === 'a2' || normalized === 'both') {
          assignments[mappingId] = normalized;
        }
      }

      // Only apply assignments for mappings we actually have
      const validAssignments: Record<string, AssignTarget> = {};
      for (const m of state.mappings) {
        validAssignments[m.id] = assignments[m.id] ?? state.assignments[m.id] ?? 'a1';
      }

      dispatch({ type: 'BULK_ASSIGN', assignments: validAssignments });
    } catch (err) {
      // Fallback to heuristic if LLM fails: use character n-gram similarity
      // Works for both CJK (no spaces) and Latin (space-delimited) text
      try {
        const newAssignments: Record<string, AssignTarget> = {};
        const d1Lower = state.draft1.definition.toLowerCase();
        const d2Lower = state.draft2.definition.toLowerCase();

        // Extract tokens: split on whitespace for Latin, then add character bigrams for CJK
        function tokenize(text: string): Set<string> {
          const tokens = new Set<string>();
          // Whitespace-delimited words (Latin/mixed)
          for (const w of text.split(/\s+/)) {
            if (w.length > 2) tokens.add(w);
          }
          // Character bigrams (effective for CJK where no spaces exist)
          for (let i = 0; i < text.length - 1; i++) {
            tokens.add(text.slice(i, i + 2));
          }
          return tokens;
        }

        const d1Tokens = tokenize(d1Lower);
        const d2Tokens = tokenize(d2Lower);

        for (const m of state.mappings) {
          const evidence = (m.evidenceText ?? '').toLowerCase();
          const evidenceTokens = tokenize(evidence);

          let score1 = 0;
          let score2 = 0;
          for (const token of evidenceTokens) {
            if (d1Tokens.has(token)) score1++;
            if (d2Tokens.has(token)) score2++;
          }

          if (score1 > score2 * 1.5) {
            newAssignments[m.id] = 'a1';
          } else if (score2 > score1 * 1.5) {
            newAssignments[m.id] = 'a2';
          } else {
            newAssignments[m.id] = 'both';
          }
        }
        dispatch({ type: 'BULK_ASSIGN', assignments: newAssignments });
      } catch {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (mountedRef.current) dispatch({ type: 'SET_AI_LOADING', loading: false });
    }
  }, [state.mappings, state.draft1, state.draft2, state.assignments]);

  // ── Execute split ──

  const executeSplit = useCallback(async () => {
    if (!originalConcept) return;
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const concept1Draft: ConceptDraft = {
        nameZh: state.draft1.name,
        nameEn: '',
        definition: state.draft1.definition,
        keywords: [],
        parentId: originalConcept.parentId,
      };
      const concept2Draft: ConceptDraft = {
        nameZh: state.draft2.name,
        nameEn: '',
        definition: state.draft2.definition,
        keywords: [],
        parentId: originalConcept.parentId,
      };

      // Build mapping assignments array from the Record<string, AssignTarget>.
      // The API expects MappingAssignment[] where targetConceptId is populated after split;
      // since we don't know the new concept IDs yet, we use 'a1'/'a2' as placeholders
      // and let the backend resolve them.
      const mappingAssignments: import('../../../../shared-types/models').MappingAssignment[] =
        Object.entries(state.assignments).map(([mappingId, target]) => ({
          mappingId,
          targetConceptId: target, // 'a1' | 'a2' | 'both' — backend interprets these
        }));

      await getAPI().db.concepts.split(
        conceptId,
        concept1Draft,
        concept2Draft,
        mappingAssignments
      );
      handleOpenChange(false);
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [originalConcept, state, conceptId, handleOpenChange]);

  // ── Derived counts for summary ──

  const assignmentCounts = useMemo(() => {
    let a1 = 0;
    let a2 = 0;
    let both = 0;
    for (const target of Object.values(state.assignments)) {
      if (target === 'a1') a1++;
      else if (target === 'a2') a2++;
      else both++;
    }
    return { a1, a2, both };
  }, [state.assignments]);

  // Group mappings by assignment for dual-column view.
  const columnA1 = useMemo(
    () =>
      state.mappings.filter(
        (m) => state.assignments[m.id] === 'a1' || state.assignments[m.id] === 'both'
      ),
    [state.mappings, state.assignments]
  );

  const columnA2 = useMemo(
    () =>
      state.mappings.filter(
        (m) => state.assignments[m.id] === 'a2' || state.assignments[m.id] === 'both'
      ),
    [state.mappings, state.assignments]
  );

  if (!originalConcept) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle}>
          {/* Header */}
          <Dialog.Title style={titleStyle}>
            <Scissors size={16} />
            拆分概念: {originalConcept.name}
          </Dialog.Title>

          {/* Step indicator */}
          <div style={stepIndicatorStyle}>
            {([1, 2, 3] as Step[]).map((s) => (
              <div key={s} style={stepDotContainerStyle}>
                <div
                  style={{
                    ...stepDotStyle,
                    backgroundColor:
                      s < state.step
                        ? 'var(--accent-color)'
                        : s === state.step
                        ? 'var(--accent-color)'
                        : 'var(--border-subtle)',
                    color: s <= state.step ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {s < state.step ? <Check size={10} /> : s}
                </div>
                <span style={stepLabelStyle}>{STEP_LABELS[s]}</span>
              </div>
            ))}
          </div>

          {/* Error banner */}
          {state.error && (
            <div style={errorBannerStyle}>
              <AlertTriangle size={14} /> {state.error}
            </div>
          )}

          {/* ── Step 1: Define new concepts ── */}
          {state.step === 1 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>
                将 <strong>{originalConcept.name}</strong>{' '}
                拆分为两个新概念。请为每个新概念定义名称和定义。
              </p>

              {/* Draft A1 */}
              <div style={draftCardStyle}>
                <div style={draftHeaderStyle}>
                  <span style={draftLabelStyle}>新概念 A1</span>
                  <button
                    type="button"
                    style={copyButtonStyle}
                    title="从原概念复制"
                    onClick={() =>
                      dispatch({
                        type: 'COPY_FROM_ORIGINAL',
                        which: 1,
                        name: originalConcept.name,
                        definition: originalConcept.description,
                      })
                    }
                  >
                    <Copy size={12} /> 从原概念复制
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="概念名称"
                  value={state.draft1.name}
                  onChange={(e) =>
                    dispatch({
                      type: 'UPDATE_DRAFT',
                      which: 1,
                      field: 'name',
                      value: e.target.value,
                    })
                  }
                  style={inputStyle}
                />
                <textarea
                  placeholder="概念定义"
                  value={state.draft1.definition}
                  onChange={(e) =>
                    dispatch({
                      type: 'UPDATE_DRAFT',
                      which: 1,
                      field: 'definition',
                      value: e.target.value,
                    })
                  }
                  style={textareaStyle}
                  rows={3}
                />
              </div>

              {/* Draft A2 */}
              <div style={draftCardStyle}>
                <div style={draftHeaderStyle}>
                  <span style={draftLabelStyle}>新概念 A2</span>
                  <button
                    type="button"
                    style={copyButtonStyle}
                    title="从原概念复制"
                    onClick={() =>
                      dispatch({
                        type: 'COPY_FROM_ORIGINAL',
                        which: 2,
                        name: originalConcept.name,
                        definition: originalConcept.description,
                      })
                    }
                  >
                    <Copy size={12} /> 从原概念复制
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="概念名称"
                  value={state.draft2.name}
                  onChange={(e) =>
                    dispatch({
                      type: 'UPDATE_DRAFT',
                      which: 2,
                      field: 'name',
                      value: e.target.value,
                    })
                  }
                  style={inputStyle}
                />
                <textarea
                  placeholder="概念定义"
                  value={state.draft2.definition}
                  onChange={(e) =>
                    dispatch({
                      type: 'UPDATE_DRAFT',
                      which: 2,
                      field: 'definition',
                      value: e.target.value,
                    })
                  }
                  style={textareaStyle}
                  rows={3}
                />
              </div>

              {/* Original concept reference */}
              <div style={originalRefStyle}>
                <div style={originalRefLabelStyle}>原概念参考</div>
                <div style={originalRefNameStyle}>{originalConcept.name}</div>
                <div style={originalRefDescStyle}>
                  {originalConcept.description.slice(0, 120)}
                  {originalConcept.description.length > 120 ? '...' : ''}
                </div>
              </div>

              {draft1NameTrimmed.length > 0 && draft2NameTrimmed.length > 0 && !namesAreDifferent && (
                <div style={{ fontSize: 12, color: 'var(--danger, #e53e3e)', marginTop: 4 }}>
                  Two concepts must have different names.
                </div>
              )}
              {draft1NameTrimmed.length > 0 && draft2NameTrimmed.length > 0 && !namesAreUnique && namesAreDifferent && (
                <div style={{ fontSize: 12, color: 'var(--danger, #e53e3e)', marginTop: 4 }}>
                  A concept with this name already exists.
                </div>
              )}

              <div style={buttonRowStyle}>
                <Dialog.Close asChild>
                  <button type="button" style={secondaryButtonStyle}>
                    取消
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={!draftsValid || state.loading}
                  onClick={goToStep2}
                >
                  {state.loading ? '加载映射中...' : '下一步'}
                  {!state.loading && <ChevronRight size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Assign mappings ── */}
          {state.step === 2 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>
                将原概念的映射分配到新概念。点击映射卡片上的按钮进行分配。
              </p>

              {/* AI pre-assign button (shown when 20+ mappings) */}
              {state.mappings.length >= 20 && (
                <button
                  type="button"
                  style={aiButtonStyle}
                  disabled={state.aiLoading}
                  onClick={handleAIPreAssign}
                >
                  <Sparkles size={14} />
                  {state.aiLoading ? 'AI 预分配中...' : 'AI 预分配'}
                </button>
              )}

              {/* Dual-column layout */}
              <div style={dualColumnContainerStyle}>
                {/* Column A1 */}
                <div style={columnStyle}>
                  <div style={columnHeaderStyle}>
                    <span style={columnTitleStyle}>
                      {state.draft1.name || '概念 A1'}
                    </span>
                    <span style={columnCountStyle}>{assignmentCounts.a1 + assignmentCounts.both} 条</span>
                  </div>
                  <div style={columnListStyle}>
                    {columnA1.map((m) => (
                      <MappingCard
                        key={`a1-${m.id}`}
                        mapping={m}
                        paperTitle={state.paperTitles[m.paperId]}
                        currentTarget={state.assignments[m.id] ?? 'a1'}
                        onAssign={(target) =>
                          dispatch({
                            type: 'ASSIGN_MAPPING',
                            mappingId: m.id,
                            target,
                          })
                        }
                      />
                    ))}
                    {columnA1.length === 0 && (
                      <div style={emptyColumnStyle}>暂无映射</div>
                    )}
                  </div>
                </div>

                {/* Column A2 */}
                <div style={columnStyle}>
                  <div style={columnHeaderStyle}>
                    <span style={columnTitleStyle}>
                      {state.draft2.name || '概念 A2'}
                    </span>
                    <span style={columnCountStyle}>{assignmentCounts.a2 + assignmentCounts.both} 条</span>
                  </div>
                  <div style={columnListStyle}>
                    {columnA2.map((m) => (
                      <MappingCard
                        key={`a2-${m.id}`}
                        mapping={m}
                        paperTitle={state.paperTitles[m.paperId]}
                        currentTarget={state.assignments[m.id] ?? 'a1'}
                        onAssign={(target) =>
                          dispatch({
                            type: 'ASSIGN_MAPPING',
                            mappingId: m.id,
                            target,
                          })
                        }
                      />
                    ))}
                    {columnA2.length === 0 && (
                      <div style={emptyColumnStyle}>暂无映射</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Unassigned count / bulk actions */}
              <div style={bulkActionsStyle}>
                <span style={bulkStatStyle}>
                  A1: {assignmentCounts.a1} · A2: {assignmentCounts.a2} · 两者: {assignmentCounts.both}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    style={tinyButtonStyle}
                    onClick={() => dispatch({ type: 'ASSIGN_ALL', target: 'a1' })}
                  >
                    全部 → A1
                  </button>
                  <button
                    type="button"
                    style={tinyButtonStyle}
                    onClick={() => dispatch({ type: 'ASSIGN_ALL', target: 'a2' })}
                  >
                    全部 → A2
                  </button>
                </div>
              </div>

              {state.mappings.length === 0 && (
                <div style={emptyHintStyle}>原概念暂无映射，可直接进入下一步。</div>
              )}

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => dispatch({ type: 'SET_STEP', step: 1 })}
                >
                  <ChevronLeft size={14} /> 返回
                </button>
                <button type="button" style={primaryButtonStyle} onClick={goToStep3}>
                  下一步 <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {state.step === 3 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>请确认以下拆分操作:</p>

              <div style={summaryContainerStyle}>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>原概念（将删除）</span>
                  <span style={summaryValueDangerStyle}>{originalConcept.name}</span>
                </div>
                <div style={summaryDividerStyle} />
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>新概念 A1</span>
                  <span style={summaryValueStyle}>{state.draft1.name}</span>
                </div>
                <div style={summarySubRowStyle}>
                  <span style={summarySubLabelStyle}>定义</span>
                  <span style={summarySubValueStyle}>
                    {state.draft1.definition.slice(0, 80)}
                    {state.draft1.definition.length > 80 ? '...' : ''}
                  </span>
                </div>
                <div style={summarySubRowStyle}>
                  <span style={summarySubLabelStyle}>映射数</span>
                  <span style={summarySubValueStyle}>
                    {assignmentCounts.a1 + assignmentCounts.both} 条
                  </span>
                </div>
                <div style={summaryDividerStyle} />
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>新概念 A2</span>
                  <span style={summaryValueStyle}>{state.draft2.name}</span>
                </div>
                <div style={summarySubRowStyle}>
                  <span style={summarySubLabelStyle}>定义</span>
                  <span style={summarySubValueStyle}>
                    {state.draft2.definition.slice(0, 80)}
                    {state.draft2.definition.length > 80 ? '...' : ''}
                  </span>
                </div>
                <div style={summarySubRowStyle}>
                  <span style={summarySubLabelStyle}>映射数</span>
                  <span style={summarySubValueStyle}>
                    {assignmentCounts.a2 + assignmentCounts.both} 条
                  </span>
                </div>
                {assignmentCounts.both > 0 && (
                  <>
                    <div style={summaryDividerStyle} />
                    <div style={summarySubRowStyle}>
                      <span style={summarySubLabelStyle}>同属两者的映射</span>
                      <span style={summarySubValueStyle}>{assignmentCounts.both} 条</span>
                    </div>
                  </>
                )}
              </div>

              <div style={warningBannerStyle}>
                <AlertTriangle size={14} />
                此操作不可撤销。原概念将被删除，映射将分配到新概念。
              </div>

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
                >
                  <ChevronLeft size={14} /> 返回
                </button>
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={state.loading}
                  onClick={executeSplit}
                >
                  {state.loading ? '拆分中...' : '确认拆分'}
                </button>
              </div>
            </div>
          )}

          {/* Close button */}
          <Dialog.Close asChild>
            <button type="button" style={closeButtonStyle} aria-label="Close">
              <X size={16} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Sub-components ──

function MappingCard({
  mapping,
  paperTitle,
  currentTarget,
  onAssign,
}: {
  mapping: ConceptMapping;
  paperTitle?: string | undefined;
  currentTarget: AssignTarget;
  onAssign: (target: AssignTarget) => void;
}) {
  return (
    <div style={mappingCardStyle}>
      <div style={mappingCardBodyStyle}>
        <div style={mappingCardTitleStyle}>
          {paperTitle ?? mapping.paperId}
        </div>
        <div style={mappingCardMetaStyle}>
          {mapping.relationType} · 置信度 {mapping.confidence.toFixed(2)}
        </div>
      </div>
      <div style={mappingCardActionsStyle}>
        {(['a1', 'a2', 'both'] as AssignTarget[]).map((target) => (
          <button
            key={target}
            type="button"
            style={
              currentTarget === target ? chipActiveStyle : chipStyle
            }
            onClick={() => onAssign(target)}
          >
            {TARGET_LABELS[target]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Styles ──

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  zIndex: 1000,
};

const contentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md, 8px)',
  padding: 24,
  width: 700,
  maxHeight: '85vh',
  overflowY: 'auto',
  zIndex: 1001,
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
};

const titleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
  color: 'var(--text-primary)',
};

const stepIndicatorStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  gap: 32,
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-subtle)',
};

const stepDotContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
};

const stepDotStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 600,
};

const stepLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
};

const stepBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

// Draft cards
const draftCardStyle: React.CSSProperties = {
  padding: '12px 14px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const draftHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const draftLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const copyButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent',
  color: 'var(--accent-color)',
  fontSize: 'var(--text-xs, 11px)',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm, 13px)',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm, 13px)',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const originalRefStyle: React.CSSProperties = {
  padding: '8px 12px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px dashed var(--border-subtle)',
};

const originalRefLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  marginBottom: 4,
};

const originalRefNameStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  fontWeight: 500,
  color: 'var(--text-primary)',
  marginBottom: 4,
};

const originalRefDescStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-secondary)',
  lineHeight: 1.4,
};

// Dual-column
const dualColumnContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
};

const columnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const columnHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 10px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0',
  border: '1px solid var(--border-subtle)',
  borderBottom: 'none',
};

const columnTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const columnCountStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  flexShrink: 0,
};

const columnListStyle: React.CSSProperties = {
  maxHeight: 240,
  overflowY: 'auto',
  border: '1px solid var(--border-subtle)',
  borderRadius: '0 0 var(--radius-sm, 4px) var(--radius-sm, 4px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const emptyColumnStyle: React.CSSProperties = {
  padding: 20,
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs, 11px)',
};

// Mapping card
const mappingCardStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const mappingCardBodyStyle: React.CSSProperties = {
  minWidth: 0,
};

const mappingCardTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  fontWeight: 500,
  color: 'var(--text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const mappingCardMetaStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-secondary)',
};

const mappingCardActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

// Bulk actions
const bulkActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const bulkStatStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
};

const tinyButtonStyle: React.CSSProperties = {
  padding: '2px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs, 11px)',
  cursor: 'pointer',
};

// AI button
const aiButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 14px',
  border: '1px dashed var(--accent-color)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'rgba(var(--accent-color-rgb, 59,130,246), 0.05)',
  color: 'var(--accent-color)',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
};

const emptyHintStyle: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm, 13px)',
};

// Chips
const chipStyle: React.CSSProperties = {
  padding: '1px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs, 11px)',
  cursor: 'pointer',
};

const chipActiveStyle: React.CSSProperties = {
  ...chipStyle,
  borderColor: 'var(--accent-color)',
  backgroundColor: 'var(--accent-color)',
  color: '#fff',
};

// Summary
const summaryContainerStyle: React.CSSProperties = {
  padding: '12px 14px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const summaryRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const summaryLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  color: 'var(--text-muted)',
};

const summaryValueStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  fontWeight: 500,
  color: 'var(--text-primary)',
};

const summaryValueDangerStyle: React.CSSProperties = {
  ...summaryValueStyle,
  color: 'var(--danger, #e53e3e)',
};

const summarySubRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingLeft: 12,
};

const summarySubLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
};

const summarySubValueStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-secondary)',
  maxWidth: '60%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const summaryDividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-subtle)',
  margin: '4px 0',
};

// Banners
const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  backgroundColor: 'var(--danger-bg, rgba(255,0,0,0.1))',
  color: 'var(--danger, #e53e3e)',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--text-sm, 13px)',
  marginBottom: 8,
};

const warningBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  backgroundColor: 'rgba(234, 179, 8, 0.1)',
  color: 'var(--warning, #d69e2e)',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--text-sm, 13px)',
};

// Buttons
const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 16px',
  border: 'none',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--accent-color)',
  color: '#fff',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 16px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  border: 'none',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--danger, #e53e3e)',
  color: '#fff',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
};

const closeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
