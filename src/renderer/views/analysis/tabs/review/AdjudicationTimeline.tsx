/**
 * AdjudicationTimeline -- Visual timeline of adjudication actions for a
 * paper's mappings, with real timestamps from concept history.
 */

import React, { useMemo } from 'react';
import type { ConceptMapping } from '../../../../../shared-types/models';
import type { AdjudicationStatus, RelationType } from '../../../../../shared-types/enums';
import { RELATION_LABELS_ZH } from '../../shared/relationTheme';

interface AdjudicationTimelineProps {
  mappings: ConceptMapping[];
  /** Optional concept timeline entries with timestamps */
  timelineEntries?: Array<{
    conceptId: string;
    timestamp: string;
    changeType: string;
  }>;
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

function formatTimestamp(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

export function AdjudicationTimeline({
  mappings,
  timelineEntries,
}: AdjudicationTimelineProps) {
  // Build a lookup from conceptId to most recent adjudication timestamp
  const timestampMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!timelineEntries) return map;

    // Sort entries by timestamp descending, so first match is most recent
    const sorted = [...timelineEntries].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );

    for (const entry of sorted) {
      // Match adjudication-related change types
      if (
        entry.changeType === 'adjudication' ||
        entry.changeType === 'mapping_reviewed' ||
        entry.changeType === 'mapping_accepted' ||
        entry.changeType === 'mapping_rejected' ||
        entry.changeType === 'mapping_revised'
      ) {
        if (!map.has(entry.conceptId)) {
          map.set(entry.conceptId, entry.timestamp);
        }
      }
    }

    return map;
  }, [timelineEntries]);

  const adjudicatedMappings = useMemo(
    () =>
      mappings
        .filter((m) => m.adjudicationStatus !== 'pending')
        .sort((a, b) => {
          // Primary sort: by timestamp (if available), most recent first
          const tsA = timestampMap.get(a.conceptId) ?? '';
          const tsB = timestampMap.get(b.conceptId) ?? '';
          if (tsA && tsB) {
            const cmp = tsB.localeCompare(tsA);
            if (cmp !== 0) return cmp;
          }
          // Fallback: by status priority
          return (
            STATUS_SORT_ORDER[a.adjudicationStatus] -
            STATUS_SORT_ORDER[b.adjudicationStatus]
          );
        }),
    [mappings, timestampMap],
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
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs)',
          }}
        >
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
          const timestamp = timestampMap.get(mapping.conceptId);

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
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span
                    style={{
                      color: status.color,
                      fontWeight: 600,
                      minWidth: 70,
                    }}
                  >
                    {status.icon} {status.label}
                  </span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {mapping.conceptId}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    ({RELATION_LABELS_ZH[mapping.relationType] ?? mapping.relationType})
                  </span>
                </div>
                {timestamp && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      marginLeft: 78,
                    }}
                  >
                    {formatTimestamp(timestamp)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
