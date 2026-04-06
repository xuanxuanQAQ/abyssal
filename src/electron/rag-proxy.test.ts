import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.fn();

vi.mock('node:child_process', () => ({
  fork: (...args: unknown[]) => forkMock(...args),
}));

import { createRagProcessProxy } from './rag-proxy';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  sent: unknown[] = [];
  responder: ((message: unknown) => void) | null = null;

  send(message: unknown): void {
    this.sent.push(message);
    this.responder?.(message);
  }

  kill(): void {
    this.killed = true;
    this.emit('exit', 0, null);
  }
}

describe('RagProcessProxy', () => {
  let child: FakeChild;

  beforeEach(() => {
    child = new FakeChild();
    forkMock.mockReset();
    forkMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit('message', {
          type: 'lifecycle',
          action: 'ready',
          success: true,
          state: { available: false, degraded: false, degradedReason: null },
        });
      });
      return child;
    });
  });

  it('starts, forwards calls, updates config, and closes', async () => {
    child.responder = (message) => {
      const lifecycle = message as { type?: string; action?: string; payload?: Record<string, unknown> };
      if (lifecycle.type === 'lifecycle') {
        if (lifecycle.action === 'init') {
          queueMicrotask(() => {
            child.emit('message', {
              type: 'lifecycle',
              action: 'init',
              success: true,
              state: { available: true, degraded: false, degradedReason: null },
            });
          });
          return;
        }
        if (lifecycle.action === 'update-config') {
          queueMicrotask(() => {
            child.emit('message', {
              type: 'lifecycle',
              action: 'update-config',
              success: true,
              state: { available: true, degraded: true, degradedReason: 'dimension mismatch' },
            });
          });
          return;
        }
        if (lifecycle.action === 'close') {
          queueMicrotask(() => {
            child.emit('message', {
              type: 'lifecycle',
              action: 'close',
              success: true,
              state: { available: false, degraded: false, degradedReason: null },
            });
          });
        }
        return;
      }

      const request = message as { id: string; method: string };
      if (request.method === 'searchSemantic') {
        queueMicrotask(() => {
          child.emit('message', {
            id: request.id,
            result: [{ chunkId: 'ck1', score: 0.9 }],
          });
        });
      }
    };

    const proxy = createRagProcessProxy({ timeoutMs: 1000 });
    await proxy.start({
      workspaceRoot: 'C:/workspace',
      logLevel: 'info',
      config: {
        project: { name: 'ws', description: '' },
        acquire: {} as any,
        discovery: {} as any,
        analysis: {} as any,
        rag: { embeddingProvider: 'siliconflow', embeddingModel: 'BAAI/bge-m3', embeddingDimension: 1024 } as any,
        language: {} as any,
        llm: {} as any,
        apiKeys: { siliconflowApiKey: 'sk-test' } as any,
        workspace: { baseDir: 'workspace' } as any,
        concepts: {} as any,
        contextBudget: {} as any,
        conceptChange: {} as any,
        notes: {} as any,
        batch: {} as any,
        advisory: {} as any,
        logging: { level: 'info' } as any,
        writing: {} as any,
        personalization: {} as any,
        ai: { proactiveSuggestions: false },
        webSearch: {} as any,
        appearance: {} as any,
      },
    });

    const results = await proxy.searchSemantic('test query', 5);
    expect(results).toEqual([{ chunkId: 'ck1', score: 0.9 }]);

    await proxy.updateConfig({
      project: { name: 'ws', description: '' },
      acquire: {} as any,
      discovery: {} as any,
      analysis: {} as any,
      rag: { embeddingProvider: 'siliconflow', embeddingModel: 'BAAI/bge-m3', embeddingDimension: 1024 } as any,
      language: {} as any,
      llm: {} as any,
      apiKeys: { siliconflowApiKey: 'sk-test-2' } as any,
      workspace: { baseDir: 'workspace' } as any,
      concepts: {} as any,
      contextBudget: {} as any,
      conceptChange: {} as any,
      notes: {} as any,
      batch: {} as any,
      advisory: {} as any,
      logging: { level: 'info' } as any,
      writing: {} as any,
      personalization: {} as any,
      ai: { proactiveSuggestions: false },
      webSearch: {} as any,
      appearance: {} as any,
    });

    expect(proxy.degraded).toBe(true);
    expect(proxy.degradedReason).toBe('dimension mismatch');

    await proxy.close();
    expect(child.killed).toBe(true);
  });
});