/**
 * DefinitionEditor — 概念定义编辑器（§2.2, §2.5）
 *
 * 纯文本 textarea，≤500 字符限制。
 * 保存时调用 updateDefinition，进行中时 textarea disabled。
 * 保存成功后显示影响评估信息。
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateDefinition } from '../../../../core/ipc/hooks/useConcepts';

interface DefinitionEditorProps {
  conceptId: string;
  initialValue: string;
}

export function DefinitionEditor({ conceptId, initialValue }: DefinitionEditorProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [impactInfo, setImpactInfo] = useState<string | null>(null);
  const updateDef = useUpdateDefinition();
  const isPending = updateDef.isPending;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setSavedValue(initialValue);
    setError(null);
    setImpactInfo(null);
  }, [conceptId, initialValue]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const doSave = useCallback(() => {
    if (value.trim() === savedValue.trim() || isPending) return;
    setError(null);
    setImpactInfo(null);

    updateDef.mutate(
      { conceptId, newDefinition: value.trim() },
      {
        onSuccess: (result: any) => {
          setSavedValue(value.trim());
          setError(null); // Clear any previous error on success
          // Show impact estimation based on result
          const changeType = result?.changeType ?? result?.semanticDrift;
          const affected = result?.affectedMappings ?? 0;
          if (changeType === 'breaking' || changeType === true) {
            setImpactInfo(
              t('analysis.concepts.definitionEditor.breakingChange', {
                count: affected,
                defaultValue: `Definition change may affect ${affected} existing mappings. Consider re-analyzing affected papers.`,
              }),
            );
          } else if (affected > 0) {
            setImpactInfo(
              t('analysis.concepts.definitionEditor.additiveChange', {
                count: affected,
                defaultValue: `Definition updated. ${affected} mappings remain compatible.`,
              }),
            );
          }
        },
        onError: (err) => {
          // Rollback on error and show error message
          setValue(savedValue);
          setError(
            err instanceof Error
              ? err.message
              : t('analysis.concepts.definitionEditor.saveFailed', {
                message: t('common.unknownError', { defaultValue: '未知错误' }),
              }),
          );
        },
      },
    );
  }, [value, savedValue, conceptId, isPending, updateDef, t]);

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSave();
  }, [doSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        doSave();
      }
    },
    [doSave],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (e.target.value.length <= 500) {
        setValue(e.target.value);
        // Auto-save debounce (3s after last keystroke)
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(doSave, 3000);
      }
    },
    [doSave],
  );

  return (
    <div style={{ position: 'relative' }}>
      {isPending && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '4px 10px',
            backgroundColor: '#FEF3C7',
            color: '#92400E',
            fontSize: 11,
            borderRadius: '4px 4px 0 0',
            zIndex: 1,
          }}
          role="status"
          aria-live="polite"
        >
          {t('analysis.concepts.definitionEditor.analyzing')}
        </div>
      )}
      <textarea
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        rows={4}
        aria-label={t('analysis.concepts.definition')}
        aria-busy={isPending}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: `1px solid ${error ? 'var(--danger, #e53e3e)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-sm, 4px)',
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          backgroundColor: isPending ? 'var(--bg-surface-low)' : 'var(--bg-surface)',
          opacity: isPending ? 0.7 : 1,
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 2,
        }}
      >
        <div style={{ flex: 1 }}>
          {error && (
            <span
              style={{ fontSize: 11, color: 'var(--danger, #e53e3e)' }}
              role="alert"
            >
              {error}
            </span>
          )}
          {impactInfo && !error && (
            <span
              style={{ fontSize: 11, color: 'var(--accent-color)' }}
              role="status"
              aria-live="polite"
            >
              {impactInfo}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {value.length}/500
        </span>
      </div>
    </div>
  );
}
