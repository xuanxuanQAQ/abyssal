/**
 * MappingReviewList -- Full-width mapping cards with adjudication controls
 * for a specific paper.
 *
 * Unlike the compact ContextPanel MappingCard, this version shows full
 * evidence text (no truncation) since the review tab has more space.
 */

import React from 'react';
import { useMappingsForPaper } from '../../../../core/ipc/hooks/useMappings';
import { useConceptFramework } from '../../../../core/ipc/hooks/useConcepts';
import { AdjudicationControls } from '../../../../panels/context/cards/AdjudicationControls';
import type { ConceptMapping } from '../../../../../shared-types/models';
import type { RelationType } from '../../../../../shared-types/enums';

interface MappingReviewListProps {
  paperId: string;
}

function getRelationIndicator(type: RelationType): { emoji: string; color: string; label: string } {
  switch (type) {
    case 'supports':
      return { emoji: '\uD83D\uDFE2', color: 'var(--success)', label: 'supports' };
    case 'challenges':
      return { emoji: '\uD83D\uDD34', color: 'var(--danger)', label: 'challenges' };
    case 'extends':
      return { emoji: '\uD83D\uDD35', color: 'var(--accent-color)', label: 'extends' };
    default:
      return { emoji: '\u26AA', color: 'var(--text-muted)', label: 'irrelevant' };
  }
}

export function MappingReviewList({ paperId }: MappingReviewListProps) {
  const { data: mappings, isLoading } = useMappingsForPaper(paperId);
  const { data: framework } = useConceptFramework();

  // Build concept name lookup
  const conceptNames = React.useMemo(() => {
    const map = new Map<string, string>();
    if (framework) {
      for (const c of framework.concepts) {
        map.set(c.id, c.name);
      }
    }
    return map;
  }, [framework]);

  if (isLoading) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', padding: '8px 0' }}>
        Loading mappings...
      </div>
    );
  }

  if (!mappings || mappings.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', padding: '8px 0' }}>
        No concept mappings found for this paper.
      </div>
    );
  }

  return (
    <div>
      <h3
        style={{
          margin: '0 0 12px',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        Concept Mappings ({mappings.length})
      </h3>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {mappings.map((mapping, index) => (
          <MappingReviewCard
            key={mapping.id}
            mapping={mapping}
            paperId={paperId}
            conceptName={conceptNames.get(mapping.conceptId)}
            fallbackConceptLabel={`Concept ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Internal card component ──

interface MappingReviewCardProps {
  mapping: ConceptMapping;
  paperId: string;
  conceptName: string | undefined;
  fallbackConceptLabel: string;
}

function MappingReviewCard({ mapping, paperId, conceptName, fallbackConceptLabel }: MappingReviewCardProps) {
  const adjudicated = mapping.adjudicationStatus !== 'pending';
  const relation = getRelationIndicator(mapping.relationType);
  const displayName = conceptName?.trim() || fallbackConceptLabel;

  return (
    <div
      style={{
        padding: '12px 16px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--bg-surface-low)',
        opacity: mapping.adjudicationStatus === 'rejected' ? 0.5 : 1,
      }}
    >
      {/* Concept name */}
      <div
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 6,
        }}
      >
        {displayName}
      </div>

      {/* Relation type + confidence */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}
      >
        <span>
          Relation:{' '}
          <span style={{ color: relation.color }}>
            {relation.emoji} {relation.label}
          </span>
        </span>
        <span>Confidence: {mapping.confidence.toFixed(2)}</span>
      </div>

      {/* Evidence text -- full, not truncated */}
      {mapping.evidenceText && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: 10,
            padding: '8px 12px',
            backgroundColor: 'var(--bg-base)',
            borderRadius: 'var(--radius-sm)',
            borderLeft: '3px solid var(--border-subtle)',
          }}
        >
          <span style={{ fontWeight: 500 }}>Evidence (p.{mapping.evidencePage}):</span>{' '}
          &ldquo;{mapping.evidenceText}&rdquo;
        </div>
      )}

      {/* Adjudication controls */}
      <AdjudicationControls
        mapping={mapping}
        paperId={paperId}
        adjudicated={adjudicated}
      />
    </div>
  );
}
