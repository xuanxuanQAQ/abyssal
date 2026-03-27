-- ═══ _meta 元信息表 ═══
-- §3.3: 持久化嵌入维度、模型、Schema 版本等运行时元信息。
-- 用于启动时一致性验证和嵌入模型迁移的中断恢复。

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 注意：embedding_dimension 和 embedding_model 的值
-- 由迁移引擎在运行时从配置中读取并 INSERT。
-- 见 migration.ts 中 003 迁移的后处理逻辑。
