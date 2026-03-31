/**
 * AdjudicationControls — Accept/Revise/Reject 三按钮（§7.2）
 *
 * Accept: 乐观更新 → Mutation
 * Reject: 确认弹窗 → 乐观更新 → Mutation
 * Revise: 展开编辑模式 → 保存修订
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Edit2 } from 'lucide-react';
import { useAdjudicateMapping } from '../../../core/ipc/hooks/useMappings';
import type { ConceptMapping } from '../../../../shared-types/models';

const confirmRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)' };
const confirmTextStyle: React.CSSProperties = { color: 'var(--text-secondary)' };
const dangerBtnStyle: React.CSSProperties = {
  padding: '2px 8px', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--danger)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '2px 8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const reviseColumnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const reviseLabelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' };
const rangeStyle: React.CSSProperties = { width: '100%', marginTop: 4 };
const floatRightStyle: React.CSSProperties = { float: 'right' };
const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '4px 8px',
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
};
const reviseActionsStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const saveBtnStyle: React.CSSProperties = {
  padding: '4px 12px', border: 'none', borderRadius: 'var(--radius-sm)',
  backgroundColor: 'var(--accent-color)', color: 'white', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const reviseCancelBtnStyle: React.CSSProperties = {
  padding: '4px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const defaultRowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
const acceptBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '4px 0', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--success)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const reviseBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '4px 0', border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--accent-color)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};
const rejectBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '4px 0', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)',
  background: 'none', color: 'var(--danger)', fontSize: 'var(--text-xs)', cursor: 'pointer',
};

interface AdjudicationControlsProps {
  mapping: ConceptMapping;
  paperId: string;
  adjudicated: boolean;
}

export const AdjudicationControls = React.memo(function AdjudicationControls({
  mapping, paperId, adjudicated,
}: AdjudicationControlsProps) {
  const { t } = useTranslation();
  const [confirmReject, setConfirmReject] = useState(false);
  const [reviseMode, setReviseMode] = useState(false);
  const [reviseConfidence, setReviseConfidence] = useState(mapping.confidence);
  const [reviseNote, setReviseNote] = useState('');
  const adjudicateMutation = useAdjudicateMapping();

  const handleAccept = useCallback(() => {
    adjudicateMutation.mutate({ mappingId: mapping.id, decision: 'accept', paperId });
  }, [adjudicateMutation, mapping.id, paperId]);

  const handleReject = useCallback(() => {
    if (!confirmReject) { setConfirmReject(true); return; }
    adjudicateMutation.mutate({ mappingId: mapping.id, decision: 'reject', paperId });
    setConfirmReject(false);
  }, [confirmReject, adjudicateMutation, mapping.id, paperId]);

  const handleRevise = useCallback(() => {
    adjudicateMutation.mutate({
      mappingId: mapping.id, decision: 'revise', paperId,
      revisedMapping: { confidence: reviseConfidence },
    });
    setReviseMode(false);
    setReviseNote('');
  }, [adjudicateMutation, mapping.id, paperId, reviseConfidence]);

  if (adjudicated) {
    const statusLabel = (() => {
      switch (mapping.adjudicationStatus) {
        case 'accepted': return { text: `✓ ${t('context.adjudication.accepted')}`, color: 'var(--success)' };
        case 'rejected': return { text: `✗ ${t('context.adjudication.rejected')}`, color: 'var(--danger)' };
        case 'revised': return { text: `✏ ${t('context.adjudication.revised')}`, color: 'var(--accent-color)' };
        default: return { text: `⏳ ${t('context.adjudication.pending')}`, color: 'var(--text-muted)' };
      }
    })();
    return (
      <div style={{ fontSize: 'var(--text-xs)', color: statusLabel.color }}>
        {t('context.adjudication.currentStatus')}: {statusLabel.text}
      </div>
    );
  }

  if (confirmReject) {
    return (
      <div style={confirmRowStyle}>
        <span style={confirmTextStyle}>{t('context.adjudication.confirmReject')}</span>
        <button onClick={handleReject} style={dangerBtnStyle}>{t('common.confirm')}</button>
        <button onClick={() => setConfirmReject(false)} style={cancelBtnStyle}>{t('common.cancel')}</button>
      </div>
    );
  }

  if (reviseMode) {
    return (
      <div style={reviseColumnStyle}>
        <div style={reviseLabelStyle}>
          {t('context.adjudication.confidence')}:
          <input type="range" min={0} max={1} step={0.01} value={reviseConfidence}
            onChange={(e) => setReviseConfidence(parseFloat(e.target.value))} style={rangeStyle} />
          <span style={floatRightStyle}>{reviseConfidence.toFixed(2)}</span>
        </div>
        <div style={reviseLabelStyle}>
          {t('context.adjudication.reviseReason')}:
          <input type="text" value={reviseNote} onChange={(e) => setReviseNote(e.target.value)}
            placeholder={t('context.adjudication.revisePlaceholder')} style={inputStyle} />
        </div>
        <div style={reviseActionsStyle}>
          <button onClick={handleRevise} style={saveBtnStyle}>{t('context.adjudication.saveRevision')}</button>
          <button onClick={() => setReviseMode(false)} style={reviseCancelBtnStyle}>{t('common.cancel')}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={defaultRowStyle}>
      <button onClick={handleAccept} disabled={adjudicateMutation.isPending} style={acceptBtnStyle}>
        <Check size={12} /> Accept
      </button>
      <button onClick={() => setReviseMode(true)} disabled={adjudicateMutation.isPending} style={reviseBtnStyle}>
        <Edit2 size={12} /> Revise
      </button>
      <button onClick={handleReject} disabled={adjudicateMutation.isPending} style={rejectBtnStyle}>
        <X size={12} /> Reject
      </button>
    </div>
  );
});
