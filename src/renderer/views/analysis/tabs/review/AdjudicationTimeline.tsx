/**
 * AdjudicationTimeline -- Visual timeline of adjudication actions for a
 * paper's mappings.
 *
 * Shows non-pending mappings grouped by status (accepted, revised, rejected).
 * Since we don't have actual timestamps from the backend yet, entries are
 * ordered by status priority: accepted -> revised -> rejected.
 *
 * TODO: Add actual timestamp data from backend once available.
 */

import React, { useMemo } from 'react';
import type { ConceptMapping } from '../../../../../shared-types/models';
import type { AdjudicationStatus, RelationType } from '../../../../../shared-types/enums';

interface AdjudicationTimelineProps {
  mappings: ConceptMapping[];
}

interface StatusInfo {
  icon: string;
  label: string;
  color: string;
}

const STATUS_MAP: Record<AdjudicationStatus, StatusInfo> = {
  accepted: { icon: '\u2713', label: 'Accepted', color: 'var(--success)' },
  revised: { icon: '\u270F', label: 'Revised', color: 'var(--accent-color)' },
  rejected: { icon: '\u2717', label: 'Rejected', color: 'var(--danger)' },
  pending: { icon: '\u23F3', label: 'Pending', color: 'var(--text-muted)' },
};

const STATUS_SORT_ORDER: Record<AdjudicationStatus, number> = {
  accepted: 0,
  revised: 1,
  rejected: 2,
  pending: 3,
};

function getRelationLabel(type: RelationType): string {
  switch (type) {
    case 'supports':
      return 'supports';
    case 'challenges':
      return 'challenges';
    case 'extends':
      return 'extends';
    default:
      return 'irrelevant';
  }
}

export function AdjudicationTimeline({ mappings }: AdjudicationTimelineProps) {
  const adjudicatedMappings = useMemo(
    () =>
      mappings
        .filter((m) => m.adjudicationStatus !== 'pending')
        .sort(
          (a, b) =>
            STATUS_SORT_ORDER[a.adjudicationStatus] -
            STATUS_SORT_ORDER[b.adjudicationStatus],
        ),
    [mappings],
  );

  if (adjudicatedMappings.length === 0) {
    return (
      <div>
        <h3
          style={{
            margin: '0 0 8px',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Adjudication Timeline
        </h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
          No adjudication actions recorded yet.
        </div>
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
        Adjudication Timeline ({adjudicatedMappings.length})
      </h3>

      <div style={{ position: 'relative', paddingLeft: 20 }}>
        {/* Vertical timeline line */}
        <div
          style={{
            position: 'absolute',
            left: 7,
            top: 4,
            bottom: 4,
            width: 2,
            backgroundColor: 'var(--border-subtle)',
          }}
        />

        {adjudicatedMappings.map((mapping) => {
          const status = STATUS_MAP[mapping.adjudicationStatus];

          return (
            <div
              key={mapping.id}
              style={{
                position: 'relative',
                paddingBottom: 12,
                fontSize: 'var(--text-xs)',
              }}
            >
              {/* Dot on timeline */}
              <div
                style={{
                  position: 'absolute',
                  left: -16,
                  top: 3,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: status.color,
                  border: '2px solid var(--bg-base)',
                }}
              />

              {/* Entry content */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: status.color, fontWeight: 600, minWidth: 70 }}>
                  {status.icon} {status.label}
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {mapping.conceptId}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  ({getRelationLabel(mapping.relationType)})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
