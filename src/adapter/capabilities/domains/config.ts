/**
 * Config Capability — application settings management.
 *
 * Allows the AI to read and update configuration sections.
 */

import type { Capability } from '../types';

// Sections the AI is allowed to modify.
// Sensitive sections (apiKeys, workspace) are excluded — they require
// explicit user action via the Settings UI.
const WRITABLE_SECTIONS = new Set([
  'llm', 'rag', 'acquire', 'discovery', 'analysis', 'language',
  'contextBudget', 'webSearch', 'personalization', 'ai', 'appearance',
]);

// Sections excluded from AI read (contain secrets).
const REDACTED_SECTIONS = new Set(['apiKeys']);

export function createConfigCapability(): Capability {
  return {
    name: 'config',
    domain: 'config',
    description: 'Application settings — read and update configuration',
    routeFamilies: ['config_diagnostic', 'workspace_control'],
    operations: [
      {
        name: 'get_settings',
        description: 'Get the current application settings.',
        routeFamilies: ['config_diagnostic', 'workspace_control'],
        semanticKeywords: ['设置', '查看设置', '获取配置', 'settings', 'config', 'get', '显示'],
        params: [
          { name: 'section', type: 'string', description: 'Settings section to retrieve (e.g., "llm", "rag", "acquire", "appearance"). Omit for all.' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.configProvider) {
            return { success: false, summary: 'Config provider not available' };
          }

          const config = ctx.services.configProvider.config;
          if (params['section']) {
            const sectionName = params['section'] as string;
            if (REDACTED_SECTIONS.has(sectionName)) {
              return { success: false, summary: `Section "${sectionName}" contains credentials and cannot be read by AI` };
            }
            const section = (config as Record<string, unknown>)[sectionName];
            if (section === undefined) {
              return { success: false, summary: `Unknown settings section: ${sectionName}` };
            }
            return { success: true, data: section, summary: `Retrieved settings for section "${sectionName}"` };
          }

          // Return all sections except redacted ones
          const safe: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
            if (!REDACTED_SECTIONS.has(key)) safe[key] = value;
          }
          return { success: true, data: safe, summary: 'Retrieved all settings' };
        },
      },
      {
        name: 'update_settings',
        description: [
          'Update application settings. Changes take effect immediately.',
          `Writable sections: ${[...WRITABLE_SECTIONS].join(', ')}.`,
          'Sections like apiKeys and workspace require user action in the Settings UI.',
        ].join(' '),
        routeFamilies: ['workspace_control', 'config_diagnostic'],
        semanticKeywords: ['修改设置', '更新设置', '切换模型', '配置', 'update', 'change', '启用', '禁用',
          '主题', '暗色', '亮色', 'theme', 'dark', 'light', 'appearance'],
        params: [
          {
            name: 'section', type: 'string',
            description: `Settings section to update. Must be one of: ${[...WRITABLE_SECTIONS].join(', ')}`,
            required: true,
          },
          { name: 'patch', type: 'object', description: 'Key-value pairs to update', required: true },
          { name: 'reason', type: 'string', description: 'Reason for the change (shown to user)' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.configProvider?.update) {
            return { success: false, summary: 'Config update not available' };
          }

          const section = params['section'] as string;
          const patch = params['patch'] as Record<string, unknown>;
          const reason = (params['reason'] as string) ?? 'AI-initiated settings update';

          if (!WRITABLE_SECTIONS.has(section)) {
            return {
              success: false,
              summary: `Section "${section}" cannot be modified by AI. Writable sections: ${[...WRITABLE_SECTIONS].join(', ')}`,
            };
          }

          await ctx.services.configProvider.update(section, patch);

          ctx.eventBus.emit({
            type: 'ai:updateSettings',
            section,
            patch,
            reason,
          });

          ctx.eventBus.emit({
            type: 'ai:notify',
            level: 'info',
            title: 'Settings Updated',
            message: `${section}: ${Object.keys(patch).join(', ')} — ${reason}`,
          });

          return {
            success: true,
            data: { section, updatedKeys: Object.keys(patch) },
            summary: `Updated settings: ${section}.{${Object.keys(patch).join(', ')}}`,
            emittedEvents: ['ai:updateSettings', 'ai:notify'],
          };
        },
      },
      {
        name: 'test_api',
        description: 'Test whether a configured provider API key is available and reachable.',
        routeFamilies: ['config_diagnostic'],
        semanticKeywords: ['测试api', 'test', '检查', '可用', 'api key', '连接', '诊断', 'provider'],
        params: [
          {
            name: 'provider',
            type: 'string',
            description: 'Provider to test',
            required: true,
            enumValues: ['anthropic', 'openai', 'gemini', 'deepseek', 'cohere', 'jina', 'siliconflow', 'tavily'],
          },
          { name: 'apiKey', type: 'string', description: 'Optional API key override. If omitted, uses the configured key.' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.apiDiagnostics) {
            return { success: false, summary: 'API diagnostics service not available' };
          }

          const provider = params['provider'] as string;
          const apiKey = typeof params['apiKey'] === 'string' ? params['apiKey'] : undefined;
          const result = await ctx.services.apiDiagnostics.testProvider(provider, apiKey);

          return {
            success: result.ok,
            data: { provider, ...result },
            summary: result.ok
              ? `Provider ${provider} is reachable`
              : `Provider ${provider} check failed: ${result.message}`,
          };
        },
      },
    ],
  };
}
