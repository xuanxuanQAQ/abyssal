/**
 * Config Capability — application settings management.
 *
 * Allows the AI to read and update configuration sections.
 */

import type { Capability } from '../types';

export function createConfigCapability(): Capability {
  return {
    name: 'config',
    domain: 'config',
    description: 'Application settings — read and update configuration',
    operations: [
      {
        name: 'get_settings',
        description: 'Get the current application settings.',
        params: [
          { name: 'section', type: 'string', description: 'Settings section to retrieve (e.g., "llm", "rag", "acquire"). Omit for all.' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.configProvider) {
            return { success: false, summary: 'Config provider not available' };
          }

          const config = ctx.services.configProvider.config;
          if (params['section']) {
            const section = (config as Record<string, unknown>)[params['section'] as string];
            if (section === undefined) {
              return { success: false, summary: `Unknown settings section: ${params['section']}` };
            }
            return { success: true, data: section, summary: `Retrieved settings for section "${params['section']}"` };
          }

          return { success: true, data: config, summary: 'Retrieved all settings' };
        },
      },
      {
        name: 'update_settings',
        description: 'Update application settings. Changes take effect immediately.',
        params: [
          { name: 'section', type: 'string', description: 'Settings section to update', required: true },
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
    ],
  };
}
