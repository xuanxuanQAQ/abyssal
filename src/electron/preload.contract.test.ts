import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const invokeMock = vi.fn();
const onMock = vi.fn();
const removeListenerMock = vi.fn();
const sendMock = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke: invokeMock,
    on: onMock,
    removeListener: removeListenerMock,
    send: sendMock,
  },
}));

async function loadApi() {
  vi.resetModules();
  exposeInMainWorld.mockClear();
  await import('./preload');
  return exposeInMainWorld.mock.calls[0]?.[1] as Record<string, any>;
}

describe('preload contract', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    onMock.mockReset();
    removeListenerMock.mockReset();
    sendMock.mockReset();
  });

  it('exposes copilot invoke APIs and push listeners', async () => {
    const api = await loadApi();

    expect(typeof api.copilot.execute).toBe('function');
    expect(typeof api.copilot.abort).toBe('function');
    expect(typeof api.copilot.resume).toBe('function');
    expect(typeof api.copilot.getOperationStatus).toBe('function');
    expect(typeof api.on.copilotEvent).toBe('function');
    expect(typeof api.on.copilotSessionChanged).toBe('function');
  });

  it('exposes article deletion through the renderer bridge', async () => {
    const api = await loadApi();

    expect(typeof api.db.articles.delete).toBe('function');
  });

  it('throws enriched errors for envelope failures', async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      error: { message: 'boom', code: 'ERR_TEST', recoverable: true },
    });
    const api = await loadApi();

    await expect(api.copilot.execute({})).rejects.toMatchObject({
      message: 'boom',
      code: 'ERR_TEST',
      recoverable: true,
    });
  });

  it('throws protocol errors for malformed non-envelope responses', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invokeMock.mockResolvedValue({ arbitrary: 'payload' });
    const api = await loadApi();

    await expect(api.copilot.execute({})).rejects.toThrow(/Malformed IPC response/);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('registers and unregisters push listeners through ipcRenderer', async () => {
    const api = await loadApi();
    const handler = vi.fn();

    const dispose = api.on.copilotEvent(handler);

    expect(onMock).toHaveBeenCalledWith('push:copilotEvent', expect.any(Function));
    const listener = onMock.mock.calls[0]?.[1];
    listener({}, { hello: 'world' });
    expect(handler).toHaveBeenCalledWith({ hello: 'world' });

    dispose();
    expect(removeListenerMock).toHaveBeenCalledWith('push:copilotEvent', listener);
  });
});