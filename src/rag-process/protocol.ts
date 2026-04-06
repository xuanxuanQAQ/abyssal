import type { AbyssalConfig } from '../core/types/config';
import type { LogLevel } from '../core/infra/logger';

export interface RagRuntimeState {
  available: boolean;
  degraded: boolean;
  degradedReason: string | null;
}

export interface RagInitPayload {
  workspaceRoot: string;
  config: AbyssalConfig;
  logLevel?: LogLevel;
}

export interface RagUpdateConfigPayload {
  config: AbyssalConfig;
}

export interface RagLifecycleRequest {
  type: 'lifecycle';
  action: 'init' | 'update-config' | 'close';
  payload?: RagInitPayload | RagUpdateConfigPayload;
}

export interface RagLifecycleResponse {
  type: 'lifecycle';
  action: 'ready' | 'init' | 'update-config' | 'close';
  success: boolean;
  error?: string;
  state?: RagRuntimeState;
}

export interface RagRequest {
  id: string;
  method: 'embedAndIndexChunks' | 'searchSemantic' | 'retrieve' | 'getDiagnosticsSummary';
  args: unknown[];
}

export interface RagResponse {
  id: string;
  result?: unknown;
  error?: {
    name: string;
    message: string;
  };
}

export function isRagLifecycleResponse(value: unknown): value is RagLifecycleResponse {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown }).type === 'lifecycle'
    && typeof (value as { action?: unknown }).action === 'string';
}