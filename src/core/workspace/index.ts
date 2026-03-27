/**
 * Workspace Module — 公共接口
 */

export {
  scaffoldWorkspace,
  isWorkspace,
  readWorkspaceMeta,
  getWorkspacePaths,
  type WorkspaceMeta,
  type ScaffoldOptions,
  type ScaffoldResult,
} from './scaffold';

export {
  WorkspaceManager,
  type RecentWorkspaceEntry,
} from './manager';

export {
  tryDelete,
  tryDeleteDir,
  atomicWrite,
  cleanTmpFiles,
  moveToOrphaned,
  moveDirToOrphaned,
} from './file-ops';

export {
  checkFilesystemIntegrity,
  calculateDiskUsage,
  type FilesystemIntegrityReport,
  type DiskUsage,
} from './integrity-fs';
