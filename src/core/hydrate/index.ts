// ═══ HydrateService — 论文元数据水合引擎 ═══
//
// 将 acquire 从"获取全文"扩展为"缺什么补什么"的通用管线。
// 每篇论文经过：身份确认 → 元数据水合 → 全文获取 → 内容处理 → 后处理增强。

export { extractMetadataWithLlm, type LlmCallFn, type LlmExtractedMetadata } from './llm-metadata-extractor';
export {
  hydratePaperMetadata,
  type MetadataLookupService,
  type EnrichService,
  type HydrateConfig,
  type HydrateResult,
  type HydrateFieldLog,
} from './metadata-hydrator';
