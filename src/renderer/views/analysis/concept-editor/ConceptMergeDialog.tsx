/**
 * ConceptMergeDialog -- two-step concept merge flow (v1.2)
 *
 * Step 1: Select two concepts -- keep one, merge the other into it.
 * Step 2: Review conflicting mappings and decide keep/discard per mapping.
 */

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Merge, AlertTriangle } from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import type { Concept, ConceptMapping, MergeDecision } from '../../../../shared-types/models';

interface ConceptMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concepts: Concept[];
}

type Step = 'select' | 'resolve';

export function ConceptMergeDialog({
  open,
  onOpenChange,
  concepts,
}: ConceptMergeDialogProps) {
  const [step, setStep] = useState<Step>('select');
  const [keepId, setKeepId] = useState<string>('');
  const [mergeId, setMergeId] = useState<string>('');
  const [conflicts, setConflicts] = useState<ConceptMapping[]>([]);
  const [decisions, setDecisions] = useState<Map<string, 'keep' | 'discard'>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('select');
    setKeepId('');
    setMergeId('');
    setConflicts([]);
    setDecisions(new Map());
    setLoading(false);
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const handleStartMerge = useCallback(async () => {
    if (!keepId || !mergeId || keepId === mergeId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAPI().db.concepts.merge(keepId, mergeId);
      if (result.mappings.length > 0) {
        setConflicts(result.mappings);
        const initial = new Map<string, 'keep' | 'discard'>();
        for (const m of result.mappings) {
          initial.set(m.id, 'keep');
        }
        setDecisions(initial);
        setStep('resolve');
      } else {
        handleOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [keepId, mergeId, handleOpenChange]);

  const handleResolve = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const decisionList: MergeDecision[] = [];
      for (const [mappingId, action] of decisions) {
        decisionList.push({ mappingId, action });
      }
      await getAPI().db.concepts.resolveMergeConflicts(decisionList);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [decisions, handleOpenChange]);

  const setDecision = useCallback(
    (mappingId: string, action: 'keep' | 'discard') => {
      setDecisions((prev) => {
        const next = new Map(prev);
        next.set(mappingId, action);
        return next;
      });
    },
    []
  );

  const keepConcept = concepts.find((c) => c.id === keepId);
  const mergeConcept = concepts.find((c) => c.id === mergeId);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle}>
          <Dialog.Title style={titleStyle}>
            <Merge size={16} />
            {step === 'select' ? '合并概念' : '解决映射冲突'}
          </Dialog.Title>

          {error && (
            <div style={errorBannerStyle}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {step === 'select' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={descriptionStyle}>
                选择要保留的概念和要合并（删除）的概念。合并后，被合并概念的所有映射将转移到保留概念。
              </p>

              <label style={labelStyle}>
                保留概念:
                <select
                  value={keepId}
                  onChange={(e) => setKeepId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">-- 选择 --</option>
                  {concepts.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.id === mergeId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={labelStyle}>
                合并（删除）概念:
                <select
                  value={mergeId}
                  onChange={(e) => setMergeId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">-- 选择 --</option>
                  {concepts.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.id === keepId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              {keepConcept && mergeConcept && (
                <div style={previewStyle}>
                  <strong>{mergeConcept.name}</strong> 将被合并到{' '}
                  <strong>{keepConcept.name}</strong>
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
                  disabled={!keepId || !mergeId || keepId === mergeId || loading}
                  onClick={handleStartMerge}
                >
                  {loading ? '合并中...' : '开始合并'}
                </button>
              </div>
            </div>
          )}

          {step === 'resolve' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={descriptionStyle}>
                以下映射存在冲突，请决定保留或丢弃每条映射:
              </p>

              <div style={conflictListStyle}>
                {conflicts.map((m) => (
                  <div key={m.id} style={conflictItemStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                        {m.conceptId} / {m.paperId}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.evidenceText.slice(0, 100)}
                        {m.evidenceText.length > 100 ? '...' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        type="button"
                        style={
                          decisions.get(m.id) === 'keep'
                            ? chipActiveStyle
                            : chipStyle
                        }
                        onClick={() => setDecision(m.id, 'keep')}
                      >
                        保留
                      </button>
                      <button
                        type="button"
                        style={
                          decisions.get(m.id) === 'discard'
                            ? chipDangerActiveStyle
                            : chipStyle
                        }
                        onClick={() => setDecision(m.id, 'discard')}
                      >
                        丢弃
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setStep('select')}
                >
                  返回
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={loading}
                  onClick={handleResolve}
                >
                  {loading ? '处理中...' : '确认决策'}
                </button>
              </div>
            </div>
          )}

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
  width: 520,
  maxHeight: '80vh',
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
  marginBottom: 16,
  color: 'var(--text-primary)',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm, 13px)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 'var(--text-sm, 13px)',
  color: 'var(--text-secondary)',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm, 13px)',
};

const previewStyle: React.CSSProperties = {
  padding: '8px 12px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--text-sm, 13px)',
  color: 'var(--text-primary)',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  border: 'none',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--accent-color)',
  color: '#fff',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
};

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  backgroundColor: 'var(--danger-bg, rgba(255,0,0,0.1))',
  color: 'var(--danger, #e53e3e)',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--text-sm, 13px)',
  marginBottom: 12,
};

const conflictListStyle: React.CSSProperties = {
  maxHeight: 300,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const conflictItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
};

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

const chipDangerActiveStyle: React.CSSProperties = {
  ...chipStyle,
  borderColor: 'var(--danger, #e53e3e)',
  backgroundColor: 'var(--danger, #e53e3e)',
  color: '#fff',
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
