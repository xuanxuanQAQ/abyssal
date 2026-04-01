export { CapabilityRegistry } from './capability-registry';
export type {
  Capability, CapabilityDomain, CapabilityOperation,
  CapabilityToolDefinition, OperationContext, OperationResult,
  OperationParam, PermissionLevel, CapabilityServices,
} from './types';
export {
  createReaderCapability, createAnalysisCapability, createNotesCapability,
  createDiscoveryCapability, createGraphCapability, createWritingCapability,
  createUICapability, createConfigCapability,
} from './domains';

// ─── Convenience: register all built-in capabilities ───

import { CapabilityRegistry } from './capability-registry';
import {
  createReaderCapability, createAnalysisCapability, createNotesCapability,
  createDiscoveryCapability, createGraphCapability, createWritingCapability,
  createUICapability, createConfigCapability,
} from './domains';
import type { CapabilityServices } from './types';
import type { ResearchSession } from '../../core/session';
import type { EventBus } from '../../core/event-bus';

/**
 * Create a CapabilityRegistry with all built-in domain capabilities registered.
 */
export function createCapabilityRegistry(
  session: ResearchSession,
  eventBus: EventBus,
  services: CapabilityServices,
  logger?: (msg: string, data?: unknown) => void,
): CapabilityRegistry {
  const registry = new CapabilityRegistry(session, eventBus, services, logger);

  registry.register(createReaderCapability());
  registry.register(createAnalysisCapability());
  registry.register(createNotesCapability());
  registry.register(createDiscoveryCapability());
  registry.register(createGraphCapability());
  registry.register(createWritingCapability());
  registry.register(createUICapability());
  registry.register(createConfigCapability());

  return registry;
}
