/**
 * CapabilityRegistry — central registry for all domain capabilities.
 *
 * Manages capability registration, discovery, and execution.
 * Bridges capabilities to LLM tool definitions for the AgentLoop.
 */

import type {
  Capability,
  CapabilityOperation,
  CapabilityToolDefinition,
  OperationContext,
  OperationResult,
  CapabilityServices,
} from './types';
import type { ResearchSession } from '../../core/session';
import type { EventBus } from '../../core/event-bus';
import type { ToolDefinition } from '../llm-client/llm-client';

// ─── Registry ───

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();
  private readonly session: ResearchSession;
  private readonly eventBus: EventBus;
  private readonly services: CapabilityServices;
  private readonly logger: (msg: string, data?: unknown) => void;

  constructor(
    session: ResearchSession,
    eventBus: EventBus,
    services: CapabilityServices,
    logger?: (msg: string, data?: unknown) => void,
  ) {
    this.session = session;
    this.eventBus = eventBus;
    this.services = services;
    this.logger = logger ?? (() => {});
  }

  /**
   * Register a capability.
   */
  register(capability: Capability): void {
    if (this.capabilities.has(capability.name)) {
      throw new Error(`Capability "${capability.name}" is already registered`);
    }
    this.capabilities.set(capability.name, capability);
  }

  /**
   * Get a capability by name.
   */
  get(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  /**
   * List all registered capabilities.
   */
  list(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Find an operation by fully qualified name (capability--operation).
   * Also accepts legacy dot notation (capability.operation) for internal callers.
   */
  findOperation(qualifiedName: string): { capability: Capability; operation: CapabilityOperation } | null {
    const sep = qualifiedName.includes('--') ? '--' : '.';
    const idx = qualifiedName.indexOf(sep);
    if (idx < 0) return null;
    const capName = qualifiedName.slice(0, idx);
    const opName = qualifiedName.slice(idx + sep.length);
    if (!capName || !opName) return null;

    const capability = this.capabilities.get(capName);
    if (!capability) return null;

    const operation = capability.operations.find((op) => op.name === opName);
    if (!operation) return null;

    return { capability, operation };
  }

  /**
   * Execute an operation by qualified name.
   */
  async execute(qualifiedName: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<OperationResult> {
    const found = this.findOperation(qualifiedName);
    if (!found) {
      this.logger('[Capability] Unknown operation', { qualifiedName });
      return { success: false, summary: `Unknown capability operation: ${qualifiedName}` };
    }

    const ctx: OperationContext = {
      session: this.session,
      eventBus: this.eventBus,
      services: this.services,
      ...(signal !== undefined && { signal }),
    };

    const startMs = Date.now();
    this.logger('[Capability] Execute', {
      op: qualifiedName,
      domain: found.capability.domain,
      permission: found.operation.permissionLevel,
      paramKeys: Object.keys(params),
    });

    try {
      const result = await found.operation.execute(params, ctx);
      this.logger('[Capability] Result', {
        op: qualifiedName,
        success: result.success,
        durationMs: Date.now() - startMs,
        hasData: result.data !== undefined,
        events: result.emittedEvents,
      });
      return result;
    } catch (err) {
      this.logger('[Capability] Error', {
        op: qualifiedName,
        error: (err as Error).message,
        durationMs: Date.now() - startMs,
      });
      return {
        success: false,
        summary: `Error executing ${qualifiedName}: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Convert all capabilities to LLM tool definitions.
   * Each operation becomes a separate tool named "capability--operation".
   */
  toToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const cap of this.capabilities.values()) {
      for (const op of cap.operations) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const param of op.params) {
          const prop: Record<string, unknown> = {
            type: param.type,
            description: param.description,
          };
          if (param.enumValues) prop['enum'] = param.enumValues;
          if (param.itemType) prop['items'] = { type: param.itemType };
          if (param.default !== undefined) prop['default'] = param.default;
          properties[param.name] = prop;
          if (param.required) required.push(param.name);
        }

        tools.push({
          name: `${cap.name}--${op.name}`,
          description: `[${cap.domain}] ${op.description}`,
          inputSchema: {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        });
      }
    }

    return tools;
  }

  /**
   * Convert to CapabilityToolDefinition array (includes metadata).
   */
  toCapabilityToolDefinitions(): CapabilityToolDefinition[] {
    const tools: CapabilityToolDefinition[] = [];

    for (const cap of this.capabilities.values()) {
      for (const op of cap.operations) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const param of op.params) {
          const prop: Record<string, unknown> = {
            type: param.type,
            description: param.description,
          };
          if (param.enumValues) prop['enum'] = param.enumValues;
          if (param.itemType) prop['items'] = { type: param.itemType };
          properties[param.name] = prop;
          if (param.required) required.push(param.name);
        }

        tools.push({
          name: `${cap.name}--${op.name}`,
          description: `[${cap.domain}] ${op.description}`,
          inputSchema: {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
          capabilityName: cap.name,
          operationName: op.name,
          permissionLevel: op.permissionLevel,
        });
      }
    }

    return tools;
  }

  /** Total number of operations across all capabilities */
  get operationCount(): number {
    let count = 0;
    for (const cap of this.capabilities.values()) count += cap.operations.length;
    return count;
  }
}
