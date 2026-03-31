/**
 * KeywordEditor — 关键词 Tag 编辑组件（§2.2）
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useUpdateKeywords } from '../../../../core/ipc/hooks/useConcepts';

interface KeywordEditorProps {
  conceptId: string;
  keywords: string[];
}

export function KeywordEditor({ conceptId, keywords }: KeywordEditorProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const updateKeywords = useUpdateKeywords();
  const isPending = updateKeywords.isPending;

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // Validate: no duplicates
    if (keywords.includes(trimmed)) {
      setError(t('analysis.concepts.keywordDuplicate'));
      return;
    }

    // Validate: max length
    if (trimmed.length > 100) {
      setError(t('analysis.concepts.keywordTooLong'));
      return;
    }

    setError(null);
    const newKeywords = [...keywords, trimmed];
    updateKeywords.mutate(
      { conceptId, keywords: newKeywords },
      {
        onSuccess: () => setInputValue(''),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [inputValue, keywords, conceptId, updateKeywords, t]);

  const handleRemove = useCallback(
    (keyword: string) => {
      setError(null);
      const newKeywords = keywords.filter((k) => k !== keyword);
      updateKeywords.mutate(
        { conceptId, keywords: newKeywords },
        {
          onError: (err) => setError(err instanceof Error ? err.message : String(err)),
        },
      );
    },
    [keywords, conceptId, updateKeywords],
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {keywords.map((kw) => (
          <span
            key={kw}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 12,
              backgroundColor: 'var(--bg-surface-low)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {kw}
            <button
              onClick={() => handleRemove(kw)}
              disabled={isPending}
              aria-label={t('analysis.concepts.removeKeyword', { keyword: kw })}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: isPending ? 'default' : 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
              }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={t('analysis.concepts.addKeyword')}
          disabled={isPending}
          aria-label={t('analysis.concepts.addKeyword')}
          style={{
            border: 'none',
            outline: 'none',
            fontSize: 12,
            padding: '2px 4px',
            color: 'var(--text-primary)',
            backgroundColor: 'transparent',
            minWidth: 100,
          }}
        />
      </div>
      {error && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--danger, #e53e3e)',
            marginTop: 4,
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
}
