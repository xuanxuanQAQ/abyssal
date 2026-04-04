// ═══ Barrel re-export ═══
// src/core/types/ — 纯类型模块，零运行时依赖（错误类除外）
//
// TODO: src/shared-types/ 是前端 IPC 边界层，与本模块独立维护。
//       适配层（Electron IPC handler）负责两套类型之间的映射转换。
// TODO: src/__test-utils__/ 中的 fixture 工厂需同步更新字段签名。

export * from './common';
export * from './errors';
export * from './paper';
export * from './chunk';
export * from './concept';
export * from './mapping';
export * from './annotation';
export * from './article';
export * from './retrieval';
export * from './bibliography';
export * from './memo';
export * from './note';
export * from './suggestion';
export * from './relation';
export * from './config';
