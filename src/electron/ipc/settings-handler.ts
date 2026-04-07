/**
 * IPC handler: settings namespace
 *
 * Provides full configuration read/write for the Settings UI.
 * Handles global config (API keys, LLM) and workspace config
 * (project, discovery, analysis, etc.) separately.
 */

import { shell, app } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { loadGlobalConfig, saveGlobalConfig } from '../../core/infra/global-config';
import { ConfigLoader } from '../../core/infra/config';
import { testApiKeyDirect, testConfiguredApiKey } from '../../core/infra/api-key-diagnostics';
import type { SettingsData, DbStatsInfo } from '../../shared-types/models';

// ─── Helpers ───

/** Mask an API key for display: show first 8 and last 4 chars */
function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 12) return '****';
  return key.slice(0, 8) + '****' + key.slice(-4);
}

/** Save workspace-level config sections to .abyssal/config.toml */
async function saveWorkspaceConfig(
  workspaceRoot: string,
  section: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const configDir = path.join(workspaceRoot, '.abyssal');
  const configPath = path.join(configDir, 'config.toml');

  // Read existing workspace TOML
  let raw: Record<string, unknown> = {};
  try {
    const toml = require('smol-toml');
    raw = toml.parse(await fsp.readFile(configPath, 'utf-8')) as Record<string, unknown>;
  } catch { /* file may not exist — use empty */ }

  // Merge the section
  const existing = (raw[section] ?? {}) as Record<string, unknown>;
  raw[section] = { ...existing, ...patch };

  // Write back as simple TOML
  const lines: string[] = ['# Abyssal workspace config (auto-generated)', ''];
  for (const [sectionName, sectionValue] of Object.entries(raw)) {
    if (sectionValue && typeof sectionValue === 'object' && !Array.isArray(sectionValue)) {
      lines.push(`[${sectionName}]`);
      for (const [key, val] of Object.entries(sectionValue as Record<string, unknown>)) {
        if (val === null || val === undefined) continue;
        if (typeof val === 'object' && !Array.isArray(val)) {
          // Nested table (e.g. workflowOverrides) — write as sub-table
          lines.push('');
          lines.push(`[${sectionName}.${key}]`);
          for (const [sk, sv] of Object.entries(val as Record<string, unknown>)) {
            if (sv === null || sv === undefined) continue;
            lines.push(`${sk} = ${JSON.stringify(sv)}`);
          }
        } else {
          lines.push(`${key} = ${JSON.stringify(val)}`);
        }
      }
      lines.push('');
    }
  }

  await fsp.mkdir(configDir, { recursive: true });
  await fsp.writeFile(configPath, lines.join('\n'), 'utf-8');
}

// ─── Registration ───

export function registerSettingsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── settings:getAll ──
  typedHandler('settings:getAll', logger, async (): Promise<SettingsData> => {
    const c = ctx.config;
    return {
      project: {
        name: c.project.name,
        description: c.project.description,
      },
      llm: {
        defaultProvider: c.llm.defaultProvider,
        defaultModel: c.llm.defaultModel,
        workflowOverrides: c.llm.workflowOverrides as Record<string, { provider: string; model: string; maxTokens?: number }>,
      },
      rag: {
        embeddingModel: c.rag.embeddingModel,
        embeddingDimension: c.rag.embeddingDimension,
        embeddingProvider: c.rag.embeddingProvider,
        defaultTopK: c.rag.defaultTopK,
        expandFactor: c.rag.expandFactor,
        rerankerBackend: c.rag.rerankerBackend,
        rerankerModel: c.rag.rerankerModel,
        correctiveRagEnabled: c.rag.correctiveRagEnabled,
        correctiveRagMaxRetries: c.rag.correctiveRagMaxRetries,
        correctiveRagModel: c.rag.correctiveRagModel,
        tentativeExpandFactorMultiplier: c.rag.tentativeExpandFactorMultiplier,
        tentativeTopkMultiplier: c.rag.tentativeTopkMultiplier,
        crossConceptBoostFactor: c.rag.crossConceptBoostFactor,
      },
      acquire: {
        enabledSources: c.acquire.enabledSources,
        enableScihub: c.acquire.enableScihub,
        scihubDomain: c.acquire.scihubDomain,
        institutionalProxyUrl: c.acquire.institutionalProxyUrl,
        perSourceTimeoutMs: c.acquire.perSourceTimeoutMs,
        maxRedirects: c.acquire.maxRedirects,
        maxRetries: c.acquire.maxRetries,
        retryDelayMs: c.acquire.retryDelayMs,
        scihubMaxTotalMs: c.acquire.scihubMaxTotalMs,
        tarMaxExtractBytes: c.acquire.tarMaxExtractBytes,
        enableChinaInstitutional: c.acquire.enableChinaInstitutional,
        chinaInstitutionId: c.acquire.chinaInstitutionId,
        chinaCustomIdpEntityId: c.acquire.chinaCustomIdpEntityId,
        enableCnki: c.acquire.enableCnki,
        enableWanfang: c.acquire.enableWanfang,
        proxyEnabled: c.acquire.proxyEnabled,
        proxyUrl: c.acquire.proxyUrl,
        proxyMode: c.acquire.proxyMode,
      },
      discovery: {
        searchBackend: c.discovery.searchBackend ?? 'openalex',
        traversalDepth: c.discovery.traversalDepth,
        maxResultsPerQuery: c.discovery.maxResultsPerQuery,
        concurrency: c.discovery.concurrency,
      },
      analysis: {
        maxTokensPerChunk: c.analysis.maxTokensPerChunk,
        overlapTokens: c.analysis.overlapTokens,
        ocrEnabled: c.analysis.ocrEnabled,
        vlmEnabled: c.analysis.vlmEnabled,
        autoSuggestConcepts: c.analysis.autoSuggestConcepts,
      },
      language: {
        internalWorkingLanguage: c.language.internalWorkingLanguage,
        defaultOutputLanguage: c.language.defaultOutputLanguage,
        uiLocale: c.language.uiLocale,
      },
      contextBudget: {
        focusedMaxTokens: c.contextBudget.focusedMaxTokens,
        broadMaxTokens: c.contextBudget.broadMaxTokens,
        outputReserveRatio: c.contextBudget.outputReserveRatio,
        safetyMarginRatio: c.contextBudget.safetyMarginRatio,
        skipRerankerThreshold: c.contextBudget.skipRerankerThreshold,
        costPreference: c.contextBudget.costPreference,
      },
      apiKeys: {
        anthropicApiKey: maskKey(c.apiKeys.anthropicApiKey),
        openaiApiKey: maskKey(c.apiKeys.openaiApiKey),
        geminiApiKey: maskKey(c.apiKeys.geminiApiKey),
        deepseekApiKey: maskKey(c.apiKeys.deepseekApiKey),
        semanticScholarApiKey: maskKey(c.apiKeys.semanticScholarApiKey),
        openalexApiKey: maskKey(c.apiKeys.openalexApiKey),
        unpaywallEmail: c.apiKeys.unpaywallEmail,
        cohereApiKey: maskKey(c.apiKeys.cohereApiKey),
        jinaApiKey: maskKey(c.apiKeys.jinaApiKey),
        siliconflowApiKey: maskKey(c.apiKeys.siliconflowApiKey),
        doubaoApiKey: maskKey(c.apiKeys.doubaoApiKey),
        kimiApiKey: maskKey(c.apiKeys.kimiApiKey),
        webSearchApiKey: maskKey(c.apiKeys.webSearchApiKey),
      },
      webSearch: {
        enabled: c.webSearch?.enabled ?? false,
        backend: c.webSearch?.backend ?? 'tavily',
      },
      workspace: {
        baseDir: c.workspace.baseDir,
      },
      personalization: {
        authorDisplayThreshold: c.personalization?.authorDisplayThreshold ?? 1,
      },
      ai: {
        proactiveSuggestions: (c as any).ai?.proactiveSuggestions ?? false,
      },
      appearance: {
        colorScheme: (c as any).appearance?.colorScheme ?? 'system',
        accentColor: (c as any).appearance?.accentColor ?? '#3B82F6',
        fontSize: (c as any).appearance?.fontSize ?? 'base',
        animationEnabled: (c as any).appearance?.animationEnabled ?? true,
      },
    };
  });

  // ── settings:updateSection ──
  typedHandler('settings:updateSection', logger, async (_e, section, patch) => {
    // Sections stored in global config
    const globalSections = ['llm', 'rag', 'acquire', 'apiKeys', 'webSearch'];
    const appDataDir = app.getPath('userData');

    if (globalSections.includes(section)) {
      saveGlobalConfig(appDataDir, { [section]: patch } as any);
    } else {
      // Workspace-level sections
      await saveWorkspaceConfig(ctx.workspaceRoot, section, patch);
    }

    // Reload config and propagate via ConfigProvider
    const globalConfig = loadGlobalConfig(appDataDir);
    const newConfig = ConfigLoader.loadFromWorkspace(ctx.workspaceRoot, globalConfig);
    ctx.configProvider.update(newConfig);

    // Propagate AI config changes to SessionOrchestrator at runtime
    if (section === 'ai' && 'proactiveSuggestions' in patch) {
      ctx.sessionOrchestrator?.setProactiveEnabled(!!patch['proactiveSuggestions']);
    }

    logger.info('Settings updated', {
      section,
      keys: Object.keys(patch),
      ...(section === 'acquire' ? {
        enableCnki: newConfig.acquire.enableCnki,
        enableWanfang: newConfig.acquire.enableWanfang,
      } : {}),
    });

    ctx.pushManager?.pushSettingsChanged({
      section,
      keys: Object.keys(patch),
    });
  });

  // ── settings:updateApiKey ──
  typedHandler('settings:updateApiKey', logger, async (_e, keyName, value) => {
    const appDataDir = app.getPath('userData');
    const currentGlobal = loadGlobalConfig(appDataDir);
    const updatedKeys = { ...currentGlobal.apiKeys, [keyName]: value || null };
    saveGlobalConfig(appDataDir, { apiKeys: updatedKeys });

    // Reload config and propagate via ConfigProvider
    const globalConfig = loadGlobalConfig(appDataDir);
    const newConfig = ConfigLoader.loadFromWorkspace(ctx.workspaceRoot, globalConfig);
    ctx.configProvider.update(newConfig);

    logger.info('API key updated', { keyName: keyName.replace(/Key$/, '') });

    ctx.pushManager?.pushSettingsChanged({
      section: 'apiKeys',
      keys: [keyName],
    });
  });

  // ── settings:testApiKey ──
  typedHandler('settings:testApiKey', logger, async (_e, provider) => {
    return testConfiguredApiKey(provider, ctx.config.apiKeys);
  });

  // ── settings:testApiKeyDirect ──
  // Like testApiKey but accepts the key value directly (used by project wizard before workspace exists)
  typedHandler('settings:testApiKeyDirect', logger, async (_e, provider, apiKey) => {
    return testApiKeyDirect(provider, apiKey);
  });

  // ── settings:getDbStats ──
  typedHandler('settings:getDbStats', logger, async (): Promise<DbStatsInfo> => {
    try {
      const stats = (await ctx.dbProxy.getStats()) as any;
      const dbPath = path.join(ctx.workspaceRoot, '.abyssal', 'abyssal.db');
      let dbSizeBytes = 0;
      try {
        dbSizeBytes = (await fsp.stat(dbPath)).size;
      } catch { /* file may not exist */ }

      return {
        paperCount: stats?.papers?.total ?? 0,
        analyzedCount: stats?.papers?.analyzed ?? 0,
        conceptCount: stats?.concepts?.total ?? 0,
        mappingCount: stats?.mappings?.total ?? 0,
        chunkCount: stats?.chunks?.total ?? 0,
        dbSizeBytes,
        embeddingModel: ctx.config.rag.embeddingModel,
        embeddingDimension: ctx.config.rag.embeddingDimension,
      };
    } catch {
      return {
        paperCount: 0,
        analyzedCount: 0,
        conceptCount: 0,
        mappingCount: 0,
        chunkCount: 0,
        dbSizeBytes: 0,
        embeddingModel: ctx.config.rag.embeddingModel,
        embeddingDimension: ctx.config.rag.embeddingDimension,
      };
    }
  });

  // ── settings:getSystemInfo ──
  typedHandler('settings:getSystemInfo', logger, async () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    nodeVersion: process.versions.node ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
  }));

  // ── settings:openWorkspaceFolder ──
  typedHandler('settings:openWorkspaceFolder', logger, async () => {
    shell.openPath(ctx.workspaceRoot);
  });

  // ── settings:getIndexHealth ──
  // 向量引擎诊断汇总——供 Settings > Index Health 面板使用
  typedHandler('settings:getIndexHealth', logger, async () => {
    const rag = ctx.ragModule;
    if (!rag) {
      return {
        available: false,
        degraded: false,
        degradedReason: 'RagService not initialized',
        vectorConsistency: null,
        vectorSamples: [],
        chunkStats: [],
      };
    }
    try {
      const diag = await rag.getDiagnosticsSummary();
      return { available: true, ...diag };
    } catch (err) {
      return {
        available: false,
        degraded: rag.degraded,
        degradedReason: (err as Error).message,
        vectorConsistency: null,
        vectorSamples: [],
        chunkStats: [],
      };
    }
  });

  // ── settings:rebuildIntentEmbeddings ──
  typedHandler('settings:rebuildIntentEmbeddings', logger, async () => {
    // Lazy-import to avoid circular dependency at module load time
    const { getOrCreateCopilotRuntime } = await import('./copilot-handler');
    const runtime = getOrCreateCopilotRuntime(ctx);
    await runtime.rebuildIntentEmbeddings();
    logger.info('Intent embeddings rebuilt via settings trigger');
  });
}
