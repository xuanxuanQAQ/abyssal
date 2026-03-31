/**
 * ProjectSetupWizard — v1.2 项目创建向导
 *
 * 多步对话框：
 * Step 1: 项目名称 + 起点模式选择 (framework vs exploration)
 * Step 2a (framework): 定义初始概念 + 选择嵌入模型（不可逆警告）
 * Step 2b (exploration): 简要确认
 * Final: 调用 getAPI().app.createProject(config)
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BookOpen,
  Compass,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Plus,
  X,
  Loader2,
} from 'lucide-react';
import { getAPI } from '../../core/ipc/bridge';
import type { ProjectSetupConfig, ProjectInfo } from '../../../shared-types/models';
import type { ProjectStartMode } from '../../../shared-types/enums';
import { Z_INDEX } from '../../styles/zIndex';

interface ProjectSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (project: ProjectInfo) => void;
}

type WizardStep = 'mode' | 'framework' | 'exploration' | 'creating';

export function ProjectSetupWizard({
  open,
  onOpenChange,
  onComplete,
}: ProjectSetupWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>('mode');
  const [name, setName] = useState('');
  const [startMode, setStartMode] = useState<ProjectStartMode>('exploration');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [concepts, setConcepts] = useState<string[]>([]);
  const [newConcept, setNewConcept] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleModeSelect = useCallback(
    (mode: ProjectStartMode) => {
      setStartMode(mode);
      setStep(mode === 'framework' ? 'framework' : 'exploration');
    },
    [],
  );

  const addConcept = useCallback(() => {
    const trimmed = newConcept.trim();
    if (trimmed && !concepts.includes(trimmed)) {
      setConcepts((prev) => [...prev, trimmed]);
      setNewConcept('');
    }
  }, [newConcept, concepts]);

  const removeConcept = useCallback((index: number) => {
    setConcepts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError(t('wizard.projectNameRequired'));
      return;
    }
    setStep('creating');
    setError(null);
    try {
      const config: ProjectSetupConfig = {
        name: name.trim(),
        startMode,
        ...(startMode === 'framework'
          ? {
              embeddingModel,
              initialConcepts: concepts.length > 0 ? concepts : undefined,
            }
          : {}),
      };
      const project = await getAPI().app.createProject(config);

      // 切换到新创建的工作区（热切换，无需重启）
      const wsPath = (project as unknown as Record<string, unknown>)['workspacePath'] as string | undefined;
      if (wsPath) {
        await getAPI().workspace.switch(wsPath);
      }

      onComplete(project);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      setStep(startMode === 'framework' ? 'framework' : 'exploration');
    }
  }, [name, startMode, embeddingModel, concepts, onComplete, onOpenChange, t]);

  const goBack = useCallback(() => {
    setStep('mode');
    setError(null);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--overlay-bg)',
            zIndex: Z_INDEX.MODAL_BACKDROP,
          }}
        />
        <Dialog.Content
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 520,
            maxHeight: '80vh',
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-lg)',
            padding: 0,
            zIndex: Z_INDEX.MODAL,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
            <Dialog.Title
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              {t('wizard.title')}
            </Dialog.Title>
            {step === 'mode' && (
              <Dialog.Description
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  marginTop: 4,
                }}
              >
                {t('wizard.subtitle')}
              </Dialog.Description>
            )}
          </div>

          {/* Body */}
          <div
            style={{ padding: '16px 24px 24px', overflow: 'auto', flex: 1 }}
          >
            {/* Project name (always visible) */}
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                {t('wizard.projectName')}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('wizard.projectNamePlaceholder')}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: 14,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor:
                    'color-mix(in srgb, var(--danger) 10%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--danger)',
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            )}

            {/* Step: Mode selection */}
            {step === 'mode' && (
              <div style={{ display: 'flex', gap: 12 }}>
                <ModeCard
                  icon={<BookOpen size={24} />}
                  title={t('wizard.anchored')}
                  description={t('wizard.anchoredDesc')}
                  onClick={() => handleModeSelect('framework')}
                />
                <ModeCard
                  icon={<Compass size={24} />}
                  title={t('wizard.exploratory')}
                  description={t('wizard.exploratoryDesc')}
                  onClick={() => handleModeSelect('exploration')}
                />
              </div>
            )}

            {/* Step: Framework config */}
            {step === 'framework' && (
              <div>
                {/* Warning about irreversibility */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '10px 12px',
                    backgroundColor:
                      'color-mix(in srgb, var(--warning) 10%, transparent)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 16,
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <AlertTriangle
                    size={14}
                    style={{
                      color: 'var(--warning)',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  />
                  <span>{t('wizard.embeddingWarning')}</span>
                </div>

                {/* Embedding model */}
                <div style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      display: 'block',
                      marginBottom: 4,
                    }}
                  >
                    {t('wizard.embeddingModel')}
                  </label>
                  <select
                    value={embeddingModel}
                    onChange={(e) => setEmbeddingModel(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 13,
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  >
                    <option value="text-embedding-3-small">
                      {t('wizard.embeddingSmall')}
                    </option>
                    <option value="text-embedding-3-large">
                      {t('wizard.embeddingLarge')}
                    </option>
                  </select>
                </div>

                {/* Initial concepts */}
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      display: 'block',
                      marginBottom: 4,
                    }}
                  >
                    {t('wizard.initialConcepts')}
                  </label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input
                      value={newConcept}
                      onChange={(e) => setNewConcept(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addConcept();
                        }
                      }}
                      placeholder={t('wizard.addConceptPlaceholder')}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        fontSize: 13,
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-base)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={addConcept}
                      style={{
                        padding: '6px 10px',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  {concepts.length > 0 && (
                    <div
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
                    >
                      {concepts.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            fontSize: 12,
                            backgroundColor: 'var(--bg-surface-low)',
                            borderRadius: 'var(--radius-full)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          {c}
                          <button
                            onClick={() => removeConcept(i)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: 0,
                              display: 'flex',
                            }}
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step: Exploration confirmation */}
            {step === 'exploration' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '16px 0',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <Compass
                  size={32}
                  style={{ color: 'var(--accent-color)', marginBottom: 12 }}
                />
                <p>{t('wizard.exploratorySkip')}</p>
                <p>{t('wizard.addConceptsLater')}</p>
              </div>
            )}

            {/* Step: Creating */}
            {step === 'creating' && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '32px 0',
                  color: 'var(--text-muted)',
                }}
              >
                <Loader2
                  size={24}
                  style={{
                    animation: 'spin 1s linear infinite',
                    marginBottom: 8,
                  }}
                />
                <p style={{ fontSize: 13 }}>{t('wizard.creating')}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {step !== 'creating' && (
            <div
              style={{
                padding: '12px 24px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              {step !== 'mode' ? (
                <button
                  onClick={goBack}
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <ArrowLeft size={14} /> {t('common.back')}
                </button>
              ) : (
                <div />
              )}
              {step !== 'mode' && (
                <button
                  onClick={handleCreate}
                  disabled={!name.trim()}
                  style={{
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--accent-color)',
                    color: 'white',
                    cursor: name.trim() ? 'pointer' : 'default',
                    opacity: name.trim() ? 1 : 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {t('wizard.createProject')} <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModeCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '20px 16px',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--bg-surface)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent-color)';
        e.currentTarget.style.boxShadow =
          '0 0 0 2px color-mix(in srgb, var(--accent-color) 20%, transparent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-default)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <span style={{ color: 'var(--accent-color)' }}>{icon}</span>
      <span
        style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}
      >
        {title}
      </span>
      <span
        style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}
      >
        {description}
      </span>
    </button>
  );
}
