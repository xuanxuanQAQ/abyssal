import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  const columns = db.prepare("PRAGMA table_info(suggested_concepts)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('suggested_definition')) {
    db.exec("ALTER TABLE suggested_concepts ADD COLUMN suggested_definition TEXT");
  }

  if (!columnNames.has('suggested_keywords')) {
    db.exec("ALTER TABLE suggested_concepts ADD COLUMN suggested_keywords TEXT NOT NULL DEFAULT '[]'");
  }
}