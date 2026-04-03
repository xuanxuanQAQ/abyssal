/**
 * ProjectSetupWizard — 项目创建向导
 *
 * 多步对话框：
 * Step 1: 项目基础 — 名称、模式、工作路径
 * Step 2: LLM 配置 — Provider + Model + API Key（带 Test 验证）
 * Step 3: 检索配置 — Embedding provider/model + Reranker backend + 对应 Key
 * Step 4: 语言与网络 — 输出语言、代理、Web Search、Semantic Scholar Key
 * Step 5: 文献源（可选） — 下载源级联预设
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  GripVertical,
} from 'lucide-react';
import { getAPI } from '../../core/ipc/bridge';
import {
  EMBEDDING_MODEL_REGISTRY,
  type EmbeddingProvider,
} from '../../../core/config/config-schema';
import type { ProjectSetupConfig, ProjectInfo } from '../../../shared-types/models';
import { Z_INDEX } from '../../styles/zIndex';

// ═══ Constants ═══

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'siliconflow'] as const;
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  siliconflow: 'SiliconFlow',
};
const MODELS_BY_PROVIDER: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-20250901', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-235B-A22B', 'Qwen/Qwen2.5-72B-Instruct'],
};

const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'siliconflow', 'jina'];
const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  siliconflow: 'SiliconFlow',
  jina: 'Jina',
};

const RERANKER_BACKENDS = ['cohere', 'jina', 'siliconflow'] as const;
const RERANKER_LABELS: Record<string, string> = {
  cohere: 'Cohere',
  jina: 'Jina',
  siliconflow: 'SiliconFlow',
};

const WEB_SEARCH_BACKENDS = ['tavily', 'serpapi', 'bing'] as const;
const WEB_SEARCH_LABELS: Record<string, string> = {
  tavily: 'Tavily',
  serpapi: 'SerpAPI',
  bing: 'Bing',
};

const ALL_SOURCES = ['unpaywall', 'arxiv', 'pmc', 'scihub', 'cnki', 'wanfang'] as const;
const SOURCE_LABELS: Record<string, string> = {
  unpaywall: 'Unpaywall',
  arxiv: 'arXiv',
  pmc: 'PubMed Central',
  scihub: 'Sci-Hub',
  cnki: 'CNKI (知网)',
  wanfang: 'Wanfang (万方)',
};

const SOURCE_PRESETS: Record<string, string[]> = {
  china: ['cnki', 'wanfang', 'unpaywall', 'arxiv', 'pmc', 'scihub'],
  overseas: ['unpaywall', 'arxiv', 'pmc'],
};

/** Which provider each service maps to for API key testing */
const PROVIDER_FOR_KEY_TEST: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  deepseek: 'deepseek',
  siliconflow: 'siliconflow',
  cohere: 'cohere',
  jina: 'jina',
  tavily: 'tavily',
};

// ═══ Types ═══

interface ProjectSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (project: ProjectInfo) => void;
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

const STEP_COUNT = 5;

// ═══ Shared styles ═══

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--bg-base)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 12,
  paddingBottom: 6,
  borderBottom: '1px solid var(--border-subtle)',
};

// ═══ Component ═══

export function ProjectSetupWizard({
  open,
  onOpenChange,
  onComplete,
}: ProjectSetupWizardProps) {
  const { t } = useTranslation();

  // Step navigation
  const [step, setStep] = useState<WizardStep>(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Project basics
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'anchored' | 'unanchored' | 'auto'>('auto');

  // Step 2: LLM
  const [llmProvider, setLlmProvider] = useState('anthropic');
  const [llmModel, setLlmModel] = useState('claude-sonnet-4-20250514');
  const [llmApiKey, setLlmApiKey] = useState('');

  // Step 3: Retrieval
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>('openai');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [rerankerBackend, setRerankerBackend] = useState('cohere');
  const [rerankerApiKey, setRerankerApiKey] = useState('');

  // Step 4: Language & Network
  const [outputLanguage, setOutputLanguage] = useState('zh-CN');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('http://127.0.0.1:7890');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchBackend, setWebSearchBackend] = useState<'tavily' | 'serpapi' | 'bing'>('tavily');
  const [webSearchApiKey, setWebSearchApiKey] = useState('');
  const [semanticScholarApiKey, setSemanticScholarApiKey] = useState('');

  // Step 5: Sources
  const [sourcePreset, setSourcePreset] = useState<'china' | 'overseas' | 'custom'>('overseas');
  const [enabledSources, setEnabledSources] = useState<string[]>(['unpaywall', 'arxiv', 'pmc']);

  // API key test state
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Password visibility
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const resetForm = useCallback(() => {
    setStep(1);
    setCreating(false);
    setError(null);
    setName('');
    setMode('auto');
    setLlmProvider('anthropic');
    setLlmModel('claude-sonnet-4-20250514');
    setLlmApiKey('');
    setEmbeddingProvider('openai');
    setEmbeddingModel('text-embedding-3-small');
    setEmbeddingApiKey('');
    setRerankerBackend('cohere');
    setRerankerApiKey('');
    setOutputLanguage('zh-CN');
    setProxyEnabled(false);
    setProxyUrl('http://127.0.0.1:7890');
    setWebSearchEnabled(false);
    setWebSearchBackend('tavily');
    setWebSearchApiKey('');
    setSemanticScholarApiKey('');
    setSourcePreset('overseas');
    setEnabledSources(['unpaywall', 'arxiv', 'pmc']);
    setTestingKey(null);
    setTestResults({});
    setVisibleKeys(new Set());
  }, []);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    },
    [onOpenChange, resetForm],
  );

  // ── Provider change handlers ──

  const handleLlmProviderChange = useCallback((provider: string) => {
    setLlmProvider(provider);
    const models = MODELS_BY_PROVIDER[provider];
    if (models?.length) setLlmModel(models[0]!);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next['llm'];
      return next;
    });
  }, []);

  const handleEmbeddingProviderChange = useCallback((provider: EmbeddingProvider) => {
    setEmbeddingProvider(provider);
    const models = EMBEDDING_MODEL_REGISTRY[provider];
    if (models.length) setEmbeddingModel(models[0]!.model);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next['embedding'];
      return next;
    });
  }, []);

  const handleSourcePresetChange = useCallback((preset: 'china' | 'overseas' | 'custom') => {
    setSourcePreset(preset);
    if (preset !== 'custom') {
      setEnabledSources(SOURCE_PRESETS[preset] ?? ['unpaywall', 'arxiv', 'pmc']);
    }
  }, []);

  // ── API key test ──

  const handleTestKey = useCallback(
    async (id: string, provider: string, apiKey: string) => {
      if (!apiKey.trim()) return;
      setTestingKey(id);
      try {
        const result = await getAPI().settings.testApiKeyDirect(provider, apiKey);
        setTestResults((prev) => ({ ...prev, [id]: result }));
      } catch (err) {
        setTestResults((prev) => ({
          ...prev,
          [id]: { ok: false, message: (err as Error).message },
        }));
      } finally {
        setTestingKey(null);
      }
    },
    [],
  );

  // ── Visibility toggle ──

  const toggleKeyVisibility = useCallback((id: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Source drag reorder ──

  const moveSource = useCallback((fromIndex: number, direction: -1 | 1) => {
    setEnabledSources((prev) => {
      const toIndex = fromIndex + direction;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      [next[fromIndex], next[toIndex]] = [next[toIndex]!, next[fromIndex]!];
      return next;
    });
  }, []);

  const toggleSource = useCallback((source: string) => {
    setSourcePreset('custom');
    setEnabledSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
    );
  }, []);

  // ── Validation ──

  const canProceed = useMemo((): boolean => {
    switch (step) {
      case 1:
        return !!name.trim();
      case 2:
        return !!llmProvider && !!llmModel && !!llmApiKey.trim();
      case 3:
        return !!embeddingProvider && !!embeddingModel && !!embeddingApiKey.trim() && !!rerankerBackend && !!rerankerApiKey.trim();
      case 4:
        return true; // all optional
      case 5:
        return enabledSources.length > 0;
      default:
        return false;
    }
  }, [step, name, llmProvider, llmModel, llmApiKey, embeddingProvider, embeddingModel, embeddingApiKey, rerankerBackend, rerankerApiKey, enabledSources]);

  // ── Reranker key reuse logic ──

  const rerankerKeyReused = useMemo(() => {
    // If reranker backend matches a provider whose key we already have
    if (rerankerBackend === 'siliconflow' && embeddingProvider === 'siliconflow') return true;
    if (rerankerBackend === 'jina' && embeddingProvider === 'jina') return true;
    return false;
  }, [rerankerBackend, embeddingProvider]);

  const effectiveRerankerApiKey = rerankerKeyReused ? embeddingApiKey : rerankerApiKey;

  // ── Embedding key reuse logic ──

  const embeddingKeyReusesLlm = useMemo(() => {
    // If embedding provider matches llm provider
    return (embeddingProvider === 'openai' && llmProvider === 'openai') ||
      (embeddingProvider === 'siliconflow' && llmProvider === 'siliconflow');
  }, [embeddingProvider, llmProvider]);

  const effectiveEmbeddingApiKey = embeddingKeyReusesLlm ? llmApiKey : embeddingApiKey;

  // Recalculate canProceed for step 3 with reuse logic
  const canProceedStep3 = useMemo(() => {
    const hasEmbeddingKey = !!effectiveEmbeddingApiKey.trim();
    const hasRerankerKey = !!effectiveRerankerApiKey.trim();
    return !!embeddingProvider && !!embeddingModel && hasEmbeddingKey && !!rerankerBackend && hasRerankerKey;
  }, [embeddingProvider, embeddingModel, effectiveEmbeddingApiKey, rerankerBackend, effectiveRerankerApiKey]);

  const canProceedFinal = step === 3 ? canProceedStep3 : canProceed;

  // ── Create project ──

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      setError(t('wizard.projectNameRequired'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const config: ProjectSetupConfig = {
        name: name.trim(),
        mode,
        llmProvider,
        llmModel,
        llmApiKey: llmApiKey.trim() || undefined,
        embeddingProvider,
        embeddingModel,
        embeddingApiKey: effectiveEmbeddingApiKey.trim() || undefined,
        rerankerBackend: rerankerBackend as 'cohere' | 'jina' | 'siliconflow',
        rerankerApiKey: effectiveRerankerApiKey.trim() || undefined,
        outputLanguage,
        proxyEnabled,
        proxyUrl: proxyEnabled ? proxyUrl.trim() : undefined,
        webSearchEnabled,
        webSearchBackend: webSearchEnabled ? webSearchBackend : undefined,
        webSearchApiKey: webSearchEnabled ? webSearchApiKey.trim() || undefined : undefined,
        semanticScholarApiKey: semanticScholarApiKey.trim() || undefined,
        sourcePreset,
        enabledSources,
      };

      const project = await getAPI().app.createProject(config);

      if (project.workspacePath) {
        await getAPI().workspace.switch(project.workspacePath);
      }

      onComplete(project);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }, [
    name, mode, llmProvider, llmModel, llmApiKey,
    embeddingProvider, embeddingModel, effectiveEmbeddingApiKey,
    rerankerBackend, effectiveRerankerApiKey,
    outputLanguage, proxyEnabled, proxyUrl,
    webSearchEnabled, webSearchBackend, webSearchApiKey,
    semanticScholarApiKey, sourcePreset, enabledSources,
    onComplete, handleOpenChange, t,
  ]);

  // ── Navigation ──

  const goNext = useCallback(() => {
    setError(null);
    if (step < STEP_COUNT) setStep((step + 1) as WizardStep);
    else handleCreate();
  }, [step, handleCreate]);

  const goBack = useCallback(() => {
    setError(null);
    if (step > 1) setStep((step - 1) as WizardStep);
  }, [step]);

  // ── Step labels ──

  const stepLabels = useMemo(
    () => [
      t('wizard.step1'),
      t('wizard.step2'),
      t('wizard.step3'),
      t('wizard.step4'),
      t('wizard.step5'),
    ],
    [t],
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
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
            width: 580,
            maxHeight: '85vh',
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
          {/* Header + Stepper */}
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
            <Dialog.Description
              style={{
                fontSize: 13,
                color: 'var(--text-muted)',
                marginTop: 4,
              }}
            >
              {t('wizard.subtitle')}
            </Dialog.Description>

            {/* Stepper */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 0,
                marginTop: 16,
                marginBottom: 4,
              }}
            >
              {stepLabels.map((label, i) => {
                const stepNum = (i + 1) as WizardStep;
                const isActive = stepNum === step;
                const isComplete = stepNum < step;
                return (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <div
                        style={{
                          flex: 1,
                          height: 2,
                          backgroundColor: isComplete
                            ? 'var(--accent-color)'
                            : 'var(--border-subtle)',
                          margin: '0 4px',
                        }}
                      />
                    )}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          backgroundColor: isActive
                            ? 'var(--accent-color)'
                            : isComplete
                              ? 'var(--accent-color)'
                              : 'var(--bg-surface-low)',
                          color: isActive || isComplete
                            ? 'white'
                            : 'var(--text-muted)',
                          border: isActive
                            ? 'none'
                            : isComplete
                              ? 'none'
                              : '1px solid var(--border-default)',
                        }}
                      >
                        {isComplete ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          stepNum
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div
            style={{
              padding: '16px 24px 24px',
              overflow: 'auto',
              flex: 1,
            }}
          >
            {error && (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--danger)',
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            )}

            {creating && (
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

            {/* Step 1: Project Basics */}
            {!creating && step === 1 && (
              <div>
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.projectName')} *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('wizard.projectNamePlaceholder')}
                    style={inputStyle}
                    autoFocus
                  />
                </div>

                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.mode')}</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                    style={selectStyle}
                  >
                    <option value="auto">{t('wizard.modeAuto')}</option>
                    <option value="anchored">{t('wizard.modeAnchored')}</option>
                    <option value="unanchored">{t('wizard.modeUnanchored')}</option>
                  </select>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    {t('wizard.modeHint')}
                  </span>
                </div>
              </div>
            )}

            {/* Step 2: LLM Config */}
            {!creating && step === 2 && (
              <div>
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.llmProvider')} *</label>
                  <select
                    value={llmProvider}
                    onChange={(e) => handleLlmProviderChange(e.target.value)}
                    style={selectStyle}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.llmModel')} *</label>
                  <select
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    style={selectStyle}
                  >
                    {(MODELS_BY_PROVIDER[llmProvider] ?? []).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <ApiKeyField
                  id="llm"
                  label={t('wizard.llmApiKey')}
                  value={llmApiKey}
                  onChange={setLlmApiKey}
                  provider={PROVIDER_FOR_KEY_TEST[llmProvider] ?? llmProvider}
                  onTest={handleTestKey}
                  testing={testingKey === 'llm'}
                  testResult={testResults['llm']}
                  visible={visibleKeys.has('llm')}
                  onToggleVisibility={toggleKeyVisibility}
                  required
                />
              </div>
            )}

            {/* Step 3: Retrieval Config */}
            {!creating && step === 3 && (
              <div>
                {/* Embedding */}
                <div style={sectionTitleStyle}>{t('wizard.embeddingSection')}</div>

                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.embeddingProvider')} *</label>
                  <select
                    value={embeddingProvider}
                    onChange={(e) => handleEmbeddingProviderChange(e.target.value as EmbeddingProvider)}
                    style={selectStyle}
                  >
                    {EMBEDDING_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {EMBEDDING_PROVIDER_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.embeddingModel')} *</label>
                  <select
                    value={embeddingModel}
                    onChange={(e) => setEmbeddingModel(e.target.value)}
                    style={selectStyle}
                  >
                    {EMBEDDING_MODEL_REGISTRY[embeddingProvider].map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                {embeddingKeyReusesLlm ? (
                  <div
                    style={{
                      padding: '8px 12px',
                      backgroundColor: 'color-mix(in srgb, var(--accent-color) 8%, transparent)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginBottom: 14,
                    }}
                  >
                    {t('wizard.keyReused', { provider: PROVIDER_LABELS[llmProvider] || llmProvider })}
                  </div>
                ) : (
                  <ApiKeyField
                    id="embedding"
                    label={t('wizard.embeddingApiKey')}
                    value={embeddingApiKey}
                    onChange={setEmbeddingApiKey}
                    provider={PROVIDER_FOR_KEY_TEST[embeddingProvider] ?? embeddingProvider}
                    onTest={handleTestKey}
                    testing={testingKey === 'embedding'}
                    testResult={testResults['embedding']}
                    visible={visibleKeys.has('embedding')}
                    onToggleVisibility={toggleKeyVisibility}
                    required
                  />
                )}

                {/* Reranker */}
                <div style={{ ...sectionTitleStyle, marginTop: 8 }}>{t('wizard.rerankerSection')}</div>

                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.rerankerBackend')} *</label>
                  <select
                    value={rerankerBackend}
                    onChange={(e) => {
                      setRerankerBackend(e.target.value);
                      setTestResults((prev) => {
                        const next = { ...prev };
                        delete next['reranker'];
                        return next;
                      });
                    }}
                    style={selectStyle}
                  >
                    {RERANKER_BACKENDS.map((r) => (
                      <option key={r} value={r}>
                        {RERANKER_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>

                {rerankerKeyReused ? (
                  <div
                    style={{
                      padding: '8px 12px',
                      backgroundColor: 'color-mix(in srgb, var(--accent-color) 8%, transparent)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginBottom: 14,
                    }}
                  >
                    {t('wizard.keyReused', { provider: EMBEDDING_PROVIDER_LABELS[embeddingProvider] || embeddingProvider })}
                  </div>
                ) : (
                  <ApiKeyField
                    id="reranker"
                    label={t('wizard.rerankerApiKey')}
                    value={rerankerApiKey}
                    onChange={setRerankerApiKey}
                    provider={PROVIDER_FOR_KEY_TEST[rerankerBackend] ?? rerankerBackend}
                    onTest={handleTestKey}
                    testing={testingKey === 'reranker'}
                    testResult={testResults['reranker']}
                    visible={visibleKeys.has('reranker')}
                    onToggleVisibility={toggleKeyVisibility}
                    required
                  />
                )}
              </div>
            )}

            {/* Step 4: Language & Network */}
            {!creating && step === 4 && (
              <div>
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.outputLanguage')}</label>
                  <select
                    value={outputLanguage}
                    onChange={(e) => setOutputLanguage(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="zh-CN">中文</option>
                    <option value="en">English</option>
                  </select>
                </div>

                {/* Proxy */}
                <div style={sectionTitleStyle}>{t('wizard.proxySection')}</div>
                <div style={fieldGroupStyle}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={proxyEnabled}
                      onChange={(e) => setProxyEnabled(e.target.checked)}
                      style={{ accentColor: 'var(--accent-color)' }}
                    />
                    {t('wizard.enableProxy')}
                  </label>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                    {t('wizard.proxyHint')}
                  </span>
                </div>

                {proxyEnabled && (
                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>{t('wizard.proxyUrl')}</label>
                    <input
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      placeholder="http://127.0.0.1:7890"
                      style={inputStyle}
                    />
                  </div>
                )}

                {/* Web Search */}
                <div style={sectionTitleStyle}>{t('wizard.webSearchSection')}</div>
                <div style={fieldGroupStyle}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={webSearchEnabled}
                      onChange={(e) => setWebSearchEnabled(e.target.checked)}
                      style={{ accentColor: 'var(--accent-color)' }}
                    />
                    {t('wizard.enableWebSearch')}
                  </label>
                </div>

                {webSearchEnabled && (
                  <>
                    <div style={fieldGroupStyle}>
                      <label style={labelStyle}>{t('wizard.webSearchBackend')}</label>
                      <select
                        value={webSearchBackend}
                        onChange={(e) => setWebSearchBackend(e.target.value as typeof webSearchBackend)}
                        style={selectStyle}
                      >
                        {WEB_SEARCH_BACKENDS.map((b) => (
                          <option key={b} value={b}>
                            {WEB_SEARCH_LABELS[b]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <ApiKeyField
                      id="webSearch"
                      label={t('wizard.webSearchApiKey')}
                      value={webSearchApiKey}
                      onChange={setWebSearchApiKey}
                      provider={webSearchBackend}
                      onTest={handleTestKey}
                      testing={testingKey === 'webSearch'}
                      testResult={testResults['webSearch']}
                      visible={visibleKeys.has('webSearch')}
                      onToggleVisibility={toggleKeyVisibility}
                    />
                  </>
                )}

                {/* Semantic Scholar */}
                <div style={{ ...sectionTitleStyle, marginTop: 8 }}>Semantic Scholar</div>
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.semanticScholarKey')}</label>
                  <input
                    value={semanticScholarApiKey}
                    onChange={(e) => setSemanticScholarApiKey(e.target.value)}
                    placeholder={t('wizard.semanticScholarKeyPlaceholder')}
                    style={inputStyle}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                    {t('wizard.semanticScholarHint')}
                  </span>
                </div>
              </div>
            )}

            {/* Step 5: Sources */}
            {!creating && step === 5 && (
              <div>
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.sourcePreset')}</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {(['overseas', 'china', 'custom'] as const).map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handleSourcePresetChange(preset)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: 12,
                          fontWeight: sourcePreset === preset ? 600 : 400,
                          border: sourcePreset === preset
                            ? '2px solid var(--accent-color)'
                            : '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-md)',
                          backgroundColor: sourcePreset === preset
                            ? 'color-mix(in srgb, var(--accent-color) 8%, transparent)'
                            : 'var(--bg-surface)',
                          color: sourcePreset === preset
                            ? 'var(--accent-color)'
                            : 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        {t(`wizard.preset_${preset}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>{t('wizard.enabledSources')}</label>
                  <div
                    style={{
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Active sources (ordered) */}
                    {enabledSources.map((source, i) => (
                      <div
                        key={source}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--bg-base)',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button
                            onClick={() => moveSource(i, -1)}
                            disabled={i === 0}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: i === 0 ? 'default' : 'pointer',
                              opacity: i === 0 ? 0.3 : 1,
                              padding: 0,
                              color: 'var(--text-muted)',
                              lineHeight: 1,
                              fontSize: 9,
                            }}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveSource(i, 1)}
                            disabled={i === enabledSources.length - 1}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: i === enabledSources.length - 1 ? 'default' : 'pointer',
                              opacity: i === enabledSources.length - 1 ? 0.3 : 1,
                              padding: 0,
                              color: 'var(--text-muted)',
                              lineHeight: 1,
                              fontSize: 9,
                            }}
                          >
                            ▼
                          </button>
                        </div>
                        <GripVertical size={12} style={{ color: 'var(--text-muted)' }} />
                        <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
                          {SOURCE_LABELS[source] ?? source}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{i + 1}</span>
                        <button
                          onClick={() => toggleSource(source)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 11,
                            color: 'var(--danger)',
                            padding: '2px 6px',
                          }}
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    ))}

                    {/* Inactive sources */}
                    {ALL_SOURCES.filter((s) => !enabledSources.includes(s)).map((source) => (
                      <div
                        key={source}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--bg-surface)',
                          opacity: 0.6,
                        }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, marginLeft: 28 }}>
                          {SOURCE_LABELS[source] ?? source}
                        </span>
                        <button
                          onClick={() => toggleSource(source)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 11,
                            color: 'var(--accent-color)',
                            padding: '2px 6px',
                          }}
                        >
                          {t('common.add')}
                        </button>
                      </div>
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
                    {t('wizard.sourcesHint')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!creating && (
            <div
              style={{
                padding: '12px 24px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              {step > 1 ? (
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
              <button
                onClick={goNext}
                disabled={!canProceedFinal}
                style={{
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--accent-color)',
                  color: 'white',
                  cursor: canProceedFinal ? 'pointer' : 'default',
                  opacity: canProceedFinal ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {step === STEP_COUNT ? t('wizard.createProject') : t('common.next')}{' '}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ═══ ApiKeyField sub-component ═══

function ApiKeyField({
  id,
  label,
  value,
  onChange,
  provider,
  onTest,
  testing,
  testResult,
  visible,
  onToggleVisibility,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  provider: string;
  onTest: (id: string, provider: string, apiKey: string) => void;
  testing: boolean;
  testResult?: { ok: boolean; message: string } | undefined;
  visible: boolean;
  onToggleVisibility: (id: string) => void;
  required?: boolean;
}) {
  return (
    <div style={fieldGroupStyle}>
      <label style={labelStyle}>
        {label} {required && '*'}
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="sk-..."
            style={{
              ...inputStyle,
              paddingRight: 32,
            }}
          />
          <button
            onClick={() => onToggleVisibility(id)}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 2,
              display: 'flex',
            }}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          onClick={() => onTest(id, provider, value)}
          disabled={testing || !value.trim()}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            cursor: testing || !value.trim() ? 'default' : 'pointer',
            opacity: testing || !value.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {testing ? (
            <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          ) : null}
          Test
        </button>
      </div>
      {testResult && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            fontSize: 11,
            color: testResult.ok ? 'var(--success, #22c55e)' : 'var(--danger)',
          }}
        >
          {testResult.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {testResult.message}
        </div>
      )}
    </div>
  );
}
