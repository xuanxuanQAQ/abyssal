/**
 * 声明式 IPC 通道注册表
 *
 * 将 IPC 通道名映射到主进程处理函数。
 * 应用启动时遍历注册表批量调用 ipcMain.handle()。
 *
 * 注意：窗口控制通道（minimize/toggleMaximize/close）
 * 在 main.ts 中直接注册（需要 mainWindow 引用）。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared-types/ipc';

type HandlerFn = (...args: unknown[]) => unknown | Promise<unknown>;

interface ChannelRegistration {
  channel: string;
  handler: HandlerFn;
}

/**
 * 构建通道注册表
 *
 * TODO: 各 handler 当前为占位实现，需在对应核心模块就绪后
 *       替换为实际的数据库/RAG/管线/文件系统调用
 */
function buildRegistry(): ChannelRegistration[] {
  return [
    // ── db:papers ──
    {
      channel: IPC_CHANNELS.DB_PAPERS_LIST,
      handler: async (_event: unknown, _filter?: unknown) => {
        // TODO: 接入 src/core/database 的 queryPapers
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_GET,
      handler: async (_event: unknown, _id: unknown) => {
        // TODO: 接入 src/core/database 的 getPaper
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_UPDATE,
      handler: async (_event: unknown, _id: unknown, _patch: unknown) => {
        // TODO: 接入 src/core/database 的 updatePaper
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_BATCH_UPDATE_RELEVANCE,
      handler: async (_event: unknown, _ids: unknown, _rel: unknown) => {
        // TODO: 接入 src/core/database 批量更新 relevance
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_IMPORT_BIBTEX,
      handler: async (_event: unknown, _content: unknown) => {
        // TODO: 接入 src/core/bibliography 的 importBibtex
        return { imported: 0, skipped: 0, errors: [] };
      },
    },

    {
      channel: IPC_CHANNELS.DB_PAPERS_COUNTS,
      handler: async () => {
        // TODO: 接入 src/core/database 聚合论文计数
        return {
          total: 0,
          byRelevance: { seed: 0, high: 0, medium: 0, low: 0, excluded: 0 },
          byAnalysisStatus: { not_started: 0, in_progress: 0, completed: 0, needs_review: 0, failed: 0 },
          byFulltextStatus: { available: 0, pending: 0, failed: 0, not_attempted: 0 },
        };
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_DELETE,
      handler: async (_event: unknown, _id: unknown) => {
        // TODO: 接入 src/core/database 删除单篇论文
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_BATCH_DELETE,
      handler: async (_event: unknown, _ids: unknown) => {
        // TODO: 接入 src/core/database 批量删除论文
      },
    },

    // ── db:tags ──
    {
      channel: IPC_CHANNELS.DB_TAGS_LIST,
      handler: async () => {
        // TODO: 接入 src/core/database 标签列表
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_TAGS_CREATE,
      handler: async (_event: unknown, _name: unknown, _parentId?: unknown) => {
        // TODO: 接入 src/core/database 创建标签
        return { id: crypto.randomUUID(), name: _name, parentId: _parentId ?? null, paperCount: 0, color: null };
      },
    },
    {
      channel: IPC_CHANNELS.DB_TAGS_UPDATE,
      handler: async (_event: unknown, _id: unknown, _patch: unknown) => {
        // TODO: 接入 src/core/database 更新标签
      },
    },
    {
      channel: IPC_CHANNELS.DB_TAGS_DELETE,
      handler: async (_event: unknown, _id: unknown) => {
        // TODO: 接入 src/core/database 删除标签
      },
    },

    // ── db:discoverRuns ──
    {
      channel: IPC_CHANNELS.DB_DISCOVER_RUNS_LIST,
      handler: async () => {
        // TODO: 接入 src/core/database discover_runs 表
        return [];
      },
    },

    // ── db:concepts ──
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_LIST,
      handler: async () => {
        // TODO: 接入 src/core/database 概念列表
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_GET_FRAMEWORK,
      handler: async () => {
        // TODO: 接入 src/core/database 概念框架
        return { concepts: [], rootIds: [] };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_UPDATE_FRAMEWORK,
      handler: async (_event: unknown, _fw: unknown) => {
        // TODO: 接入 src/core/database 更新概念框架
        return { affected: [] };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_MERGE,
      handler: async (_event: unknown, _keepId: unknown, _mergeId: unknown) => {
        // TODO: v1.2 implementation — 概念合并，返回冲突映射
        return { mappings: [] };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_RESOLVE_MERGE,
      handler: async (_event: unknown, _decisions: unknown) => {
        // TODO: v1.2 implementation — 解决合并冲突
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_SPLIT,
      handler: async (_event: unknown, _conceptId: unknown, _newConcepts: unknown) => {
        // TODO: v1.2 implementation — 概念拆分，返回需重新分配的映射
        return { mappings: [] };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_REASSIGN,
      handler: async (_event: unknown, _assignments: unknown) => {
        // TODO: v1.2 implementation — 重新分配映射到新概念
      },
    },
    {
      channel: 'db:concepts:search',
      handler: async (_event: unknown, _query: unknown) => {
        // TODO: v1.2 implementation — 概念搜索
        return [];
      },
    },

    // ── db:mappings ──
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_GET_FOR_PAPER,
      handler: async (_event: unknown, _paperId: unknown) => {
        // TODO: 接入 src/core/database 论文映射查询
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_GET_FOR_CONCEPT,
      handler: async (_event: unknown, _conceptId: unknown) => {
        // TODO: 接入 src/core/database 概念映射查询
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_ADJUDICATE,
      handler: async (
        _event: unknown,
        _mappingId: unknown,
        _decision: unknown,
        _revised?: unknown
      ) => {
        // TODO: 接入 src/core/database 映射裁决
      },
    },
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_GET_HEATMAP_DATA,
      handler: async () => {
        // TODO: 接入 src/core/database 热力图矩阵
        return { conceptIds: [], paperIds: [], cells: [] };
      },
    },

    // ── db:annotations ──
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_LIST_FOR_PAPER,
      handler: async (_event: unknown, _paperId: unknown) => {
        // TODO: 接入 src/core/database 标注列表
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_CREATE,
      handler: async (_event: unknown, _annotation: unknown) => {
        // TODO: 接入 src/core/database 创建标注
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_UPDATE,
      handler: async (_event: unknown, _id: unknown, _patch: unknown) => {
        // TODO: 接入 src/core/database 更新标注
      },
    },
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_DELETE,
      handler: async (_event: unknown, _id: unknown) => {
        // TODO: 接入 src/core/database 删除标注
      },
    },

    // ── db:articles ──
    {
      channel: IPC_CHANNELS.DB_ARTICLES_LIST_OUTLINES,
      handler: async () => {
        // TODO: 接入 src/core/database 文章纲要列表
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_CREATE,
      handler: async (_event: unknown, _title: unknown) => {
        // TODO: 接入 src/core/database 创建文章
        return {
          id: crypto.randomUUID(),
          title: _title as string,
          citationStyle: 'GB/T 7714',
          exportFormat: 'markdown',
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sections: [],
        };
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_UPDATE,
      handler: async (_event: unknown, _articleId: unknown, _patch: unknown) => {
        // TODO: 接入 src/core/database 更新文章元数据
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_GET_OUTLINE,
      handler: async (_event: unknown, _articleId: unknown) => {
        // TODO: 接入 src/core/database 文章纲要
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_UPDATE_OUTLINE_ORDER,
      handler: async (_event: unknown, _articleId: unknown, _order: unknown) => {
        // TODO: 接入 src/core/database 更新纲要顺序
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_GET_SECTION,
      handler: async (_event: unknown, _sectionId: unknown) => {
        // TODO: 接入 src/core/database 获取节内容
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_UPDATE_SECTION,
      handler: async (_event: unknown, _sectionId: unknown, _patch: unknown) => {
        // TODO: 接入 src/core/database 更新节内容
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_GET_SECTION_VERSIONS,
      handler: async (_event: unknown, _sectionId: unknown) => {
        // TODO: 接入 src/core/database 节版本历史
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_SECTIONS_CREATE,
      handler: async (
        _event: unknown,
        _articleId: unknown,
        _parentId: unknown,
        _sortIndex: unknown,
        _title?: unknown,
      ) => {
        // TODO: 接入 src/core/database 创建节
        return {
          id: crypto.randomUUID(),
          title: (_title as string) ?? '新节',
          parentId: _parentId as string | null,
          sortIndex: _sortIndex as number,
          status: 'pending',
          wordCount: 0,
          writingInstructions: null,
          aiModel: null,
          children: [],
        };
      },
    },
    {
      channel: IPC_CHANNELS.DB_SECTIONS_DELETE,
      handler: async (_event: unknown, _sectionId: unknown) => {
        // TODO: 接入 src/core/database 删除节（含子节级联删除）
      },
    },
    {
      channel: IPC_CHANNELS.DB_ARTICLES_SEARCH,
      handler: async (_event: unknown, _query: unknown) => {
        // TODO: 接入 src/core/database 文章全文搜索（GlobalSearch 使用）
        return [];
      },
    },

    // ── db:relations ──
    {
      channel: IPC_CHANNELS.DB_RELATIONS_GET_GRAPH,
      handler: async (_event: unknown, _filter?: unknown) => {
        // TODO: 接入 src/core/database 关系图
        return { nodes: [], edges: [] };
      },
    },
    {
      channel: IPC_CHANNELS.DB_RELATIONS_GET_NEIGHBORHOOD,
      handler: async (_event: unknown, _nodeId: unknown, _depth: unknown, _layers?: unknown) => {
        // TODO: v1.2 implementation — 分页加载邻域子图
        return { nodes: [], edges: [] };
      },
    },

    // ── rag ──
    {
      channel: IPC_CHANNELS.RAG_SEARCH,
      handler: async (_event: unknown, _query: unknown, _filter?: unknown) => {
        // TODO: 接入 src/core/rag 语义检索
        return [];
      },
    },
    {
      channel: 'rag:searchWithReport',
      handler: async (_event: unknown, _query: unknown, _filter?: unknown) => {
        // TODO: v1.2 implementation — 带质量报告的 RAG 检索
        return { chunks: [], qualityReport: { coverage: 'sufficient', retryCount: 0, gaps: [] } };
      },
    },
    {
      channel: IPC_CHANNELS.RAG_GET_WRITING_CONTEXT,
      handler: async (_event: unknown, _sectionId: unknown) => {
        // TODO: 接入 src/core/rag 写作上下文
        return {
          relatedSyntheses: [],
          ragPassages: [],
          privateKBMatches: [],
          precedingSummary: '',
          followingSectionTitles: [],
        };
      },
    },

    // ── pipeline ──
    {
      channel: IPC_CHANNELS.PIPELINE_START,
      handler: async (_event: unknown, _workflow: unknown, _config?: unknown) => {
        // TODO: 接入 src/core/orchestrator 启动管线
        return crypto.randomUUID();
      },
    },
    {
      channel: IPC_CHANNELS.PIPELINE_CANCEL,
      handler: async (_event: unknown, _taskId: unknown) => {
        // TODO: 接入 src/core/orchestrator 取消管线
      },
    },

    // ── chat ──
    {
      channel: IPC_CHANNELS.CHAT_SEND,
      handler: async (_event: unknown, _message: unknown, _context?: unknown) => {
        // TODO: 接入 src/core/agent-loop 聊天
        return crypto.randomUUID();
      },
    },

    // ── db:chat（§5.1.1 聊天持久化）──
    {
      channel: IPC_CHANNELS.DB_CHAT_SAVE_MESSAGE,
      handler: async (_event: unknown, _record: unknown) => {
        // TODO: 接入 src/core/database chat_messages 表写入
      },
    },
    {
      channel: IPC_CHANNELS.DB_CHAT_GET_HISTORY,
      handler: async (_event: unknown, _contextKey: unknown, _opts?: unknown) => {
        // TODO: 接入 src/core/database chat_messages 表查询
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_CHAT_DELETE_SESSION,
      handler: async (_event: unknown, _contextKey: unknown) => {
        // TODO: 接入 src/core/database 删除指定会话消息
      },
    },
    {
      channel: IPC_CHANNELS.DB_CHAT_LIST_SESSIONS,
      handler: async () => {
        // TODO: 接入 src/core/database 列出所有有消息的会话
        return [];
      },
    },

    // ── fs ──
    {
      channel: IPC_CHANNELS.FS_OPEN_PDF,
      handler: async (_event: unknown, _paperId: unknown) => {
        // TODO: 接入文件系统 PDF 读取
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.FS_SAVE_PDF_ANNOTATIONS,
      handler: async (_event: unknown, _paperId: unknown, _anns: unknown) => {
        // TODO: 接入文件系统 + 数据库双写标注
      },
    },
    {
      channel: IPC_CHANNELS.FS_EXPORT_ARTICLE,
      handler: async (_event: unknown, _articleId: unknown, _format: unknown) => {
        // TODO: 接入导出模块
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.FS_IMPORT_FILES,
      handler: async (_event: unknown, _paths: unknown) => {
        // TODO: 接入 src/core/bibliography 批量导入
        return { imported: 0, skipped: 0, errors: [] };
      },
    },
    {
      channel: IPC_CHANNELS.FS_CREATE_SNAPSHOT,
      handler: async (_event: unknown, _name: unknown) => {
        // TODO: 接入快照管理
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.FS_RESTORE_SNAPSHOT,
      handler: async (_event: unknown, _snapshotId: unknown) => {
        // TODO: 接入快照恢复
      },
    },
    {
      channel: IPC_CHANNELS.FS_LIST_SNAPSHOTS,
      handler: async () => {
        // TODO: v1.2 implementation — 列出快照（含磁盘占用）
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.FS_CLEANUP_SNAPSHOTS,
      handler: async (_event: unknown, _policy: unknown) => {
        // TODO: v1.2 implementation — 按策略清理快照
      },
    },

    // ── advisory ──
    {
      channel: IPC_CHANNELS.ADVISORY_GET_RECOMMENDATIONS,
      handler: async () => {
        // TODO: v1.2 implementation — 获取 Advisory Agent 建议
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.ADVISORY_EXECUTE,
      handler: async (_event: unknown, _id: unknown) => {
        // TODO: v1.2 implementation — 执行 Advisory Agent 建议
        return crypto.randomUUID();
      },
    },

    // ── app ──
    {
      channel: IPC_CHANNELS.APP_GET_CONFIG,
      handler: async () => {
        // TODO: 接入配置读取
        return {
          language: 'zh',
          llmProvider: 'claude',
          llmModel: 'claude-sonnet-4-20250514',
          workspacePath: 'workspace',
        };
      },
    },
    {
      channel: IPC_CHANNELS.APP_UPDATE_CONFIG,
      handler: async (_event: unknown, _patch: unknown) => {
        // TODO: 接入配置更新
      },
    },
    {
      channel: IPC_CHANNELS.APP_GET_PROJECT_INFO,
      handler: async () => {
        // TODO: 接入项目信息
        return {
          name: 'Abyssal Project',
          paperCount: 0,
          conceptCount: 0,
          lastModified: new Date().toISOString(),
        };
      },
    },
    {
      channel: IPC_CHANNELS.APP_SWITCH_PROJECT,
      handler: async (_event: unknown, _projectPath: unknown) => {
        // TODO: 接入项目切换逻辑
        // 1. 关闭当前 SQLite 连接
        // 2. 打开新项目数据库
        // 3. 渲染进程会自行清空 TanStack Query 缓存和 Zustand Store
        throw new Error('Not implemented');
      },
    },
    {
      channel: IPC_CHANNELS.APP_LIST_PROJECTS,
      handler: async () => {
        // TODO: 接入项目列表读取
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.APP_CREATE_PROJECT,
      handler: async (_event: unknown, _config: unknown) => {
        // TODO: v1.2 implementation — 创建新项目
        return {
          name: 'New Project',
          paperCount: 0,
          conceptCount: 0,
          lastModified: new Date().toISOString(),
        };
      },
    },

    // ── app:window（多窗口预留） ──
    {
      channel: IPC_CHANNELS.APP_WINDOW_POP_OUT,
      handler: async (_event: unknown, _viewType: unknown, _entityId?: unknown) => {
        // §1.3 多窗口预留：当前版本不实现
        throw new Error('多窗口功能暂不支持，将在未来版本中实现');
      },
    },
    {
      channel: IPC_CHANNELS.APP_WINDOW_LIST,
      handler: async () => {
        // §1.3 多窗口预留：当前版本返回空列表
        return [];
      },
    },
  ];
}

/**
 * 注册 renderer→main 单向事件监听器
 * 与 ipcMain.handle 不同，这些是 fire-and-forget 消息
 */
function registerEventListeners(): void {
  ipcMain.on(
    IPC_CHANNELS.READER_PAGE_CHANGED,
    (_event: Electron.IpcMainEvent, _paperId: unknown, _page: unknown) => {
      // TODO: 接入分析引擎查询当前页相关概念映射证据
      //       → 生成 ProactiveTipEvent 推送回渲染进程
    }
  );
}

/**
 * 批量注册所有 IPC handler
 * 在 app.whenReady() 后调用一次
 */
export function registerAllIPCHandlers(): void {
  const registry = buildRegistry();
  for (const { channel, handler } of registry) {
    ipcMain.handle(channel, handler);
  }
  registerEventListeners();
  console.log(`[IPC] Registered ${registry.length} handlers + event listeners`);
}
