/**
 * BilingualEvidenceCard -- displays bilingual evidence (v1.2)
 *
 * If BilingualEvidence exists: left-right layout (50/50) with original text and English translation.
 * If only fallbackText: single column display.
 */

import React from 'react';
import type { BilingualEvidence } from '../../../../../shared-types/models';

interface BilingualEvidenceCardProps {
  evidence: BilingualEvidence | undefined;
  fallbackText: string;
}

function getLangLabel(langCode: string): string {
  const langMap: Record<string, string> = {
    zh: '中文',
    'zh-CN': '中文',
    'zh-TW': '繁體中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    ru: 'Русский',
  };
  return langMap[langCode] ?? langCode;
}

export function BilingualEvidenceCard({
  evidence,
  fallbackText,
}: BilingualEvidenceCardProps) {
  if (!evidence) {
    return (
      <div style={singleColumnStyle}>
        <div style={labelRowStyle}>
          <span style={langLabelStyle}>Evidence</span>
        </div>
        <div style={textStyle}>{fallbackText}</div>
      </div>
    );
  }

  return (
    <div style={bilingualContainerStyle}>
      {/* Original text */}
      <div style={columnStyle}>
        <div style={labelRowStyle}>
          <span style={langLabelStyle}>
            {getLangLabel(evidence.originalLang)}
          </span>
        </div>
        <div style={textStyle}>{evidence.original}</div>
      </div>

      {/* Divider */}
      <div style={dividerStyle} />

      {/* English translation */}
      <div style={columnStyle}>
        <div style={labelRowStyle}>
          <span style={langLabelStyle}>English</span>
        </div>
        <div style={textStyle}>{evidence.en}</div>
      </div>
    </div>
  );
}

// ── Styles ──

const bilingualContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
  overflow: 'hidden',
};

const columnStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  minWidth: 0,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  backgroundColor: 'var(--border-subtle)',
  flexShrink: 0,
};

const singleColumnStyle: React.CSSProperties = {
  padding: '8px 10px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--border-subtle)',
};

const labelRowStyle: React.CSSProperties = {
  marginBottom: 4,
};

const langLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const textStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs, 11px)',
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  wordBreak: 'break-word',
};
