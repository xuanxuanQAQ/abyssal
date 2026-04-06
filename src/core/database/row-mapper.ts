// ═══ Row Mapper ═══
// snake_case (SQLite 列名) ↔ camelCase (TypeScript 字段名) 转换
// JSON 列的 serialize / parse
//
// 列元数据定义：COLUMN_TYPES 是唯一权威来源。
// 新增 JSON 或 boolean 列时只需在此处更新一行。

// ─── snake_case → camelCase ───

const snakeToCamelCache = new Map<string, string>();

function snakeToCamel(s: string): string {
  let cached = snakeToCamelCache.get(s);
  if (cached !== undefined) return cached;
  cached = s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  snakeToCamelCache.set(s, cached);
  return cached;
}

// ─── camelCase → snake_case ───

const camelToSnakeCache = new Map<string, string>();

function camelToSnake(s: string): string {
  let cached = camelToSnakeCache.get(s);
  if (cached !== undefined) return cached;
  cached = s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
  camelToSnakeCache.set(s, cached);
  return cached;
}

// ─── 列元数据（唯一权威来源） ───
// 新增/修改表结构中的 JSON 或 boolean 列时，只需在此处更新。
// schemas.ts 中的 Zod schema 应与此保持一致（z.array → json, z.boolean → boolean）。

const COLUMN_TYPES: Record<string, 'json' | 'boolean'> = {
  // JSON 列（数据库中存储为 TEXT JSON 字符串）
  authors: 'json',
  editors: 'json',
  search_keywords: 'json',
  history: 'json',
  evidence: 'json',
  concept_ids: 'json',
  paper_ids: 'json',
  source_paper_ids: 'json',
  suggested_keywords: 'json',
  linked_note_ids: 'json',
  linked_paper_ids: 'json',
  linked_concept_ids: 'json',
  keywords: 'json',
  tags: 'json',
  edited_paragraphs: 'json',
  evidence_gaps: 'json',
  metadata: 'json',
  checkpoint: 'json',

  // Boolean 列（数据库中存储为 INTEGER 0/1）
  biblio_complete: 'boolean',
  reviewed: 'boolean',
  deprecated: 'boolean',
  indexed: 'boolean',
  is_breaking: 'boolean',
};

/** 数据库中以 TEXT (JSON) 存储、TypeScript 中为数组/对象的列集合（snake_case） */
export const JSON_COLUMNS: ReadonlySet<string> = new Set(
  Object.entries(COLUMN_TYPES)
    .filter(([, t]) => t === 'json')
    .map(([k]) => k),
);

/** 数据库中以 INTEGER (0/1) 存储、TypeScript 中为 boolean 的列集合（snake_case） */
export const BOOLEAN_COLUMNS: ReadonlySet<string> = new Set(
  Object.entries(COLUMN_TYPES)
    .filter(([, t]) => t === 'boolean')
    .map(([k]) => k),
);

// ─── fromRow: 数据库行 → TypeScript 对象 ───

export function fromRow<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = snakeToCamel(key);
    if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      try {
        result[camelKey] = JSON.parse(value);
      } catch {
        result[camelKey] = value;
      }
    } else if (BOOLEAN_COLUMNS.has(key)) {
      result[camelKey] = value === 1;
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}

// ─── toRow: TypeScript 对象 → 数据库行 ───

export function toRow(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);
    if (JSON_COLUMNS.has(snakeKey) && value != null && typeof value !== 'string') {
      result[snakeKey] = JSON.stringify(value);
    } else if (BOOLEAN_COLUMNS.has(snakeKey) && typeof value === 'boolean') {
      result[snakeKey] = value ? 1 : 0;
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

// ─── 工具函数 ───

/** 将 camelCase 字段名转为 snake_case 列名 */
export { camelToSnake, snakeToCamel };

/** 当前 ISO 8601 UTC 时间戳 */
export function now(): string {
  return new Date().toISOString();
}
