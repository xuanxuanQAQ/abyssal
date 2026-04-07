/**
 * ConceptMergeDialog -- 4-step concept merge wizard (v2.0 §2.6)
 *
 * Step 1: Select target -- current concept is "被合并方", researcher picks "保留方".
 * Step 2: Conflict resolution -- if same paper mapped to both, list & resolve.
 * Step 3: Keywords merge preview -- union of both keyword sets, allow removal.
 * Step 4: Confirm -- operation summary, execute merge.
 */

import React, { useReducer, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Merge, AlertTriangle, Search, Check, ChevronRight, ChevronLeft } from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import { useConceptList } from '../../../core/ipc/hooks/useConcepts';
import type {
  Concept,
  ConceptMapping,
  MergeConflictResolution,
} from '../../../../shared-types/models';
import type { Maturity } from '../../../../shared-types/enums';

// ── Props ──

interface ConceptMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The concept being merged away (被合并方). */
  sourceConceptId: string;
}

// ── Reducer ──

type Step = 1 | 2 | 3 | 4;

interface ConflictItem {
  paperId: string;
  paperTitle: string;
  sourceMapping: ConceptMapping;
  targetMapping: ConceptMapping;
}

interface MergeState {
  step: Step;
  /** The concept to retain (保留方). */
  retainId: string;
  searchQuery: string;
  /** Conflicts: same paper mapped to both concepts. */
  conflicts: ConflictItem[];
  /** Resolution per conflict — keyed by paperId. */
  conflictResolutions: Record<string, 'keep_retain' | 'keep_merge' | 'merge_confidence'>;
  /** Union of keywords from both concepts; togglable. */
  mergedKeywords: string[];
  /** Keywords the user has chosen to remove. */
  removedKeywords: Set<string>;
  loading: boolean;
  error: string | null;
}

type MergeAction =
  | { type: 'SET_RETAIN_ID'; id: string }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_CONFLICTS'; conflicts: ConflictItem[] }
  | { type: 'SET_CONFLICT_RESOLUTION'; paperId: string; action: 'keep_retain' | 'keep_merge' | 'merge_confidence' }
  | { type: 'SET_MERGED_KEYWORDS'; keywords: string[] }
  | { type: 'TOGGLE_KEYWORD'; keyword: string }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

const initialState: MergeState = {
  step: 1,
  retainId: '',
  searchQuery: '',
  conflicts: [],
  conflictResolutions: {},
  mergedKeywords: [],
  removedKeywords: new Set(),
  loading: false,
  error: null,
};

function reducer(state: MergeState, action: MergeAction): MergeState {
  switch (action.type) {
    case 'SET_RETAIN_ID':
      return { ...state, retainId: action.id };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query };
    case 'SET_STEP':
      return { ...state, step: action.step, error: null };
    case 'SET_CONFLICTS':
      return {
        ...state,
        conflicts: action.conflicts,
        conflictResolutions: Object.fromEntries(
          action.conflicts.map((c) => [c.paperId, 'keep_retain' as const])
        ),
      };
    case 'SET_CONFLICT_RESOLUTION':
      return {
        ...state,
        conflictResolutions: {
          ...state.conflictResolutions,
          [action.paperId]: action.action,
        },
      };
    case 'SET_MERGED_KEYWORDS':
      return { ...state, mergedKeywords: action.keywords, removedKeywords: new Set() };
    case 'TOGGLE_KEYWORD': {
      const next = new Set(state.removedKeywords);
      if (next.has(action.keyword)) {
        next.delete(action.keyword);
      } else {
        next.add(action.keyword);
      }
      return { ...state, removedKeywords: next };
    }
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Helpers ──

const MATURITY_I18N_KEYS: Record<Maturity, string> = {
  tag: 'analysis.merge.maturityLabels.tag',
  tentative: 'analysis.merge.maturityLabels.tentative',
  working: 'analysis.merge.maturityLabels.working',
  established: 'analysis.merge.maturityLabels.established',
};

const STEP_I18N_KEYS: Record<Step, string> = {
  1: 'analysis.merge.steps.selectTarget',
  2: 'analysis.merge.steps.resolveConflicts',
  3: 'analysis.merge.steps.mergeKeywords',
  4: 'analysis.merge.steps.confirm',
};

// ── Component ──

export function ConceptMergeDialog({
  open,
  onOpenChange,
  sourceConceptId,
}: ConceptMergeDialogProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = React.useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const { data: conceptListData } = useConceptList();
  const concepts: Concept[] = conceptListData ?? [];

  const sourceConcept = useMemo(
    () => concepts.find((c) => c.id === sourceConceptId) ?? null,
    [concepts, sourceConceptId]
  );

  const retainConcept = useMemo(
    () => concepts.find((c) => c.id === state.retainId) ?? null,
    [concepts, state.retainId]
  );

  // Filter concepts for search (exclude source concept).
  const filteredConcepts = useMemo(() => {
    const q = state.searchQuery.toLowerCase().trim();
    return concepts.filter((c) => {
      if (c.id === sourceConceptId) return false;
      if (!q) return true;
      return (
        c.nameZh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.searchKeywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [concepts, sourceConceptId, state.searchQuery]);

  // Compute mapping counts lazily (we show them in comparison cards).
  // We don't fetch mappings eagerly — show concept-level data instead.
  const sourceKeywords = sourceConcept?.searchKeywords ?? [];
  const retainKeywords = retainConcept?.searchKeywords ?? [];

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  // ── Step transitions ──

  const goToStep2 = useCallback(async () => {
    if (!state.retainId || !sourceConceptId) return;
    if (state.retainId === sourceConceptId) {
      dispatch({ type: 'SET_ERROR', error: t('analysis.merge.cannotMergeSelf', { defaultValue: 'Cannot merge a concept with itself.' }) });
      return;
    }
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      // Fetch mappings for both concepts to detect conflicts (same paper).
      const api = getAPI();
      const [sourceMappings, retainMappings] = await Promise.all([
        api.db.mappings.getForConcept(sourceConceptId),
        api.db.mappings.getForConcept(state.retainId),
      ]);

      // Build lookup: paperId -> mapping for retain side.
      const retainByPaper = new Map<string, ConceptMapping>();
      for (const m of retainMappings) {
        retainByPaper.set(m.paperId, m);
      }

      // Detect conflicts.
      const conflicts: ConflictItem[] = [];
      for (const sm of sourceMappings) {
        const rm = retainByPaper.get(sm.paperId);
        if (rm) {
          conflicts.push({
            paperId: sm.paperId,
            paperTitle: '',
            sourceMapping: sm,
            targetMapping: rm,
          });
        }
      }

      // Try to resolve paper titles.
      if (conflicts.length > 0) {
        try {
          const paperIds = conflicts.map((c) => c.paperId);
          const papers = await Promise.all(
            paperIds.map((pid) => api.db.papers.get(pid).catch(() => null))
          );
          const titleMap = new Map<string, string>();
          for (const p of papers) {
            if (p) titleMap.set(p.id, p.title);
          }
          for (const [index, c] of conflicts.entries()) {
            c.paperTitle = titleMap.get(c.paperId) ?? `论文 ${index + 1}`;
          }
        } catch {
          // Paper title resolution is best-effort.
        }
      }

      dispatch({ type: 'SET_CONFLICTS', conflicts });

      if (conflicts.length > 0) {
        dispatch({ type: 'SET_STEP', step: 2 });
      } else {
        // Skip step 2, go to keywords merge.
        goToStep3FromConflicts(conflicts);
      }
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (mountedRef.current) dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.retainId, sourceConceptId]);

  const goToStep3FromConflicts = useCallback(
    (_conflicts?: ConflictItem[]) => {
      // Compute union of keywords.
      const union = Array.from(new Set([...sourceKeywords, ...retainKeywords]));
      dispatch({ type: 'SET_MERGED_KEYWORDS', keywords: union });
      dispatch({ type: 'SET_STEP', step: 3 });
    },
    [sourceKeywords, retainKeywords]
  );

  const goToStep3 = useCallback(() => {
    goToStep3FromConflicts();
  }, [goToStep3FromConflicts]);

  const goToStep4 = useCallback(() => {
    dispatch({ type: 'SET_STEP', step: 4 });
  }, []);

  // ── Execute merge ──

  const executeMerge = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const conflictResolutions: MergeConflictResolution[] = state.conflicts.map(
        (c) => ({
          mappingId: c.sourceMapping.id,
          action: state.conflictResolutions[c.paperId] ?? 'keep_retain',
        })
      );

      await getAPI().db.concepts.merge(state.retainId, sourceConceptId, conflictResolutions);
      handleOpenChange(false);
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state, sourceConceptId, handleOpenChange]);

  // ── Derived values for summary ──

  const finalKeywords = useMemo(
    () => state.mergedKeywords.filter((k) => !state.removedKeywords.has(k)),
    [state.mergedKeywords, state.removedKeywords]
  );

  if (!sourceConcept) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle}>
          {/* Header */}
          <Dialog.Title style={titleStyle}>
            <Merge size={16} />
            {t('analysis.merge.title')}
          </Dialog.Title>

          {/* Step indicator */}
          <div style={stepIndicatorStyle}>
            {([1, 2, 3, 4] as Step[]).map((s) => (
              <div
                key={s}
                style={{
                  ...stepDotContainerStyle,
                  opacity: s === 2 && state.conflicts.length === 0 ? 0.35 : 1,
                }}
              >
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
                <span style={stepLabelStyle}>{t(STEP_I18N_KEYS[s])}</span>
              </div>
            ))}
          </div>

          {/* Error banner */}
          {state.error && (
            <div style={errorBannerStyle}>
              <AlertTriangle size={14} /> {state.error}
            </div>
          )}

          {/* ── Step 1: Select target ── */}
          {state.step === 1 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>
                {t('analysis.merge.source')}: <strong>{sourceConcept.nameEn}</strong>
              </p>

              {/* Search input */}
              <div style={searchContainerStyle}>
                <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder={t('analysis.merge.searchPlaceholder')}
                  value={state.searchQuery}
                  onChange={(e) =>
                    dispatch({ type: 'SET_SEARCH_QUERY', query: e.target.value })
                  }
                  style={searchInputStyle}
                />
              </div>

              {/* Concept list */}
              <div style={conceptListStyle}>
                {filteredConcepts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    style={{
                      ...conceptOptionStyle,
                      borderColor:
                        state.retainId === c.id
                          ? 'var(--accent-color)'
                          : 'var(--border-subtle)',
                      backgroundColor:
                        state.retainId === c.id
                          ? 'rgba(var(--accent-color-rgb, 59,130,246), 0.08)'
                          : 'var(--bg-surface-low)',
                    }}
                    onClick={() => dispatch({ type: 'SET_RETAIN_ID', id: c.id })}
                  >
                    <div style={{ fontWeight: 500, fontSize: 'var(--text-sm, 13px)' }}>
                      {c.nameEn}
                    </div>
                    <div style={conceptOptionMetaStyle}>
                      {t(MATURITY_I18N_KEYS[c.maturity])} · {t('analysis.merge.keywordCount', { count: c.searchKeywords.length })}
                    </div>
                  </button>
                ))}
                {filteredConcepts.length === 0 && (
                  <div style={emptyHintStyle}>{t('analysis.merge.noMatch')}</div>
                )}
              </div>

              {/* Comparison cards */}
              {retainConcept && (
                <div style={comparisonContainerStyle}>
                  <ComparisonCard label={t('analysis.merge.source')} concept={sourceConcept} variant="danger" formatMaturity={(m) => t(MATURITY_I18N_KEYS[m])} t={t} />
                  <div style={arrowStyle}>
                    <ChevronRight size={20} />
                  </div>
                  <ComparisonCard label={t('analysis.merge.target')} concept={retainConcept} variant="accent" formatMaturity={(m) => t(MATURITY_I18N_KEYS[m])} t={t} />
                </div>
              )}

              <div style={buttonRowStyle}>
                <Dialog.Close asChild>
                  <button type="button" style={secondaryButtonStyle}>
                    {t('common.cancel')}
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={!state.retainId || state.loading}
                  onClick={goToStep2}
                >
                  {state.loading ? t('analysis.merge.checkingConflicts') : t('common.next')}
                  {!state.loading && <ChevronRight size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Conflict resolution ── */}
          {state.step === 2 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>
                {t('analysis.merge.conflictInstruction')}
              </p>

              <div style={conflictListStyle}>
                {state.conflicts.map((conflict) => (
                  <div key={conflict.paperId} style={conflictCardStyle}>
                    <div style={conflictTitleStyle}>{conflict.paperTitle}</div>
                    <div style={conflictComparisonStyle}>
                      <div style={conflictSideStyle}>
                        <span style={conflictSideLabelStyle}>{t('analysis.merge.sourceMapping')}</span>
                        <span style={conflictDetailStyle}>
                          {conflict.sourceMapping.relationType} · {t('analysis.review.confidence', { value: conflict.sourceMapping.confidence.toFixed(2) })}
                        </span>
                      </div>
                      <div style={conflictSideStyle}>
                        <span style={conflictSideLabelStyle}>{t('analysis.merge.targetMapping')}</span>
                        <span style={conflictDetailStyle}>
                          {conflict.targetMapping.relationType} · {t('analysis.review.confidence', { value: conflict.targetMapping.confidence.toFixed(2) })}
                        </span>
                      </div>
                    </div>
                    <div style={conflictActionsStyle}>
                      {(
                        [
                          ['keep_retain', t('analysis.merge.target')],
                          ['keep_merge', t('analysis.merge.source')],
                          ['merge_confidence', t('analysis.merge.mergeConfidence')],
                        ] as Array<['keep_retain' | 'keep_merge' | 'merge_confidence', string]>
                      ).map(([action, label]) => (
                        <button
                          key={action}
                          type="button"
                          style={
                            state.conflictResolutions[conflict.paperId] === action
                              ? chipActiveStyle
                              : chipStyle
                          }
                          onClick={() =>
                            dispatch({
                              type: 'SET_CONFLICT_RESOLUTION',
                              paperId: conflict.paperId,
                              action,
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => dispatch({ type: 'SET_STEP', step: 1 })}
                >
                  <ChevronLeft size={14} /> {t('common.back')}
                </button>
                <button type="button" style={primaryButtonStyle} onClick={goToStep3}>
                  {t('common.next')} <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Keywords merge preview ── */}
          {state.step === 3 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>
                {t('analysis.merge.keywordInstruction')}
              </p>

              <div style={keywordsContainerStyle}>
                {state.mergedKeywords.map((kw) => {
                  const removed = state.removedKeywords.has(kw);
                  return (
                    <button
                      key={kw}
                      type="button"
                      style={{
                        ...keywordChipStyle,
                        opacity: removed ? 0.4 : 1,
                        textDecoration: removed ? 'line-through' : 'none',
                        borderColor: removed
                          ? 'var(--border-subtle)'
                          : 'var(--accent-color)',
                        backgroundColor: removed
                          ? 'transparent'
                          : 'rgba(var(--accent-color-rgb, 59,130,246), 0.08)',
                      }}
                      onClick={() =>
                        dispatch({ type: 'TOGGLE_KEYWORD', keyword: kw })
                      }
                    >
                      {kw}
                      {!removed && <X size={10} style={{ marginLeft: 4 }} />}
                    </button>
                  );
                })}
                {state.mergedKeywords.length === 0 && (
                  <div style={emptyHintStyle}>{t('analysis.merge.noKeywords')}</div>
                )}
              </div>

              <div style={mergeStatStyle}>
                {t('analysis.merge.keywordKeepCount', { kept: finalKeywords.length, total: state.mergedKeywords.length })}
              </div>

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() =>
                    dispatch({
                      type: 'SET_STEP',
                      step: state.conflicts.length > 0 ? 2 : 1,
                    })
                  }
                >
                  <ChevronLeft size={14} /> {t('common.back')}
                </button>
                <button type="button" style={primaryButtonStyle} onClick={goToStep4}>
                  {t('common.next')} <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Confirm ── */}
          {state.step === 4 && (
            <div style={stepBodyStyle}>
              <p style={descriptionStyle}>{t('analysis.merge.confirmInstruction')}</p>

              <div style={summaryContainerStyle}>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>{t('analysis.merge.sourceWillDelete')}</span>
                  <span style={summaryValueDangerStyle}>{sourceConcept.nameEn}</span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>{t('analysis.merge.target')}</span>
                  <span style={summaryValueStyle}>{retainConcept?.nameEn ?? '—'}</span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>{t('analysis.merge.conflictMappings')}</span>
                  <span style={summaryValueStyle}>
                    {state.conflicts.length > 0
                      ? t('analysis.merge.conflictsResolved', { count: state.conflicts.length })
                      : t('analysis.merge.noConflicts')}
                  </span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>{t('analysis.merge.mergedKeywords')}</span>
                  <span style={summaryValueStyle}>{t('analysis.merge.keywordCount', { count: finalKeywords.length })}</span>
                </div>
              </div>

              <div style={warningBannerStyle}>
                <AlertTriangle size={14} />
                {t('analysis.merge.irreversible')}
              </div>

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => dispatch({ type: 'SET_STEP', step: 3 })}
                >
                  <ChevronLeft size={14} /> {t('common.back')}
                </button>
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={state.loading}
                  onClick={executeMerge}
                >
                  {state.loading ? t('analysis.merge.merging') : t('analysis.merge.confirmMerge')}
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

function ComparisonCard({
  label,
  concept,
  variant,
  formatMaturity,
  t,
}: {
  label: string;
  concept: Concept;
  variant: 'accent' | 'danger';
  formatMaturity: (m: Maturity) => string;
  t: (key: string) => string;
}) {
  const borderColor =
    variant === 'accent' ? 'var(--accent-color)' : 'var(--danger, #e53e3e)';

  return (
    <div style={{ ...comparisonCardStyle, borderColor }}>
      <div style={comparisonCardLabelStyle}>{label}</div>
      <div style={comparisonCardNameStyle}>{concept.nameEn}</div>
      <div style={comparisonCardRowStyle}>
        <span style={comparisonCardFieldStyle}>{t('analysis.concepts.definition')}</span>
        <span style={comparisonCardValueStyle}>
          {concept.definition.slice(0, 60)}
          {concept.definition.length > 60 ? '...' : ''}
        </span>
      </div>
      <div style={comparisonCardRowStyle}>
        <span style={comparisonCardFieldStyle}>{t('analysis.concepts.keywords')}</span>
        <span style={comparisonCardValueStyle}>
          {concept.searchKeywords.length > 0 ? concept.searchKeywords.join(', ') : '—'}
        </span>
      </div>
      <div style={comparisonCardRowStyle}>
        <span style={comparisonCardFieldStyle}>{t('analysis.concepts.maturity')}</span>
        <span style={comparisonCardValueStyle}>{formatMaturity(concept.maturity)}</span>
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
  width: 640,
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
  gap: 24,
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

const searchContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm, 13px)',
};

const conceptListStyle: React.CSSProperties = {
  maxHeight: 180,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const conceptOptionStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface-low)',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'border-color 0.15s',
};

const conceptOptionMetaStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  marginTop: 2,
};

const emptyHintStyle: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm, 13px)',
};

// Comparison cards
const comparisonContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 8,
};

const arrowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  color: 'var(--text-muted)',
  flexShrink: 0,
};

const comparisonCardStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 12px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface-low)',
};

const comparisonCardLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const comparisonCardNameStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 8,
};

const comparisonCardRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 3,
  fontSize: 'var(--text-xs, 11px)',
};

const comparisonCardFieldStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  flexShrink: 0,
  width: 42,
};

const comparisonCardValueStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// Conflict styles
const conflictListStyle: React.CSSProperties = {
  maxHeight: 300,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const conflictCardStyle: React.CSSProperties = {
  padding: '10px 12px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
};

const conflictTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  fontWeight: 500,
  color: 'var(--text-primary)',
  marginBottom: 8,
};

const conflictComparisonStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginBottom: 8,
};

const conflictSideStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const conflictSideLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const conflictDetailStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-secondary)',
};

const conflictActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

// Keywords
const keywordsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  maxHeight: 200,
  overflowY: 'auto',
  padding: '8px 0',
};

const keywordChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  border: '1px solid var(--accent-color)',
  borderRadius: 12,
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs, 11px)',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};

const mergeStatStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-muted)',
  textAlign: 'right',
};

// Summary
const summaryContainerStyle: React.CSSProperties = {
  padding: '12px 14px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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

// Chips
const chipStyle: React.CSSProperties = {
  padding: '2px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
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
