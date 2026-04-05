import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DbProxy } from '../../src/db-process/db-proxy';

class FakeChild extends EventEmitter {
  sentMessages: unknown[] = [];

  send(message: unknown): void {
    this.sentMessages.push(message);
  }

  kill(): void {}
}

class StatefulChild extends EventEmitter {
  sentMessages: unknown[] = [];

  constructor(private workspaceRoot: string) {
    super();
  }

  send(message: unknown): void {
    this.sentMessages.push(message);

    const envelope = message as {
      type?: string;
      action?: string;
      payload?: { workspaceRoot?: string };
      id?: string;
      method?: string;
    };

    if (envelope.type === 'lifecycle' && envelope.action === 'switch') {
      queueMicrotask(() => {
        this.workspaceRoot = envelope.payload?.workspaceRoot ?? this.workspaceRoot;
        this.emit('message', { type: 'lifecycle', action: 'switch', success: true });
      });
      return;
    }

    if (envelope.id && envelope.method === 'getWorkspaceLabel') {
      const workspaceAtSend = this.workspaceRoot;
      queueMicrotask(() => {
        this.emit('message', {
          id: envelope.id,
          result: { workspaceRoot: workspaceAtSend },
        });
      });
    }
  }

  kill(): void {}
}

describe('db-process workspace switch', () => {
  it('updates initPayload only after a successful switch response', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new FakeChild();
    (proxy as any).child = child;
    (proxy as any).initPayload = { workspaceRoot: 'C:/ws-old', userDataPath: 'C:/user', skipVecExtension: false };
    (proxy as any).setupMessageHandler();

    const switchPromise = proxy.switchWorkspace({
      workspaceRoot: 'C:/ws-new',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });

    expect((proxy as any).initPayload).toEqual({
      workspaceRoot: 'C:/ws-old',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });

    child.emit('message', { type: 'lifecycle', action: 'switch', success: true });
    await expect(switchPromise).resolves.toBeUndefined();

    expect((proxy as any).initPayload).toEqual({
      workspaceRoot: 'C:/ws-new',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });
  });

  it('preserves the previous initPayload when switch fails', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new FakeChild();
    (proxy as any).child = child;
    (proxy as any).initPayload = { workspaceRoot: 'C:/ws-old', userDataPath: 'C:/user', skipVecExtension: false };
    (proxy as any).setupMessageHandler();

    const switchPromise = proxy.switchWorkspace({
      workspaceRoot: 'C:/ws-new',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });

    child.emit('message', { type: 'lifecycle', action: 'switch', success: false, error: 'permission denied' });

    await expect(switchPromise).rejects.toThrow('Workspace switch failed: permission denied');
    expect((proxy as any).initPayload).toEqual({
      workspaceRoot: 'C:/ws-old',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });
  });

  it('falls back to start() when switching without an existing child process', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const startSpy = vi.spyOn(proxy, 'start').mockResolvedValue(undefined);

    await proxy.switchWorkspace({
      workspaceRoot: 'C:/ws-bootstrap',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });

    expect(startSpy).toHaveBeenCalledWith({
      workspaceRoot: 'C:/ws-bootstrap',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });
  });

  it('routes subsequent queries to the new workspace after a successful switch', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new StatefulChild('C:/ws-old');
    (proxy as any).child = child;
    (proxy as any).initPayload = { workspaceRoot: 'C:/ws-old', userDataPath: 'C:/user', skipVecExtension: false };
    (proxy as any).setupMessageHandler();

    await expect(proxy.call('getWorkspaceLabel')).resolves.toEqual({ workspaceRoot: 'C:/ws-old' });

    await proxy.switchWorkspace({
      workspaceRoot: 'C:/ws-new',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });

    await expect(proxy.call('getWorkspaceLabel')).resolves.toEqual({ workspaceRoot: 'C:/ws-new' });
  });

  it('keeps pending query responses bound to the workspace state at send time', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new StatefulChild('C:/ws-old');
    (proxy as any).child = child;
    (proxy as any).initPayload = { workspaceRoot: 'C:/ws-old', userDataPath: 'C:/user', skipVecExtension: false };
    (proxy as any).setupMessageHandler();

    const pendingOldWorkspaceCall = proxy.call('getWorkspaceLabel');

    await proxy.switchWorkspace({
      workspaceRoot: 'C:/ws-new',
      userDataPath: 'C:/user',
      skipVecExtension: false,
    });

    await expect(pendingOldWorkspaceCall).resolves.toEqual({ workspaceRoot: 'C:/ws-old' });
    await expect(proxy.call('getWorkspaceLabel')).resolves.toEqual({ workspaceRoot: 'C:/ws-new' });
  });
});