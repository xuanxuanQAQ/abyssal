import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

type ConfirmTone = 'primary' | 'danger';

interface BaseDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: ConfirmTone;
}

export type ConfirmDialogOptions = BaseDialogOptions;

export interface PromptDialogOptions extends BaseDialogOptions {
  defaultValue?: string;
  placeholder?: string;
  inputLabel?: string;
  multiline?: boolean;
  rows?: number;
}

type DialogRequest =
  | { kind: 'confirm'; options: ConfirmDialogOptions }
  | { kind: 'prompt'; options: PromptDialogOptions; value: string };

type DialogResult = boolean | string | null;

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(8, 12, 18, 0.48)',
  backdropFilter: 'blur(8px)',
  zIndex: 1200,
};

const contentStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(520px, calc(100vw - 32px))',
  maxHeight: 'min(88vh, 720px)',
  overflow: 'auto',
  borderRadius: 16,
  border: '1px solid color-mix(in srgb, var(--border-default) 78%, white 22%)',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-surface) 92%, white 8%) 0%, var(--bg-base) 100%)',
  boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28)',
  padding: 20,
  zIndex: 1201,
  outline: 'none',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-lg)',
  fontWeight: 650,
  color: 'var(--text-primary)',
};

const descriptionStyle: React.CSSProperties = {
  margin: '10px 0 0',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-sm)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 20,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};

const primaryButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  border: '1px solid color-mix(in srgb, var(--accent-color) 70%, white 30%)',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent-color) 18%, white 4%) 0%, color-mix(in srgb, var(--accent-color) 14%, var(--bg-surface) 86%) 100%)',
  color: 'var(--accent-color)',
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  border: '1px solid color-mix(in srgb, var(--danger) 72%, white 28%)',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--danger) 16%, white 4%) 0%, color-mix(in srgb, var(--danger) 12%, var(--bg-surface) 88%) 100%)',
  color: 'var(--danger)',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  lineHeight: 1.5,
  outline: 'none',
  resize: 'vertical',
  boxSizing: 'border-box',
};

export function useAppDialog() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const requestRef = useRef<DialogRequest | null>(null);
  const resolverRef = useRef<((result: DialogResult) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const resolvePending = useCallback((result?: DialogResult) => {
    const resolver = resolverRef.current;
    if (!resolver) return;

    const currentRequest = requestRef.current;
    resolverRef.current = null;
    resolver(result ?? (currentRequest?.kind === 'confirm' ? false : null));
  }, []);

  useEffect(() => {
    return () => {
      resolvePending();
    };
  }, [resolvePending]);

  useEffect(() => {
    if (request?.kind !== 'prompt') return;
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select();
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [request]);

  const closeDialog = useCallback((result?: DialogResult) => {
    setRequest(null);
    resolvePending(result);
  }, [resolvePending]);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    resolvePending();
    return new Promise<boolean>((resolve) => {
      resolverRef.current = (result) => resolve(Boolean(result));
      setRequest({ kind: 'confirm', options });
    });
  }, [resolvePending]);

  const prompt = useCallback((options: PromptDialogOptions) => {
    resolvePending();
    return new Promise<string | null>((resolve) => {
      resolverRef.current = (result) => resolve(typeof result === 'string' ? result : null);
      setRequest({ kind: 'prompt', options, value: options.defaultValue ?? '' });
    });
  }, [resolvePending]);

  const dialog = useMemo(() => {
    if (!request) return null;

    const confirmLabel = request.options.confirmLabel
      ?? (request.kind === 'prompt' ? t('common.save') : t('common.confirm'));
    const cancelLabel = request.options.cancelLabel ?? t('common.cancel');
    const toneStyle = request.options.confirmTone === 'danger' ? dangerButtonStyle : primaryButtonStyle;

    return (
      <Dialog.Root open onOpenChange={(open) => {
        if (!open) closeDialog();
      }}>
        <Dialog.Portal>
          <Dialog.Overlay style={overlayStyle} />
          <Dialog.Content style={contentStyle} data-testid="app-dialog">
            <Dialog.Title style={titleStyle}>{request.options.title}</Dialog.Title>
            {request.options.description ? (
              <Dialog.Description style={descriptionStyle}>
                {request.options.description}
              </Dialog.Description>
            ) : null}

            {request.kind === 'prompt' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  closeDialog(request.value);
                }}
              >
                <div style={{ marginTop: 16 }}>
                  {request.options.inputLabel ? (
                    <label style={fieldLabelStyle}>{request.options.inputLabel}</label>
                  ) : null}
                  {request.options.multiline ? (
                    <textarea
                      ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                      value={request.value}
                      rows={request.options.rows ?? 5}
                      placeholder={request.options.placeholder}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setRequest((current) => current?.kind === 'prompt'
                          ? { ...current, value: nextValue }
                          : current);
                      }}
                      style={inputStyle}
                    />
                  ) : (
                    <input
                      ref={inputRef as React.RefObject<HTMLInputElement>}
                      type="text"
                      value={request.value}
                      placeholder={request.options.placeholder}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setRequest((current) => current?.kind === 'prompt'
                          ? { ...current, value: nextValue }
                          : current);
                      }}
                      style={inputStyle}
                    />
                  )}
                </div>

                <div style={footerStyle}>
                  <button type="button" style={secondaryButtonStyle} data-dialog-action="cancel" onClick={() => closeDialog()}>
                    {cancelLabel}
                  </button>
                  <button type="submit" style={toneStyle} data-dialog-action="confirm">
                    {confirmLabel}
                  </button>
                </div>
              </form>
            ) : (
              <div style={footerStyle}>
                <button type="button" style={secondaryButtonStyle} data-dialog-action="cancel" onClick={() => closeDialog(false)}>
                  {cancelLabel}
                </button>
                <button type="button" style={toneStyle} data-dialog-action="confirm" onClick={() => closeDialog(true)}>
                  {confirmLabel}
                </button>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }, [closeDialog, request, t]);

  return { confirm, prompt, dialog };
}