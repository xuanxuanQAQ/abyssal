// ═══ MCP Tool Handler ═══
// §4: 运行时代理 — 路由/解包/校验/序列化/错误映射/只读保护

import type { DatabaseService } from '../core/database';
import type { SearchService } from '../core/search';
import type { AcquireService } from '../core/acquire';
import type { ProcessService } from '../core/process';
import type { RagService } from '../core/rag';
import type { BibliographyService } from '../core/bibliography';
import type { Logger } from '../core/infra/logger';
import type { ConfigProvider } from '../core/infra/config-provider';
import { AbyssalError } from '../core/types/errors';
import { getToolMap, type ToolDefinition } from './tool-definitions';

// Sections writable via MCP (matches WRITABLE_SECTIONS in config capability)
const MCP_WRITABLE_SECTIONS = new Set([
  'llm', 'rag', 'acquire', 'discovery', 'analysis', 'language',
  'contextBudget', 'webSearch', 'personalization', 'ai', 'appearance',
]);

const MCP_REDACTED_SECTIONS = new Set(['apiKeys']);

function hasOwnKey<T extends object>(obj: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ─── §4.3 服务上下文 ───

export interface ServiceContext {
  dbService: DatabaseService;
  searchService: SearchService;
  acquireService: AcquireService;
  processService: ProcessService;
  ragService: RagService;
  bibliographyService: BibliographyService;
  configProvider?: ConfigProvider;
  logger: Logger;
  readOnly: boolean;
  startTime: number; // Date.now() at server start
}

// ─── MCP 响应类型 ───

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean | undefined;
}

// ─── §4.7 返回值序列化 ───

const MAX_RESPONSE_BYTES = 100 * 1024; // 100 KB

function serializeResult(result: unknown): string {
  if (result === undefined || result === null) {
    return JSON.stringify({ success: true });
  }

  // Float32Array → number[]
  if (result instanceof Float32Array) {
    return JSON.stringify(Array.from(result));
  }

  // Fix #3: Buffer → 临时文件路径（不在 JSON-RPC 中传输原始文件流）
  // Fix: 增加过期清理——删除超过 1 小时的旧临时文件
  if (Buffer.isBuffer(result)) {
    const os = require('node:os');
    const fs = require('node:fs');
    const path = require('node:path');
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `abyssal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    fs.writeFileSync(tmpPath, result);
    // 异步清理超过 1 小时的旧 abyssal 临时文件
    try {
      const files = fs.readdirSync(tmpDir) as string[];
      const oneHourAgo = Date.now() - 3600_000;
      for (const f of files) {
        if (!f.startsWith('abyssal_')) continue;
        const ts = parseInt(f.split('_')[1] ?? '0', 10);
        if (ts > 0 && ts < oneHourAgo) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore cleanup errors */ }
    return JSON.stringify({ filePath: tmpPath, sizeBytes: result.length });
  }

  // Map → Object (for SectionMap etc.)
  if (result instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of result) {
      obj[String(k)] = v;
    }
    return JSON.stringify(obj);
  }

  return JSON.stringify(result, (_key, value) => {
    if (value instanceof Float32Array) return Array.from(value);
    if (value instanceof Map) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value) obj[String(k)] = v;
      return obj;
    }
    return value;
  });
}

// ─── §4.8 错误响应构建 ───

function buildErrorResponse(err: unknown): { code: number; message: string; data?: unknown } {
  if (err instanceof AbyssalError) {
    return {
      code: err.code === 'MISSING_FIELD' ? -32602 : err.code === 'CONFIG_ERROR' ? -32603 : -32000,
      message: `${err.code}: ${err.message}`,
      data: err.toJSON(),
    };
  }

  const error = err as Error;
  return {
    code: -32603,
    message: error.message ?? 'Internal error',
  };
}

// ─── §2.3 健康检查实现 ───

function healthCheck(ctx: ServiceContext): Record<string, unknown> {
  let stats: { papers: { total: number }; chunks: { total: number }; concepts: { total: number } };
  try {
    stats = ctx.dbService.getStats();
  } catch {
    return {
      database: 'disconnected',
      uptime_seconds: Math.floor((Date.now() - ctx.startTime) / 1000),
    };
  }

  return {
    database: 'connected',
    sqlite_vec: 'loaded', // 如果到达这里说明初始化成功
    embedder: 'ready', // TODO: 检查 embedder 实际状态
    reranker: 'ready',
    paper_count: stats.papers.total,
    chunk_count: stats.chunks.total,
    concept_count: stats.concepts.total,
    uptime_seconds: Math.floor((Date.now() - ctx.startTime) / 1000),
  };
}

// ═══ §4.1 handleToolCall 主函数 ═══

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ServiceContext,
): Promise<McpToolResult> {
  const startTime = Date.now();
  const toolMap = getToolMap();
  const toolDef = toolMap.get(toolName);

  // §4.3: 路由失败
  if (!toolDef) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }],
      isError: true,
    };
  }

  // §4.9: 只读模式保护
  if (ctx.readOnly && toolDef.isWriteOperation) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Tool '${toolName}' is disabled in read-only mode` }) }],
      isError: true,
    };
  }

  try {
    // §4.4: 参数解包 + 函数调用
    const result = await dispatchToolCall(toolDef, args, ctx);

    // §4.7: 序列化
    let serialized = serializeResult(result);

    // 大返回值截断
    if (serialized.length > MAX_RESPONSE_BYTES) {
      // 尝试截断数组
      if (Array.isArray(result)) {
        let truncated = result;
        while (serializeResult(truncated).length > MAX_RESPONSE_BYTES && truncated.length > 1) {
          truncated = truncated.slice(0, Math.ceil(truncated.length * 0.7));
        }
        serialized = serializeResult(truncated);
        return {
          content: [
            { type: 'text', text: serialized },
            { type: 'text', text: `⚠️ Response truncated. Use more specific filters to reduce result size.` },
          ],
        };
      }
      serialized = serialized.slice(0, MAX_RESPONSE_BYTES);
    }

    ctx.logger.debug(`Tool call: ${toolName}`, {
      durationMs: Date.now() - startTime,
      resultSize: serialized.length,
    });

    return { content: [{ type: 'text', text: serialized }] };
  } catch (err) {
    ctx.logger.error(`Tool call failed: ${toolName}`, err as Error);
    const errorResp = buildErrorResponse(err);
    return {
      content: [{ type: 'text', text: JSON.stringify(errorResp) }],
      isError: true,
    };
  }
}

// ─── §4.4 Tool 分发 ───

/** 解析 injectedParams，从 ServiceContext 注入服务依赖 */
function resolveInjectedParam(name: string, ctx: ServiceContext): unknown {
  switch (name) {
    case 'db': case 'dbService': return ctx.dbService;
    case 'vlm': return (ctx.processService as unknown as Record<string, unknown>)['vlm'] ?? null;
    case 'logger': return ctx.logger;
    case 'config': return (ctx as unknown as Record<string, unknown>)['config'] ?? null;
    default: return undefined;
  }
}

async function dispatchToolCall(
  toolDef: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ServiceContext,
): Promise<unknown> {
  const { module: mod, functionName } = toolDef;

  // 系统 Tool
  if (mod === 'system') {
    return healthCheck(ctx);
  }

  // Config Tools — 直接路由，不走 service method pattern
  if (mod === 'config') {
    return dispatchConfigTool(functionName, args, ctx);
  }

  // 路由到对应模块的 Service 实例方法
  const service = getService(mod, ctx);
  if (!service) {
    throw new Error(`Module '${mod}' is not available (may have failed to initialize)`);
  }

  const fn = (service as Record<string, unknown>)[functionName];
  if (typeof fn !== 'function') {
    throw new Error(`Function '${functionName}' not found on module '${mod}'`);
  }

  // §4.4: 参数解包（Fix #1: 使用 paramOrder 防止可选参数空洞）
  // Fix #2: injectedParams 自动注入服务依赖（如 db, vlm, logger）
  const { paramOrder, injectedParams } = toolDef;
  const injectedSet = new Set(injectedParams);

  if (paramOrder.length === 0) {
    return fn.call(service);
  }

  // 按签名顺序组装参数数组——注入参数从 ctx 解析，其余从 MCP args 提取
  const orderedArgs = paramOrder.map((name) => {
    if (injectedSet.has(name)) {
      return resolveInjectedParam(name, ctx);
    }
    return args[name];
  });

  return fn.call(service, ...orderedArgs);
}

function getService(mod: string, ctx: ServiceContext): unknown {
  switch (mod) {
    case 'database': return ctx.dbService;
    case 'search': return ctx.searchService;
    case 'acquire': return ctx.acquireService;
    case 'process': return ctx.processService;
    case 'rag': return ctx.ragService;
    case 'bibliography': return ctx.bibliographyService;
    default: return null;
  }
}

// ─── Config Tool dispatch ───

async function dispatchConfigTool(
  functionName: string,
  args: Record<string, unknown>,
  ctx: ServiceContext,
): Promise<unknown> {
  if (!ctx.configProvider) {
    throw new Error('ConfigProvider not available');
  }

  if (functionName === 'getSettings') {
    const config = ctx.configProvider.config;
    const section = args['section'] as string | undefined;
    if (section) {
      if (MCP_REDACTED_SECTIONS.has(section)) {
        throw new Error(`Section "${section}" contains credentials and cannot be read via MCP`);
      }
      if (!hasOwnKey(config, section)) {
        throw new Error(`Unknown settings section: ${section}`);
      }
      const value = config[section];
      return { section, data: value };
    }
    // Return all except redacted
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (!MCP_REDACTED_SECTIONS.has(key)) safe[key] = value;
    }
    return safe;
  }

  if (functionName === 'updateSettings') {
    const section = args['section'] as string;
    const patch = args['patch'] as Record<string, unknown>;
    if (!section || !patch) {
      throw new Error('Both "section" and "patch" are required');
    }
    if (!MCP_WRITABLE_SECTIONS.has(section)) {
      throw new Error(`Section "${section}" cannot be modified via MCP. Writable: ${[...MCP_WRITABLE_SECTIONS].join(', ')}`);
    }
    // Apply patch to current config
    const current = structuredClone(ctx.configProvider.config);
    const sectionObj = ((current as any)[section] ?? {}) as Record<string, unknown>;
    Object.assign(sectionObj, patch);
    (current as any)[section] = sectionObj;
    ctx.configProvider.update(current);
    return { success: true, section, updatedKeys: Object.keys(patch) };
  }

  throw new Error(`Unknown config function: ${functionName}`);
}
