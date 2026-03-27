/**
 * IPC handler: snapshots namespace
 *
 * Contract channels: fs:createSnapshot, fs:restoreSnapshot,
 *                    fs:listSnapshots, fs:cleanupSnapshots
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerSnapshotsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('fs:createSnapshot', logger, async (_e, _name) => {
    // TODO: delegate to dbProxy.createSnapshot(name)
    throw new Error('Not implemented');
  });

  typedHandler('fs:restoreSnapshot', logger, async (_e, _snapshotId) => {
    // TODO: delegate to dbProxy.restoreSnapshot(snapshotId)
  });

  typedHandler('fs:listSnapshots', logger, async () => {
    // TODO: delegate to dbProxy.listSnapshots()
    return [];
  });

  typedHandler('fs:cleanupSnapshots', logger, async (_e, _policy) => {
    // TODO: delegate to dbProxy.cleanupSnapshots(policy)
  });
}
