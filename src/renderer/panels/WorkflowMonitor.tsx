/**
 * WorkflowMonitor — real-time workflow progress panel.
 *
 * Shows: currently running workflow (progress bar, current item, ETA),
 * recent completed workflows (last 5), pause/cancel controls.
 *
 * Listens to push:workflow-progress via the on namespace.
 *
 * See spec: section 9.2
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Pause, Play, X, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { getAPI } from '../core/ipc/bridge';

// ─── Types ───

interface WorkflowProgress {
  workflowId: string;
  type: string;
  status: string;
  currentStep: string;
  progress: { current: number; total: number };
  error?: { code: string; message: string };
}

interface CompletedWorkflow {
  id: string;
  type: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  completedAt: string;
  completed: number;
  failed: number;
  total: number;
}

// ─── Component ───

export function WorkflowMonitor() {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowProgress | null>(null);
  const [recentWorkflows, setRecentWorkflows] = useState<CompletedWorkflow[]>([]);

  // Listen for workflow progress events
  useEffect(() => {
    const api = getAPI();
    if (!(api as any).on?.workflowProgress) return;

    const unsubscribe = (api as any).on.workflowProgress((event: unknown) => {
      const e = event as WorkflowProgress;
      if (e.status === 'running') {
        setActiveWorkflow(e);
      } else {
        // Workflow finished — move to recent
        setActiveWorkflow(null);
        setRecentWorkflows((prev) => {
          const entry: CompletedWorkflow = {
            id: e.workflowId,
            type: e.type,
            status: e.status as CompletedWorkflow['status'],
            completedAt: new Date().toISOString(),
            completed: e.progress.current,
            failed: 0,
            total: e.progress.total,
          };
          return [entry, ...prev].slice(0, 5);
        });
      }
    });

    return () => { unsubscribe(); };
  }, []);

  const handleCancel = useCallback(() => {
    if (!activeWorkflow) return;
    getAPI().pipeline.cancel(activeWorkflow.workflowId).catch(() => {});
  }, [activeWorkflow]);

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-surface-low, var(--bg-surface))',
      borderLeft: '1px solid var(--border-subtle)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
      }}>
        <Activity size={16} /> Workflow Monitor
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16, fontSize: 12 }}>
        {/* ── Active workflow ── */}
        {activeWorkflow ? (
          <div style={{
            padding: 12, marginBottom: 16,
            border: '1px solid var(--accent-color)',
            borderRadius: 'var(--radius-md, 6px)',
            background: 'color-mix(in srgb, var(--accent-color) 5%, transparent)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                {activeWorkflow.type}
              </span>
              <button
                onClick={handleCancel}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', fontSize: 11, border: 'none', borderRadius: 4,
                  background: 'rgba(239,68,68,0.15)', color: 'var(--danger, #ef4444)',
                  cursor: 'pointer',
                }}
              >
                <X size={12} /> Cancel
              </button>
            </div>

            {/* Progress bar */}
            <div style={{
              height: 6, borderRadius: 3, marginBottom: 8,
              background: 'var(--bg-surface-high, var(--bg-surface))',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: 'var(--accent-color)',
                width: activeWorkflow.progress.total > 0
                  ? `${(activeWorkflow.progress.current / activeWorkflow.progress.total) * 100}%`
                  : '0%',
                transition: 'width 300ms ease',
              }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span>{activeWorkflow.progress.current} / {activeWorkflow.progress.total}</span>
              <span>{activeWorkflow.currentStep}</span>
            </div>
          </div>
        ) : (
          <div style={{
            padding: 24, textAlign: 'center', color: 'var(--text-muted)',
            marginBottom: 16,
          }}>
            No active workflow
          </div>
        )}

        {/* ── Recent workflows ── */}
        {recentWorkflows.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Recent
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentWorkflows.map((wf) => (
                <div
                  key={wf.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm, 4px)',
                  }}
                >
                  {statusIcon(wf.status)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{wf.type}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {wf.completed}/{wf.total} completed
                      {wf.failed > 0 && `, ${wf.failed} failed`}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatTimeAgo(wf.completedAt)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle size={14} style={{ color: 'var(--success, #22c55e)' }} />;
    case 'partial': return <AlertCircle size={14} style={{ color: 'var(--warning, #f59e0b)' }} />;
    case 'failed': return <XCircle size={14} style={{ color: 'var(--danger, #ef4444)' }} />;
    case 'cancelled': return <X size={14} style={{ color: 'var(--text-muted)' }} />;
    default: return <Activity size={14} />;
  }
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
