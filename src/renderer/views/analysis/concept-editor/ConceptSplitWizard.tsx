/**
 * ConceptSplitWizard -- two-step concept split flow (v1.2)
 *
 * Step 1: Define new concepts (name + description for each).
 * Step 2: Assign existing mappings from the original concept to the new concepts.
 */

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Scissors, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import type {
  Concept,
  ConceptMapping,
  NewConceptDef,
  MappingAssignment,
} from '../../../../shared-types/models';

interface ConceptSplitWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concept: Concept | null;
}

type Step = 'define' | 'assign';

interface DraftConcept {
  tempId: string;
  name: string;
  description: string;
}

export function ConceptSplitWizard({
  open,
  onOpenChange,
  concept,
}: ConceptSplitWizardProps) {
  const [step, setStep] = useState<Step>('define');
  const [drafts, setDrafts] = useState<DraftConcept[]>([
    { tempId: 'draft-1', name: '', description: '' },
    { tempId: 'draft-2', name: '', description: '' },
  ]);
  const [mappings, setMappings] = useState<ConceptMapping[]>([]);
  const [assignments, setAssignments] = useState<Map<string, string>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('define');
    setDrafts([
      { tempId: 'draft-1', name: '', description: '' },
      { tempId: 'draft-2', name: '', description: '' },
    ]);
    setMappings([]);
    setAssignments(new Map());
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

  const addDraft = useCallback(() => {
    setDrafts((prev) => [
      ...prev,
      {
        tempId: `draft-${Date.now()}`,
        name: '',
        description: '',
      },
    ]);
  }, []);

  const removeDraft = useCallback((tempId: string) => {
    setDrafts((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((d) => d.tempId !== tempId);
    });
  }, []);

  const updateDraft = useCallback(
    (tempId: string, field: 'name' | 'description', value: string) => {
      setDrafts((prev) =>
        prev.map((d) => (d.tempId === tempId ? { ...d, [field]: value } : d))
      );
    },
    []
  );

  const allDraftsValid = drafts.every(
    (d) => d.name.trim().length > 0 && d.description.trim().length > 0
  );

  const handleSplit = useCallback(async () => {
    if (!concept) return;
    setLoading(true);
    setError(null);
    try {
      const newConcepts: NewConceptDef[] = drafts.map((d) => ({
        name: d.name.trim(),
        description: d.description.trim(),
      }));
      const result = await getAPI().db.concepts.split(concept.id, newConcepts);
      if (result.mappings.length > 0) {
        setMappings(result.mappings);
        const initial = new Map<string, string>();
        const firstDraftId = drafts[0]?.tempId ?? '';
        for (const m of result.mappings) {
          initial.set(m.id, firstDraftId);
        }
        setAssignments(initial);
        setStep('assign');
      } else {
        handleOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [concept, drafts, handleOpenChange]);

  const handleReassign = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const assignmentList: MappingAssignment[] = [];
      for (const [mappingId, targetTempId] of assignments) {
        const draftIndex = drafts.findIndex((d) => d.tempId === targetTempId);
        // The backend should return real IDs after split; here we use index-based placeholder
        const targetConceptId = `new-concept-${draftIndex}`;
        assignmentList.push({ mappingId, targetConceptId });
      }
      await getAPI().db.concepts.reassignMappings(assignmentList);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [assignments, drafts, handleOpenChange]);

  if (!concept) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle}>
          <Dialog.Title style={titleStyle}>
            <Scissors size={16} />
            {step === 'define'
              ? `拆分概念: ${concept.name}`
              : '分配映射到新概念'}
          </Dialog.Title>

          {error && (
            <div style={errorBannerStyle}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {step === 'define' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={descriptionStyle}>
                将 <strong>{concept.name}</strong>{' '}
                拆分为多个新概念。请为每个新概念定义名称和描述（至少两个）。
              </p>

              <div style={draftListStyle}>
                {drafts.map((draft, idx) => (
                  <div key={draft.tempId} style={draftItemStyle}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 'var(--text-xs, 11px)',
                          color: 'var(--text-muted)',
                          fontWeight: 600,
                        }}
                      >
                        新概念 #{idx + 1}
                      </span>
                      {drafts.length > 2 && (
                        <button
                          type="button"
                          style={iconBtnStyle}
                          onClick={() => removeDraft(draft.tempId)}
                          title="移除"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="概念名称"
                      value={draft.name}
                      onChange={(e) =>
                        updateDraft(draft.tempId, 'name', e.target.value)
                      }
                      style={inputStyle}
                    />
                    <textarea
                      placeholder="概念描述"
                      value={draft.description}
                      onChange={(e) =>
                        updateDraft(draft.tempId, 'description', e.target.value)
                      }
                      style={textareaStyle}
                      rows={2}
                    />
                  </div>
                ))}
              </div>

              <button type="button" style={addButtonStyle} onClick={addDraft}>
                <Plus size={12} /> 添加概念
              </button>

              <div style={buttonRowStyle}>
                <Dialog.Close asChild>
                  <button type="button" style={secondaryButtonStyle}>
                    取消
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={!allDraftsValid || loading}
                  onClick={handleSplit}
                >
                  {loading ? '拆分中...' : '下一步: 分配映射'}
                </button>
              </div>
            </div>
          )}

          {step === 'assign' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={descriptionStyle}>
                将原概念的映射分配到拆分后的新概念:
              </p>

              <div style={assignListStyle}>
                {mappings.map((m) => (
                  <div key={m.id} style={assignItemStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 'var(--text-sm, 13px)',
                          fontWeight: 500,
                        }}
                      >
                        {m.relationType} (conf: {m.confidence.toFixed(2)})
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-xs, 11px)',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.evidenceText.slice(0, 80)}
                        {m.evidenceText.length > 80 ? '...' : ''}
                      </div>
                    </div>
                    <select
                      value={assignments.get(m.id) ?? ''}
                      onChange={(e) => {
                        setAssignments((prev) => {
                          const next = new Map(prev);
                          next.set(m.id, e.target.value);
                          return next;
                        });
                      }}
                      style={assignSelectStyle}
                    >
                      {drafts.map((d) => (
                        <option key={d.tempId} value={d.tempId}>
                          {d.name || '(unnamed)'}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div style={buttonRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setStep('define')}
                >
                  返回
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={loading}
                  onClick={handleReassign}
                >
                  {loading ? '处理中...' : '确认分配'}
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
  width: 560,
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

const draftListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  maxHeight: 320,
  overflowY: 'auto',
};

const draftItemStyle: React.CSSProperties = {
  padding: '10px 12px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm, 13px)',
  marginBottom: 6,
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm, 13px)',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const addButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '6px 12px',
  border: '1px dashed var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'transparent',
  color: 'var(--accent-color)',
  fontSize: 'var(--text-sm, 13px)',
  cursor: 'pointer',
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

const iconBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 2,
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

const assignListStyle: React.CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const assignItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
};

const assignSelectStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-xs, 11px)',
  flexShrink: 0,
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
