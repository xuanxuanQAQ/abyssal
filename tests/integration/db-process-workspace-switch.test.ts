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
});