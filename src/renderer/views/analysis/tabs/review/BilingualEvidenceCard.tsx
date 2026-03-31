/**
 * BilingualEvidenceCard -- displays bilingual evidence (v1.2 → v2.0)
 *
 * v2.0 enhancements (§5.1):
 * - Source location info (sectionTitle + clickable page number)
 * - Single-lang fallback when en === original
 * - Accept / Revise / Reject adjudication buttons
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, X as XIcon } from 'lucide-react';
import type { BilingualEvidence } from '../../../../../shared-types/models';
import type { RelationType, AdjudicationDecision } from '../../../../../shared-types/enums';

interface BilingualEvidenceCardProps {
  evidence: BilingualEvidence | undefined;
  fallbackText: string;
  /** v2.0 chunk 来源信息 */
  sectionTitle?: string;
  page?: number;
  /** v2.0 裁决回调 */
  onAdjudicate?: (decision: AdjudicationDecision, revised?: { relation: RelationType; confidence: number; reason: string }) => void;
  /** 点击页码跳转 Reader */
  onPageClick?: (page: number) => void;
}

function getLangLabel(langCode: string): string {
  const langMap: Record<string, string> = {
    zh: '中文', 'zh-CN': '中文', 'zh-TW': '繁體中文',
    en: 'English', ja: '日本語', ko: '한국어',
    de: 'Deutsch', fr: 'Français', es: 'Español',
    pt: 'Português', ru: 'Русский',
  };
  return langMap[langCode] ?? langCode;
}

export function BilingualEvidenceCard({
  evidence,
  fallbackText,
  sectionTitle,
  page,
  onAdjudicate,
  onPageClick,
}: BilingualEvidenceCardProps) {
  const { t } = useTranslation();
  const [reviseMode, setReviseMode] = useState(false);
  const [reviseRelation, setReviseRelation] = useState<RelationType>('supports');
  const [reviseConfidence, setReviseConfidence] = useState(0.5);
  const [reviseReason, setReviseReason] = useState('');

  const isSameLanguage = evidence && evidence.en === evidence.original;

  const handleReviseSubmit = () => {
    onAdjudicate?.('revise', { relation: reviseRelation, confidence: reviseConfidence, reason: reviseReason });
    setReviseMode(false);
  };

  return (
    <div style={{ borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
      {/* Source location header */}
      {(sectionTitle || page != null) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)',
        }}>
          {sectionTitle && <span>{sectionTitle}</span>}
          {page != null && (
            <button
              onClick={() => onPageClick?.(page)}
              style={{
                background: 'none', border: 'none', color: 'var(--accent-color)',
                cursor: 'pointer', fontSize: 10, textDecoration: 'underline', padding: 0,
              }}
            >
              {t('analysis.review.pageNum', { page })}
            </button>
          )}
        </div>
      )}

      {/* Evidence body */}
      {!evidence || isSameLanguage ? (
        <div style={singleColumnStyle}>
          <div style={labelRowStyle}>
            <span style={langLabelStyle}>{t('analysis.review.evidence')}</span>
          </div>
          <div style={textStyle}>{evidence?.en ?? fallbackText}</div>
        </div>
      ) : (
        <div style={bilingualContainerStyle}>
          <div style={columnStyle}>
            <div style={labelRowStyle}>
              <span style={langLabelStyle}>{getLangLabel(evidence.originalLang)}</span>
            </div>
            <div style={textStyle}>{evidence.original}</div>
          </div>
          <div style={dividerStyle} />
          <div style={columnStyle}>
            <div style={labelRowStyle}>
              <span style={langLabelStyle}>{t('analysis.review.en')}</span>
            </div>
            <div style={textStyle}>{evidence.en}</div>
          </div>
        </div>
      )}

      {/* Adjudication buttons */}
      {onAdjudicate && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
        }}>
          <button onClick={() => onAdjudicate('accept')} style={adjBtnStyle('#10B981')}>
            <Check size={11} /> {t('common.accept')}
          </button>
          <button onClick={() => setReviseMode(!reviseMode)} style={adjBtnStyle('#F59E0B')}>
            <Pencil size={11} /> {t('common.revise')}
          </button>
          <button onClick={() => onAdjudicate('reject')} style={adjBtnStyle('#EF4444')}>
            <XIcon size={11} /> {t('common.reject')}
          </button>
        </div>
      )}

      {/* Revise mode */}
      {reviseMode && (
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {t('analysis.review.relation')}
            <select
              value={reviseRelation}
              onChange={(e) => setReviseRelation(e.target.value as RelationType)}
              style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border-subtle)', borderRadius: 3 }}
            >
              <option value="supports">{t('analysis.review.relations.supports')}</option>
              <option value="challenges">{t('analysis.review.relations.challenges')}</option>
              <option value="extends">{t('analysis.review.relations.extends')}</option>
              <option value="operationalizes">{t('analysis.review.relations.operationalizes')}</option>
            </select>
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {t('analysis.review.confidence', { value: reviseConfidence.toFixed(2) })}
            <input
              type="range" min={0} max={1} step={0.05}
              value={reviseConfidence}
              onChange={(e) => setReviseConfidence(parseFloat(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
          <textarea
            value={reviseReason}
            onChange={(e) => setReviseReason(e.target.value)}
            placeholder={t('analysis.review.reviseReason')}
            rows={2}
            style={{ fontSize: 11, padding: '4px 6px', border: '1px solid var(--border-subtle)', borderRadius: 3, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            <button onClick={() => setReviseMode(false)} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-subtle)', borderRadius: 3, background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              {t('common.cancel')}
            </button>
            <button onClick={handleReviseSubmit} style={{ fontSize: 11, padding: '2px 8px', border: 'none', borderRadius: 3, backgroundColor: 'var(--accent-color)', color: '#fff', cursor: 'pointer' }}>
              {t('common.confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──

function adjBtnStyle(color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 3,
    padding: '2px 8px', border: `1px solid ${color}40`,
    borderRadius: 4, backgroundColor: 'transparent',
    color, fontSize: 11, cursor: 'pointer', fontWeight: 500,
  };
}

const bilingualContainerStyle: React.CSSProperties = {
  display: 'flex', gap: 0,
  backgroundColor: 'var(--bg-surface-low)',
};

const columnStyle: React.CSSProperties = {
  flex: 1, padding: '8px 10px', minWidth: 0,
};

const dividerStyle: React.CSSProperties = {
  width: 1, backgroundColor: 'var(--border-subtle)', flexShrink: 0,
};

const singleColumnStyle: React.CSSProperties = {
  padding: '8px 10px', backgroundColor: 'var(--bg-surface-low)',
};

const labelRowStyle: React.CSSProperties = { marginBottom: 4 };

const langLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)', fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px',
};

const textStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)', color: 'var(--text-secondary)',
  lineHeight: 1.6, wordBreak: 'break-word',
};
