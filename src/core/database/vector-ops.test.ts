import { embeddingToBuffer, validateAndNormalize, isZeroVector, prepareEmbeddingForInsert } from './vector-ops';

describe('embeddingToBuffer', () => {
  it('converts Float32Array to Buffer with correct byte length', () => {
    const vec = new Float32Array([1.0, 2.0, 3.0]);
    const buf = embeddingToBuffer(vec);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.byteLength).toBe(12); // 3 × 4 bytes
  });

  it('is zero-copy (shares same ArrayBuffer)', () => {
    const vec = new Float32Array([1.0, 2.0]);
    const buf = embeddingToBuffer(vec);
    // 修改原始数组应反映在 buffer 中
    vec[0] = 99.0;
    const view = new Float32Array(buf.buffer, buf.byteOffset, 2);
    expect(view[0]).toBe(99.0);
  });

  it('handles empty array', () => {
    const vec = new Float32Array(0);
    const buf = embeddingToBuffer(vec);
    expect(buf.byteLength).toBe(0);
  });
});

describe('isZeroVector', () => {
  it('returns true for all-zero vector', () => {
    expect(isZeroVector(new Float32Array([0, 0, 0, 0]))).toBe(true);
  });

  it('returns true for near-zero vector', () => {
    expect(isZeroVector(new Float32Array([1e-15, 1e-15]))).toBe(true);
  });

  it('returns false for non-zero vector', () => {
    expect(isZeroVector(new Float32Array([0.1, 0, 0]))).toBe(false);
  });
});

describe('validateAndNormalize', () => {
  it('returns already-normalized vector unchanged', () => {
    // 单位向量 [1, 0, 0]
    const vec = new Float32Array([1.0, 0.0, 0.0]);
    const result = validateAndNormalize(vec);
    expect(result[0]).toBeCloseTo(1.0, 5);
    expect(result[1]).toBeCloseTo(0.0, 5);
  });

  it('force-normalizes unnormalized vector', () => {
    const vec = new Float32Array([3.0, 4.0]); // norm = 5
    const result = validateAndNormalize(vec);
    expect(result[0]).toBeCloseTo(0.6, 5);
    expect(result[1]).toBeCloseTo(0.8, 5);
  });

  it('returns zero vector unchanged (no NaN/Inf)', () => {
    const vec = new Float32Array([0, 0, 0]);
    const result = validateAndNormalize(vec);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(Number.isNaN(result[0])).toBe(false);
  });

  it('preserves already-normalized 1536-dim vector', () => {
    // 创建一个归一化的 1536 维向量
    const vec = new Float32Array(1536);
    vec[0] = 1.0; // 单位向量
    const result = validateAndNormalize(vec);
    expect(result).toBe(vec); // 应返回原引用（已归一化）
  });

  it('handles NaN in embedding — produces NaN norm, treated as zero vector', () => {
    const vec = new Float32Array([NaN, 1.0, 0.0]);
    // l2Norm of [NaN, 1, 0] = sqrt(NaN + 1 + 0) = NaN
    // NaN < ZERO_VECTOR_THRESHOLD is false, so it falls through to normalization
    const result = validateAndNormalize(vec);
    // With NaN norm, the norm check `Math.abs(NaN - 1.0) < eps` = false
    // So it enters re-normalization: vec[i] / NaN = NaN for all
    // This is a known limitation — NaN propagates
    expect(Number.isNaN(result[0])).toBe(true);
  });

  it('near-zero but non-zero vector is treated as zero if below threshold', () => {
    // 1e-13 norm → below ZERO_VECTOR_THRESHOLD (1e-12)
    const vec = new Float32Array([1e-13, 0, 0]);
    const result = validateAndNormalize(vec);
    // Should return original (not attempt normalization which would amplify noise)
    // Float32 precision: 1e-13 stored as ~9.9999998e-14
    expect(result).toBe(vec); // same reference — returned as-is
  });

  it('small but above-threshold vector is normalized', () => {
    // 1e-6 norm → above threshold, needs normalization
    const vec = new Float32Array([1e-6, 0, 0]);
    const result = validateAndNormalize(vec);
    expect(result[0]).toBeCloseTo(1.0, 3);
  });
});

describe('prepareEmbeddingForInsert', () => {
  it('returns a Buffer ready for sqlite-vec insertion', () => {
    const vec = new Float32Array([1.0, 0.0, 0.0]);
    const buf = prepareEmbeddingForInsert(vec);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.byteLength).toBe(12);
  });
});
