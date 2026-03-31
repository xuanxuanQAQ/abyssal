/**
 * Shared utility: bulk-insert bibliography entries into the database.
 * Used by papers-handler (importBibtex) and system-handler (importFiles).
 */

import type { DbProxyInstance } from '../../../db-process/db-proxy';

export interface BibEntry {
  metadata: Record<string, unknown>;
  originalKey: string;
}

export interface BibImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function insertBibEntries(
  dbProxy: DbProxyInstance,
  entries: BibEntry[],
): Promise<BibImportResult> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    try {
      await dbProxy.addPaper(entry.metadata as any);
      imported++;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('UNIQUE') || msg.includes('duplicate')) skipped++;
      else errors.push(`${entry.originalKey}: ${msg}`);
    }
  }

  return { imported, skipped, errors };
}
