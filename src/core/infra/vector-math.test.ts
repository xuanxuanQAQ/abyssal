import { l2DistanceToScore, scoreToL2Distance, l2Norm, l2Distance } from './vector-math';

describe('l2DistanceToScore', () => {
  it('returns 1.0 for distance 0 (identical vectors)', () => {
    expect(l2DistanceToScore(0)).toBe(1.0);
  });

  it('returns 0.0 for distance 2 (opposite vectors)', () => {
    expect(l2DistanceToScore(2)).toBe(0.0);
  });

  it('returns 0.75 for distance 1.0', () => {
    expect(l2DistanceToScore(1.0)).toBe(0.75);
  });

  it('returns 0.5 for distance sqrt(2) ≈ 1.414', () => {
    expect(l2DistanceToScore(Math.SQRT2)).toBeCloseTo(0.5, 5);
  });

  it('clamps to 0 for distance > 2 (float imprecision)', () => {
    expect(l2DistanceToScore(2.0001)).toBe(0);
  });

  it('returns 0.9 for distance sqrt(0.4) ≈ 0.632', () => {
    expect(l2DistanceToScore(Math.sqrt(0.4))).toBeCloseTo(0.9, 5);
  });
});

describe('scoreToL2Distance', () => {
  it('returns 0 for score 1.0', () => {
    expect(scoreToL2Distance(1.0)).toBeCloseTo(0, 5);
  });

  it('returns 2.0 for score 0.0', () => {
    expect(scoreToL2Distance(0.0)).toBeCloseTo(2.0, 5);
  });

  it('is inverse of l2DistanceToScore', () => {
    for (const d of [0, 0.5, 1.0, 1.5, 2.0]) {
      const score = l2DistanceToScore(d);
      const roundTrip = scoreToL2Distance(score);
      expect(roundTrip).toBeCloseTo(d, 4);
    }
  });
});

describe('l2Norm', () => {
  it('returns 0 for zero vector', () => {
    expect(l2Norm(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it('returns 1 for unit vector', () => {
    expect(l2Norm(new Float32Array([1, 0, 0]))).toBeCloseTo(1.0, 5);
  });

  it('returns correct norm for [3, 4]', () => {
    expect(l2Norm(new Float32Array([3, 4]))).toBeCloseTo(5.0, 5);
  });
});

describe('l2Distance', () => {
  it('returns 0 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(l2Distance(a, a)).toBeCloseTo(0, 5);
  });

  it('returns correct distance for known vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(l2Distance(a, b)).toBeCloseTo(Math.SQRT2, 4);
  });

  it('is symmetric', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    expect(l2Distance(a, b)).toBeCloseTo(l2Distance(b, a), 5);
  });

  it('satisfies triangle inequality', () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([3, 0]);
    const c = new Float32Array([0, 4]);
    const ab = l2Distance(a, b);
    const bc = l2Distance(b, c);
    const ac = l2Distance(a, c);
    expect(ab + bc).toBeGreaterThanOrEqual(ac - 1e-6);
  });
});
