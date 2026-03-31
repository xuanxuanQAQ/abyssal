import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lightbulb,
  Zap,
  ChevronDown,
  ChevronRight,
  X,
  GitMerge,
  Split,
  AlertTriangle,
  FileText,
  Bell,
} from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import { useAdvisoryNotifications } from '../../../core/ipc/hooks/useAdvisory';
import type { Recommendation, AdvisoryNotification } from '../../../../shared-types/models';
import type { RecommendationType } from '../../../../shared-types/enums';

function getTypeIcon(type: RecommendationType) {
  switch (type) {
    case 'merge_concepts':
      return <GitMerge size={13} />;
    case 'split_concept':
      return <Split size={13} />;
    case 'review_mapping':
      return <AlertTriangle size={13} />;
    case 'add_paper':
      return <FileText size={13} />;
    case 'fill_evidence_gap':
      return <Lightbulb size={13} />;
    case 'general':
      return <Lightbulb size={13} />;
  }
}

const DISMISSED_STORAGE_KEY = 'abyssal:advisory-dismissed';

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* corrupt data — start fresh */ }
  return new Set();
}

function saveDismissed(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch { /* storage full — silent */ }
}

export function AdvisoryNotifications() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const queryClient = useQueryClient();

  const { data: recommendations } = useQuery({
    queryKey: ['advisory', 'recommendations'],
    queryFn: () => getAPI().advisory.getRecommendations(),
    staleTime: 60_000,
    retry: false,
  });

  const executeMutation = useMutation({
    mutationFn: (id: string) => getAPI().advisory.execute(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['advisory'] });
    },
  });

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      saveDismissed(next);
      return next;
    });
  }, []);

  const { data: notifications } = useAdvisoryNotifications();

  const visibleRecs = recommendations?.filter((r) => !dismissed.has(r.id)) ?? [];
  const visibleNotifs = notifications?.filter((n) => !dismissed.has(n.id)) ?? [];

  if (visibleRecs.length === 0 && visibleNotifs.length === 0) return null;

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {t('context.advisory.title')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visibleRecs.slice(0, 3).map((rec) => (
          <AdvisoryCard
            key={rec.id}
            recommendation={rec}
            onDismiss={dismiss}
            onExecute={(id) => executeMutation.mutate(id)}
            executing={executeMutation.isPending}
          />
        ))}
        {visibleNotifs.slice(0, 3).map((notif) => (
          <NotificationCard key={notif.id} notification={notif} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

function AdvisoryCard({
  recommendation,
  onDismiss,
  onExecute,
  executing,
}: {
  recommendation: Recommendation;
  onDismiss: (id: string) => void;
  onExecute: (id: string) => void;
  executing: boolean;
}) {
  const { t } = useTranslation();
  const [showEvidence, setShowEvidence] = useState(false);

  return (
    <div
      style={{
        padding: '8px 10px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: 1 }}>
          {getTypeIcon(recommendation.type)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            {recommendation.title}
          </div>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {recommendation.description}
          </div>
        </div>
        <button
          onClick={() => onDismiss(recommendation.id)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 2,
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <button
          onClick={() => onExecute(recommendation.id)}
          disabled={executing}
          style={{
            padding: '3px 10px',
            fontSize: 11,
            fontWeight: 600,
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--accent-color)',
            color: 'white',
            cursor: executing ? 'wait' : 'pointer',
            opacity: executing ? 0.6 : 1,
          }}
        >
          <Zap size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
          {recommendation.actionLabel}
        </button>
        {recommendation.evidence.length > 0 && (
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {showEvidence ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {t('context.advisory.evidence')}
          </button>
        )}
      </div>
      {showEvidence && (
        <ul
          style={{
            margin: '6px 0 0',
            paddingLeft: 24,
            color: 'var(--text-muted)',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {recommendation.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** v2.0 Notification card for event-driven advisory notifications */
function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: AdvisoryNotification;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      style={{
        padding: '8px 10px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: 1 }}>
          <Bell size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            {notification.title}
          </div>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {notification.description}
          </div>
        </div>
        <button
          onClick={() => onDismiss(notification.id)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 2,
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
