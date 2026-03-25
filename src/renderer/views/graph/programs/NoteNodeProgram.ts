/**
 * NoteNodeProgram — 星形节点 WebGL 程序（§7.2）
 *
 * memo 节点: 5角星, 8px, 60% 透明度
 * note 节点: 5角星, 12px, 80% 透明度
 *
 * TODO: 实际 WebGL shader 实现需要继承 sigma.js 的 NodeProgram 基类。
 * 当前为占位导出，使用默认圆形程序作为 fallback。
 */

// TODO: implement custom star-shaped WebGL program extending sigma's NodeProgram
// For now, export a marker constant so GraphCanvas can detect note node types
// and apply satellite clustering parameters.

/** 卫星簇布局参数（§7.2）*/
export const NOTE_LAYOUT_PARAMS = {
  /** 笔记节点边权重（远高于默认 1.0，拉近到主节点） */
  edgeWeight: 5.0,
  /** 弹簧长度缩短为正常值的 40% */
  springLengthRatio: 0.4,
  /** 排斥力降低为正常值的 20% */
  repulsionRatio: 0.2,
} as const;

/** memo 节点视觉参数 */
export const MEMO_NODE_VISUAL = {
  shape: 'star' as const,
  size: 8,
  opacity: 0.6,
  points: 5,
};

/** note 节点视觉参数 */
export const NOTE_NODE_VISUAL = {
  shape: 'star' as const,
  size: 12,
  opacity: 0.8,
  points: 5,
};

/** 笔记→实体边的样式 */
export const NOTE_EDGE_STYLE = {
  type: 'dotted' as const,
  color: '#9CA3AF',
  opacity: 0.4,
  arrow: false,
};
