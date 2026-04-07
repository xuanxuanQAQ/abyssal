/**
 * ConceptDetail — 概念详情面板（§2.2）
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge, Scissors, FileText, StickyNote, Activity, Sparkles, Check, X } from 'lucide-react';
import { useConceptList, useConceptStats, useUpdateMaturity, useMemosForConcept, useNotesForConcept, useConceptImpactPreview, useConceptHealth, useKeywordCandidates, useAcceptKeyword, useRejectKeyword } from '../../../../core/ipc/hooks/useConcepts';
import { useMappingsForConcept } from '../../../../core/ipc/hooks/useMappings';
import { MaturitySelector } from '../../../../shared/MaturitySelector';
import { DefinitionEditor } from './DefinitionEditor';
import { KeywordEditor } from './KeywordEditor';
import { EvolutionTimeline } from './EvolutionTimeline';
import { ConceptMergeDialog } from '../../concept-editor/ConceptMergeDialog';
import { ConceptSplitWizard } from '../../concept-editor/ConceptSplitWizard';
import { useAppStore } from '../../../../core/store';
import { cancelPendingContextReveal, previewContextSource } from '../../../../panels/context/engine/revealContextSource';
import { RELATION_LABELS_EN, RELATION_LABELS_ZH, RELATION_COLORS } from '../../shared/relationTheme';
import type { RelationType } from '../../../../../shared-types/enums';

interface ConceptDetailProps {
  conceptId: string;
}

export function ConceptDetail({ conceptId }: ConceptDetailProps) {
  const { t, i18n } = useTranslation();
  const { data: concepts } = useConceptList();
  const concept = concepts?.find((c) => c.id === conceptId);
  const updateMaturity = useUpdateMaturity();
  const { data: stats } = useConceptStats(conceptId);
  const { data: mappings } = useMappingsForConcept(conceptId);
  const { data: impact } = useConceptImpactPreview(conceptId);
  const { data: health } = useConceptHealth(conceptId);
  const { data: keywordCandidates } = useKeywordCandidates(conceptId);
  const acceptKeyword = useAcceptKeyword();
  const rejectKeyword = useRejectKeyword();

  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const relationLabels = i18n.language.toLowerCase().startsWith('zh') ? RELATION_LABELS_ZH : RELATION_LABELS_EN;

  // Keep hook ordering stable even when the concept list is still loading.
  const { relationDist, mappingCount, reviewedCount, avgConfidence } = useMemo(() => {
    const dist: Record<string, number> = { ...(stats?.relationDistribution ?? {}) };
    let reviewed = stats?.reviewedCount ?? 0;
    let totalConf = 0;
    if (mappings) {
      for (const m of mappings) {
        if (!(m.relationType in dist)) {
          dist[m.relationType] = (dist[m.relationType] ?? 0) + 1;
        }
        if (stats?.reviewedCount == null && (m as any).adjudicationStatus && (m as any).adjudicationStatus !== 'pending') {
          reviewed++;
        }
        totalConf += (m as any).confidence ?? 0;
      }
    }
    return {
      relationDist: dist,
      mappingCount: stats?.mappingCount ?? mappings?.length ?? 0,
      reviewedCount: reviewed,
      avgConfidence: stats?.avgConfidence ?? (mappings && mappings.length > 0 ? totalConf / mappings.length : 0),
    };
  }, [mappings, stats?.avgConfidence, stats?.mappingCount, stats?.relationDistribution, stats?.reviewedCount]);

  if (!concept) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        {t('analysis.concepts.notFound')}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      {/* Title */}
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        {concept.nameZh || concept.nameEn}
      </h2>
      {concept.nameEn && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            marginBottom: 16,
          }}
        >
          {concept.nameEn}
        </div>
      )}

      {/* Maturity selector */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          {t('analysis.concepts.maturity')}
        </label>
        <MaturitySelector
          value={concept.maturity}
          onChange={(m) => updateMaturity.mutate({ conceptId, maturity: m })}
          disabled={updateMaturity.isPending}
        />
      </div>

      {/* Definition */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          {t('analysis.concepts.definition')}
        </label>
        <DefinitionEditor
          conceptId={conceptId}
          initialValue={concept.definition}
        />
      </div>

      {/* Keywords */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          {t('analysis.concepts.keywords')}
        </label>
        <KeywordEditor conceptId={conceptId} keywords={concept.searchKeywords} />
      </div>

      {/* Related paper stats - relation type distribution */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          {t('analysis.concepts.relatedPaperStats')}
        </label>
        {mappingCount > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                marginBottom: 4,
              }}
            >
              {t('analysis.concepts.totalMappings', { count: mappingCount })}
              {' · '}
              {t('analysis.concepts.reviewed', { count: reviewedCount })}
              {avgConfidence > 0 && (
                <>
                  {' · '}
                  {t('analysis.concepts.avgConfidence', {
                    value: (avgConfidence * 100).toFixed(0),
                  })}
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(
                Object.entries(relationDist) as Array<[RelationType, number]>
              ).map(([rel, count]) => (
                <span
                  key={rel}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: RELATION_COLORS[rel] ?? 'var(--text-muted)',
                    }}
                  />
                  {relationLabels[rel] ?? rel} {count}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('analysis.concepts.noMappings')}
          </div>
        )}
      </div>

      {/* Related notes & memos */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          {t('analysis.concepts.relatedNotes')}
        </label>
        <RelatedNotesSection conceptId={conceptId} />
      </div>

      {/* Evolution timeline */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            display: 'block',
            marginBottom: 6,
          }}
        >
          {t('analysis.concepts.evolutionTimeline')}
        </label>
        <EvolutionTimeline history={concept.history} />
      </div>

      {/* Health score */}
      {health && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            <Activity size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
            {t('analysis.concepts.healthScore', { defaultValue: 'Health Score' })}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: 'white',
              backgroundColor: health.overall >= 70 ? 'var(--success, #38a169)' : health.overall >= 40 ? 'var(--warning, #d69e2e)' : 'var(--danger, #e53e3e)',
            }}>
              {health.overall}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {Object.entries(health.dimensions).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ width: 100, color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{key}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'var(--bg-surface)' }}>
                    <div style={{ width: `${value as number}%`, height: '100%', borderRadius: 2, backgroundColor: (value as number) >= 60 ? 'var(--accent-color)' : 'var(--warning, #d69e2e)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {health.suggestions.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {health.suggestions.map((s: string, i: number) => (
                <div key={i}>
                  <Sparkles size={10} style={{ marginRight: 3, verticalAlign: -1 }} />{s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Keyword candidates (Human-in-the-loop) */}
      {Array.isArray(keywordCandidates) && keywordCandidates.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            {t('analysis.concepts.keywordCandidates', { defaultValue: 'Suggested Keywords' })}
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(keywordCandidates as Array<{ id: number; term: string; sourceCount: number; confidence: number }>)
              .filter((c) => (c as any).status === 'pending')
              .slice(0, 5)
              .map((candidate) => (
                <div key={candidate.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 0' }}>
                  <span style={{ flex: 1, color: 'var(--text-secondary)' }}>
                    {candidate.term}
                    <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                      ({candidate.sourceCount} papers, {(candidate.confidence * 100).toFixed(0)}%)
                    </span>
                  </span>
                  <button
                    onClick={() => acceptKeyword.mutate(candidate.id)}
                    style={{ ...miniActionBtnStyle, color: 'var(--success, #38a169)' }}
                    title="Accept"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={() => rejectKeyword.mutate(candidate.id)}
                    style={{ ...miniActionBtnStyle, color: 'var(--danger, #e53e3e)' }}
                    title="Reject"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Impact preview */}
      {impact && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            {t('analysis.concepts.impactPreview', { defaultValue: 'Change Impact' })}
          </label>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('analysis.concepts.papers', { defaultValue: 'Papers' })}</span>
            <span>{impact.affectedPaperCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>{t('analysis.concepts.mappings', { defaultValue: 'Mappings' })}</span>
            <span>{impact.affectedMappingCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>{t('analysis.concepts.annotations', { defaultValue: 'Annotations' })}</span>
            <span>{impact.affectedAnnotationCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>{t('analysis.concepts.sections', { defaultValue: 'Sections' })}</span>
            <span>{impact.affectedSectionCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>{t('analysis.concepts.notes_memos', { defaultValue: 'Notes + Memos' })}</span>
            <span>{impact.affectedNoteCount + impact.affectedMemoCount}</span>
            {impact.requiresRemapping && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>{t('analysis.concepts.remapTime', { defaultValue: 'Remap time' })}</span>
                <span>{impact.estimatedRemapTime}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Merge / Split buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button
          style={actionBtnStyle}
          onClick={() => setMergeOpen(true)}
          aria-label={t('analysis.concepts.merge')}
        >
          <GitMerge size={14} /> {t('analysis.concepts.merge')}
        </button>
        <button
          style={actionBtnStyle}
          onClick={() => setSplitOpen(true)}
          aria-label={t('analysis.concepts.split')}
        >
          <Scissors size={14} /> {t('analysis.concepts.split')}
        </button>
      </div>

      {/* Dialogs */}
      <ConceptMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        sourceConceptId={conceptId}
      />
      <ConceptSplitWizard
        open={splitOpen}
        onOpenChange={setSplitOpen}
        conceptId={conceptId}
      />
    </div>
  );
}

/**
 * Sub-component: displays related memos and notes for a concept.
 * Uses React Query hooks for data fetching (consistent with the rest of the codebase).
 */
function RelatedNotesSection({ conceptId }: { conceptId: string }) {
  const { t } = useTranslation();
  const selectNote = useAppStore((s) => s.selectNote);
  const selectMemo = useAppStore((s) => s.selectMemo);
  const navigateTo = useAppStore((s) => s.navigateTo);

  const { data: rawMemos, isLoading: memosLoading, isError: memosError } = useMemosForConcept(conceptId);
  const { data: rawNotes, isLoading: notesLoading, isError: notesError } = useNotesForConcept(conceptId);

  const memos = useMemo(() =>
    (rawMemos ?? []).map((m: any) => ({
      id: m.id as string,
      content: typeof m.text === 'string' ? m.text.slice(0, 60) : '',
    })),
  [rawMemos]);

  const notes = useMemo(() =>
    (rawNotes ?? []).map((n: any) => ({
      id: (n.id ?? n.noteId) as string,
      title: (n.title ?? t('notes.note.untitled')) as string,
    })),
  [rawNotes, t]);

  if (memosLoading || notesLoading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {t('analysis.concepts.relatedNotesLoading')}
      </div>
    );
  }

  if (memosError || notesError) {
    return (
      <div style={{ fontSize: 12, color: 'var(--danger, #e53e3e)' }}>
        {t('analysis.concepts.relatedNotesLoadError')}
      </div>
    );
  }

  const previewNotes = notes.slice(0, 2);
  const previewMemos = memos.slice(0, 2);
  const hiddenCount = (notes.length - previewNotes.length) + (memos.length - previewMemos.length);

  if (memos.length === 0 && notes.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {t('analysis.concepts.noRelatedNotes')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {notes.length > 0 && (
          <SummaryChip icon={<FileText size={11} />} label={`${notes.length} ${t('notes.tabs.researchNotes')}`} />
        )}
        {memos.length > 0 && (
          <SummaryChip icon={<StickyNote size={11} />} label={`${memos.length} ${t('notes.tabs.memos')}`} />
        )}
        {hiddenCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
            {t('analysis.concepts.moreRelatedItems', { count: hiddenCount })}
          </span>
        )}
      </div>

      {previewNotes.map((note) => (
        <button
          key={note.id}
          type="button"
          onMouseEnter={() => previewContextSource({ type: 'note', noteId: note.id })}
          onMouseLeave={cancelPendingContextReveal}
          onClick={() => {
            selectNote(note.id);
            navigateTo({ type: 'note', noteId: note.id });
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            backgroundColor: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text-secondary)',
            textAlign: 'left',
          }}
        >
          <FileText size={12} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
          {note.title}
        </button>
      ))}
      {previewMemos.map((memo) => (
        <button
          key={memo.id}
          type="button"
          onMouseEnter={() => previewContextSource({ type: 'memo', memoId: memo.id })}
          onMouseLeave={cancelPendingContextReveal}
          onClick={() => {
            selectMemo(memo.id);
            navigateTo({ type: 'memo', memoId: memo.id });
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            backgroundColor: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'left',
          }}
        >
          <StickyNote size={12} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {memo.content}
            {memo.content.length >= 60 ? '...' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

function SummaryChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 999,
      backgroundColor: 'var(--bg-surface-low, var(--bg-surface))',
      color: 'var(--text-secondary)', fontSize: 11,
      border: '1px solid var(--border-subtle)',
    }}>
      {icon}
      {label}
    </span>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 14px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 12,
  cursor: 'pointer',
};

const miniActionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 2,
  borderRadius: 3,
  display: 'flex',
  alignItems: 'center',
};
