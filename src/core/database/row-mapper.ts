// ═══ Row Mapper ═══
// snake_case (SQLite 列名) ↔ camelCase (TypeScript 字段名) 转换
// JSON 列的 serialize / parse

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

// ─── JSON 列集合 ───
// 这些列在数据库中存储为 TEXT（JSON 字符串），需要在映射时 parse/stringify

const JSON_COLUMNS = new Set([
  'authors',
  'editors',
  'search_keywords',
  'history',
  'evidence',
  'concept_ids',
  'paper_ids',
  'source_paper_ids',
  'linked_note_ids',
  'linked_paper_ids',
  'linked_concept_ids',
  'tags',
  'edited_paragraphs',
  'metadata',
]);

// ─── 布尔列集合 ───
// 数据库中存储为 INTEGER (0/1)，TypeScript 中为 boolean

const BOOLEAN_COLUMNS = new Set([
  'biblio_complete',
  'reviewed',
  'deprecated',
  'indexed',
  'is_breaking',
]);

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
