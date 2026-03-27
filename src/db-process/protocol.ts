/**
 * DB 子进程 RPC 协议
 *
 * 定义主进程 ↔ DB 子进程之间的消息格式。
 * 两端共享此文件确保类型安全。
 */

// ─── 请求/响应 ───

export interface DbRequest {
  /** 请求 ID（UUID），用于匹配响应 */
  id: string;
  /** 方法名，对应 DatabaseService 的公共方法 */
  method: string;
  /** 序列化后的参数列表 */
  args: unknown[];
}

export interface DbResponse {
  /** 对应请求的 ID */
  id: string;
  /** 成功时的返回值 */
  result?: unknown;
  /** 失败时的错误信息 */
  error?: {
    message: string;
    code: string;
    name: string;
    context?: Record<string, unknown>;
  };
}

// ─── 生命周期消息 ───

export interface DbLifecycleMessage {
  type: 'lifecycle';
  action: 'init' | 'switch' | 'close';
  payload?: DbInitPayload;
}

export interface DbInitPayload {
  workspaceRoot: string;
  userDataPath: string;
  skipVecExtension?: boolean;
}

export interface DbLifecycleResponse {
  type: 'lifecycle';
  action: string;
  success: boolean;
  error?: string;
}

// ─── 联合消息类型 ───

export type DbProcessMessage = DbRequest | DbLifecycleMessage;
export type DbProcessResponse = DbResponse | DbLifecycleResponse;

// ─── 类型守卫 ───

export function isLifecycleMessage(msg: unknown): msg is DbLifecycleMessage {
  return (msg as DbLifecycleMessage)?.type === 'lifecycle';
}

export function isDbRequest(msg: unknown): msg is DbRequest {
  return typeof (msg as DbRequest)?.id === 'string'
    && typeof (msg as DbRequest)?.method === 'string';
}

export function isLifecycleResponse(msg: unknown): msg is DbLifecycleResponse {
  return (msg as DbLifecycleResponse)?.type === 'lifecycle';
}
