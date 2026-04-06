import { beforeEach, describe, expect, it, vi } from 'vitest';

const registrations = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>());

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('./register', () => ({
  typedHandler: (channel: string, _logger: unknown, handler: (...args: unknown[]) => Promise<unknown>) => {
    registrations.set(channel, handler);
  },
}));

import { registerSystemHandlers } from './system-handler';

describe('system graph IPC handlers', () => {
  const getRelationGraph = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    registrations.clear();
    getRelationGraph.mockReset();
    registerSystemHandlers({
      logger,
      workspaceRoot: 'C:/workspace',
      dbProxy: {
        getRelationGraph,
      },
    } as never);
  });

  it('maps GraphFilter into the database graph filter contract', async () => {
    getRelationGraph.mockResolvedValue({ nodes: [], edges: [] });
    const handler = registrations.get('db:relations:getGraph');

    await handler?.({} as never, {
      focusNodeId: 'concept-1',
      focusNodeType: 'concept',
      hopDepth: 'global',
      layers: {
        citation: true,
        conceptAgree: false,
        conceptConflict: true,
        conceptExtend: false,
        semanticNeighbor: true,
        notes: false,
      },
      similarityThreshold: 0.77,
      includeConcepts: true,
      includeNotes: true,
    });

    expect(getRelationGraph).toHaveBeenCalledWith({
      centerId: undefined,
      centerType: 'concept',
      depth: undefined,
      edgeTypes: ['citation', 'conceptConflict', 'semanticNeighbor'],
      similarityThreshold: 0.77,
      includeConcepts: true,
      includeNotes: true,
    });
  });

  it('requests paper neighborhoods with all enabled graph layers', async () => {
    getRelationGraph.mockResolvedValue({ nodes: [], edges: [] });
    const handler = registrations.get('db:relations:getNeighborhood');

    await handler?.({} as never, 'paper-9', 1, {
      citation: true,
      conceptAgree: true,
      conceptConflict: true,
      conceptExtend: false,
      semanticNeighbor: true,
      notes: false,
    });

    expect(getRelationGraph).toHaveBeenCalledWith({
      centerId: 'paper-9',
      centerType: 'paper',
      depth: 1,
      edgeTypes: ['citation', 'conceptAgree', 'conceptConflict', 'semanticNeighbor'],
      includeConcepts: true,
      includeNotes: true,
    });
  });
});