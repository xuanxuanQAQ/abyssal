/**
 * IPC handler: snapshots namespace
 *
 * Contract channels: fs:createSnapshot, fs:restoreSnapshot,
 *                    fs:listSnapshots, fs:cleanupSnapshots
 *
 * Not yet implemented — returns structured errors so the frontend
 * can display a "feature not yet available" UI instead of crashing.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerSnapshotsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('fs:createSnapshot', logger, async (_e, _name) => {
    const err = new Error('Snapshot feature is not yet implemented');
    (err as any).code = 'NOT_IMPLEMENTED';
    (err as any).recoverable = true;
    throw err;
  });

  typedHandler('fs:restoreSnapshot', logger, async (_e, _snapshotId) => {
    const err = new Error('Snapshot restore is not yet implemented');
    (err as any).code = 'NOT_IMPLEMENTED';
    (err as any).recoverable = true;
    throw err;
  });

  typedHandler('fs:listSnapshots', logger, async () => {
    return [];
  });

  typedHandler('fs:cleanupSnapshots', logger, async (_e, _policy) => {
    // No-op until snapshot creation is implemented
  });
}
