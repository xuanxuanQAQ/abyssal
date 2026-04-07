-- ═══ 002: chat_messages 增加 attachments 列 ═══
-- 存储发送时附带的上下文元数据（引用/图片/写作选区），JSON 格式

ALTER TABLE chat_messages ADD COLUMN attachments TEXT;
