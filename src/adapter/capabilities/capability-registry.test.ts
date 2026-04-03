import { describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry } from './capability-registry';
import type { Capability } from './types';

function makeRegistry() {
  return new CapabilityRegistry(
    {} as any,
    {} as any,
    {} as any,
    vi.fn(),
  );
}

describe('CapabilityRegistry tool filtering', () => {
  it('filters tools by allowed route families', () => {
    const registry = makeRegistry();

    const capability: Capability = {
      name: 'config',
      domain: 'config',
      description: 'config tools',
      operations: [
        {
          name: 'test_api',
          description: 'test provider',
          params: [],
          permissionLevel: 0,
          routeFamilies: ['config_diagnostic'],
          execute: async () => ({ success: true, summary: 'ok' }),
        },
        {
          name: 'update_settings',
          description: 'update settings',
          params: [],
          permissionLevel: 1,
          routeFamilies: ['workspace_control'],
          execute: async () => ({ success: true, summary: 'ok' }),
        },
      ],
    };

    registry.register(capability);

    const tools = registry.toToolDefinitions({ allowedFamilies: ['config_diagnostic'] });
    expect(tools.map((tool) => tool.name)).toEqual(['config--test_api']);
  });
});