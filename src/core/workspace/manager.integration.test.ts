import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { WorkspaceManager } from './manager';
import { getWorkspacePaths, isWorkspace } from './scaffold';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('WorkspaceManager integration', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a workspace scaffold and records it in recent workspaces', () => {
    const appDataDir = makeTempDir('abyssal-workspace-manager-');
    const workspaceRoot = path.join(makeTempDir('abyssal-workspace-root-'), 'alpha');
    createdDirs.push(appDataDir, path.dirname(workspaceRoot));

    const manager = new WorkspaceManager(appDataDir);
    const result = manager.createWorkspace({
      rootDir: workspaceRoot,
      name: 'Alpha Project',
      description: 'workspace for integration tests',
    });

    const paths = getWorkspacePaths(workspaceRoot);
    const recent = manager.getRecentWorkspaces();

    expect(result.meta.name).toBe('Alpha Project');
    expect(isWorkspace(workspaceRoot)).toBe(true);
    expect(fs.existsSync(paths.config)).toBe(true);
    expect(fs.existsSync(path.join(paths.pdfs, '.gitkeep'))).toBe(true);
    expect(recent).toEqual([
      expect.objectContaining({
        path: path.resolve(workspaceRoot),
        name: 'Alpha Project',
        pinned: false,
      }),
    ]);
  });

  it('reopens an existing workspace without duplicating the recent entry and preserves pin state', () => {
    const appDataDir = makeTempDir('abyssal-workspace-manager-');
    const rootParent = makeTempDir('abyssal-workspace-root-');
    const firstWorkspace = path.join(rootParent, 'first');
    const secondWorkspace = path.join(rootParent, 'second');
    createdDirs.push(appDataDir, rootParent);

    const manager = new WorkspaceManager(appDataDir);
    manager.createWorkspace({ rootDir: firstWorkspace, name: 'First' });
    expect(manager.togglePin(firstWorkspace)).toBe(true);
    manager.createWorkspace({ rootDir: secondWorkspace, name: 'Second' });

    const reopenedMeta = manager.openWorkspace(firstWorkspace);
    const recent = manager.getRecentWorkspaces();

    expect(reopenedMeta?.name).toBe('First');
    expect(recent.filter((entry) => entry.path === path.resolve(firstWorkspace))).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      path: path.resolve(firstWorkspace),
      name: 'First',
      pinned: true,
    });
  });

  it('reports damaged metadata and missing required directories during validation', () => {
    const appDataDir = makeTempDir('abyssal-workspace-manager-');
    const workspaceRoot = path.join(makeTempDir('abyssal-workspace-root-'), 'broken');
    createdDirs.push(appDataDir, path.dirname(workspaceRoot));

    const manager = new WorkspaceManager(appDataDir);
    manager.createWorkspace({ rootDir: workspaceRoot, name: 'Broken Workspace' });

    const paths = getWorkspacePaths(workspaceRoot);
    fs.writeFileSync(paths.marker, '{invalid-json', 'utf-8');
    fs.rmSync(paths.pdfs, { recursive: true, force: true });

    const result = manager.validateWorkspace(workspaceRoot);

    expect(result.valid).toBe(false);
    expect(result.meta).toBeNull();
    expect(result.paths).toBeNull();
    expect(result.issues).toContain('工作区元数据文件损坏');
    expect(result.issues).toContain('缺少 pdfs/ 目录');
  });

  it('prunes deleted workspaces from the recent list when reading recents', () => {
    const appDataDir = makeTempDir('abyssal-workspace-manager-');
    const workspaceParent = makeTempDir('abyssal-workspace-root-');
    const workspaceRoot = path.join(workspaceParent, 'ephemeral');
    createdDirs.push(appDataDir, workspaceParent);

    const manager = new WorkspaceManager(appDataDir);
    manager.createWorkspace({ rootDir: workspaceRoot, name: 'Ephemeral' });

    fs.rmSync(workspaceRoot, { recursive: true, force: true });

    expect(manager.getRecentWorkspaces()).toEqual([]);
  });
});