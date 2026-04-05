import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsData } from '../../../../shared-types/models';
import { useSettingsEditor } from './useSettingsEditor';

const getAllMock = vi.fn();
const updateSectionMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const translateMock = vi.hoisted(() =>
  (key: string, params?: Record<string, unknown>) => {
    if (key === 'settings.saveFailed') {
      return `save failed: ${String(params?.message ?? '')}`;
    }
    return key;
  }
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translateMock,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('../../../core/ipc/bridge', () => ({
  getAPI: () => ({
    settings: {
      getAll: getAllMock,
      updateSection: updateSectionMock,
    },
  }),
}));

let latestHook: ReturnType<typeof useSettingsEditor> | null = null;

function Harness() {
  latestHook = useSettingsEditor();
  return null;
}

const baseSettings = {
  project: { name: 'Base Project', description: 'Base Description' },
} as SettingsData;

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSettingsEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    getAllMock.mockReset();
    updateSectionMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    latestHook = null;
    getAllMock.mockResolvedValue(baseSettings);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });
    await flushPromises();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('clears failed pending patches before the next edit is saved', async () => {
    updateSectionMock
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    act(() => {
      latestHook?.updateSection('project', { name: 'Renamed Project' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await flushPromises();
    await flushPromises();

    expect(latestHook?.settings?.project.name).toBe('Base Project');

    act(() => {
      latestHook?.updateSection('project', { description: 'New Description' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await flushPromises();

    expect(updateSectionMock).toHaveBeenNthCalledWith(1, 'project', { name: 'Renamed Project' });
    expect(updateSectionMock).toHaveBeenNthCalledWith(2, 'project', { description: 'New Description' });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});