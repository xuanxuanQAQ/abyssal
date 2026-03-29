// ═══ Token 计数器 ═══
//
// 精确计数使用 js-tiktoken (cl100k_base)，缺失时降级为启发式估算。
// 编码器实例为模块级单例——首次调用时懒加载。

// CJK 字符范围（含 CJK 标点和全角字符）
const CJK_RE =
  /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g;

type Encoder = { encode: (text: string) => number[] };

let encoder: Encoder | null = null;
let encoderLoadAttempted = false;

function getEncoder(): Encoder | null {
  if (encoderLoadAttempted) return encoder;
  encoderLoadAttempted = true;

  try {
    // TODO: 确保 js-tiktoken 已安装到 dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getEncoding } = require('js-tiktoken');
    encoder = getEncoding('cl100k_base') as Encoder;
    return encoder;
  } catch {
    encoder = null;
    return null;
  }
}

/**
 * 精确计算 token 数（cl100k_base 编码）。
 * 如果 js-tiktoken 不可用，自动降级为 estimateTokens。
 */
export function countTokens(text: string): number {
  const enc = getEncoder();
  if (enc) {
    return enc.encode(text).length;
  }
  return estimateTokens(text);
}

/**
 * 快速估算 token 数（不依赖外部库）。
 *
 * 算法：
 *   - 英文文本：平均 1 token ≈ 4 字符
 *   - 中文文本：平均 1 汉字 ≈ 0.6 token
 *   - 精度：纯英文 ±15%，纯中文 ±20%，混合 ±25%
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_RE);
  const cjkCharCount = cjkMatches ? cjkMatches.length : 0;
  // 使用 Unicode 码点数量而非 UTF-16 code unit 数量，
  // 避免 Emoji / CJK 扩展区的 surrogate pair 导致 asciiCharCount 偏高
  const totalCodePoints = [...text].length;
  const asciiCharCount = totalCodePoints - cjkCharCount;
  return Math.ceil(cjkCharCount * 0.6 + asciiCharCount / 4);
}
