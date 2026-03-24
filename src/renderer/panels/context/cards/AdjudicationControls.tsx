/**
 * AdjudicationControls — Accept/Revise/Reject 三按钮（§7.2）
 *
 * Accept: 乐观更新 → Mutation
 * Reject: 确认弹窗 → 乐观更新 → Mutation
 * Revise: 展开编辑模式 → 保存修订
 */

import React, { useState, useCallback } from 'react';
import { Check, X, Edit2 } from 'lucide-react';
import { useAdjudicateMapping } from '../../../core/ipc/hooks/useMappings';
import type { ConceptMapping } from '../../../../shared-types/models';

interface AdjudicationControlsProps {
  mapping: ConceptMapping;
  paperId: string;
  adjudicated: boolean;
}

export function AdjudicationControls({
  mapping,
  paperId,
  adjudicated,
}: AdjudicationControlsProps) {
  const [confirmReject, setConfirmReject] = useState(false);
  const [reviseMode, setReviseMode] = useState(false);
  const [reviseConfidence, setReviseConfidence] = useState(mapping.confidence);
  const [reviseNote, setReviseNote] = useState('');
  const adjudicateMutation = useAdjudicateMapping();

  const handleAccept = useCallback(() => {
    adjudicateMutation.mutate({
      mappingId: mapping.id,
      decision: 'accept',
      paperId,
    });
  }, [adjudicateMutation, mapping.id, paperId]);

  const handleReject = useCallback(() => {
    if (!confirmReject) {
      setConfirmReject(true);
      return;
    }
    adjudicateMutation.mutate({
      mappingId: mapping.id,
      decision: 'reject',
      paperId,
    });
    setConfirmReject(false);
  }, [confirmReject, adjudicateMutation, mapping.id, paperId]);

  const handleRevise = useCallback(() => {
    adjudicateMutation.mutate({
      mappingId: mapping.id,
      decision: 'revise',
      paperId,
      revisedMapping: {
        confidence: reviseConfidence,
      },
    });
    setReviseMode(false);
    setReviseNote('');
  }, [adjudicateMutation, mapping.id, paperId, reviseConfidence]);

  // 已裁决状态
  if (adjudicated) {
    const statusLabel = (() => {
      switch (mapping.adjudicationStatus) {
        case 'accepted':
          return { text: '✓ 已接受', color: 'var(--success)' };
        case 'rejected':
          return { text: '✗ 已拒绝', color: 'var(--danger)' };
        case 'revised':
          return { text: '✏ 已修订', color: 'var(--accent-color)' };
        default:
          return { text: '⏳ 待裁决', color: 'var(--text-muted)' };
      }
    })();

    return (
      <div style={{ fontSize: 'var(--text-xs)', color: statusLabel.color }}>
        当前状态: {statusLabel.text}
      </div>
    );
  }

  // 确认拒绝弹层
  if (confirmReject) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>确认拒绝此映射？</span>
        <button
          onClick={handleReject}
          style={{
            padding: '2px 8px',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: 'var(--danger)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
          }}
        >
          确认
        </button>
        <button
          onClick={() => setConfirmReject(false)}
          style={{
            padding: '2px 8px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
          }}
        >
          取消
        </button>
      </div>
    );
  }

  // 修订编辑模式
  if (reviseMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          置信度:
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={reviseConfidence}
            onChange={(e) => setReviseConfidence(parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: 4 }}
          />
          <span style={{ float: 'right' }}>{reviseConfidence.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          修订理由:
          <input
            type="text"
            value={reviseNote}
            onChange={(e) => setReviseNote(e.target.value)}
            placeholder="简要说明修订原因…"
            style={{
              width: '100%',
              marginTop: 4,
              padding: '4px 8px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-base)',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-xs)',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRevise}
            style={{
              padding: '4px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--accent-color)',
              color: 'white',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
            }}
          >
            保存修订
          </button>
          <button
            onClick={() => setReviseMode(false)}
            style={{
              padding: '4px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              background: 'none',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // 默认三按钮
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        onClick={handleAccept}
        disabled={adjudicateMutation.isPending}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '4px 0',
          border: '1px solid var(--success)',
          borderRadius: 'var(--radius-sm)',
          background: 'none',
          color: 'var(--success)',
          fontSize: 'var(--text-xs)',
          cursor: 'pointer',
        }}
      >
        <Check size={12} /> Accept
      </button>
      <button
        onClick={() => setReviseMode(true)}
        disabled={adjudicateMutation.isPending}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '4px 0',
          border: '1px solid var(--accent-color)',
          borderRadius: 'var(--radius-sm)',
          background: 'none',
          color: 'var(--accent-color)',
          fontSize: 'var(--text-xs)',
          cursor: 'pointer',
        }}
      >
        <Edit2 size={12} /> Revise
      </button>
      <button
        onClick={handleReject}
        disabled={adjudicateMutation.isPending}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '4px 0',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          background: 'none',
          color: 'var(--danger)',
          fontSize: 'var(--text-xs)',
          cursor: 'pointer',
        }}
      >
        <X size={12} /> Reject
      </button>
    </div>
  );
}
