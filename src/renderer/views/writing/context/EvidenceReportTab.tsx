/**
 * EvidenceReportTab — Corrective RAG evidence sufficiency report.
 *
 * Shows coverage/relevance/sufficiency progress bars,
 * evidence gap list with suggested actions,
 * and Corrective RAG retry count.
 *
 * See spec: section 4.6
 */

import React from 'react';
import { AlertTriangle, Search, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../../core/store';

// ─── Types ───

interface QualityReport {
  outlineEntryId: string;
  coverage: 'sufficient' | 'partial' | 'insufficient';
  relevance: 'high' | 'moderate' | 'low';
  sufficiency: 'sufficient' | 'partial' | 'insufficient';
  gaps: Array<{ description: string; suggestedAction: string }>;
  retryCount: number;
}

// ─── Props ───

interface EvidenceReportTabProps {
  sectionId: string;
}

// ─── Component ───

export function EvidenceReportTab({ sectionId }: EvidenceReportTabProps) {
  const reports = useAppStore((s) => s.sectionQualityReports) as unknown as Record<string, QualityReport> | undefined;
  const report = reports?.[sectionId];

  if (!report) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No evidence report available for this section.
        <br />
        Run the article workflow to generate one.
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontSize: 12, overflow: 'auto', height: '100%' }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        📊 Evidence Report
      </div>

      {/* Progress bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <MetricBar label="Coverage" value={report.coverage} />
        <MetricBar label="Relevance" value={report.relevance} />
        <MetricBar label="Sufficiency" value={report.sufficiency} />
      </div>

      {/* Evidence gaps */}
      {report.gaps.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Evidence Gaps:
          </div>
          {report.gaps.map((gap, idx) => (
            <div key={idx} style={{
              padding: 8, marginBottom: 6,
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm, 4px)',
              background: 'color-mix(in srgb, var(--warning, #f59e0b) 8%, transparent)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                <AlertTriangle size={12} style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0, marginTop: 1 }} />
                <span style={{ color: 'var(--text-primary)' }}>{gap.description}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 18, color: 'var(--text-muted)', fontSize: 11 }}>
                <Search size={10} /> {gap.suggestedAction}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Retry info */}
      {report.retryCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
          <RefreshCw size={11} />
          Corrective RAG retried {report.retryCount} time(s)
          {report.sufficiency === 'insufficient' && ' — still insufficient'}
        </div>
      )}
    </div>
  );
}

// ─── MetricBar ───

function MetricBar({ label, value }: { label: string; value: string }) {
  const pctMap: Record<string, number> = {
    sufficient: 100, high: 100,
    partial: 60, moderate: 60,
    insufficient: 30, low: 30,
  };
  const colorMap: Record<string, string> = {
    sufficient: 'var(--success, #22c55e)', high: 'var(--success, #22c55e)',
    partial: 'var(--warning, #f59e0b)', moderate: 'var(--warning, #f59e0b)',
    insufficient: 'var(--danger, #ef4444)', low: 'var(--danger, #ef4444)',
  };

  const pct = pctMap[value] ?? 50;
  const color = colorMap[value] ?? 'var(--text-muted)';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color, fontSize: 11 }}>{pct}% ({value})</span>
      </div>
      <div style={{
        height: 6, borderRadius: 3,
        background: 'var(--bg-surface-high, var(--bg-surface))',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: `${pct}%`, background: color,
          transition: 'width 300ms ease',
        }} />
      </div>
    </div>
  );
}
