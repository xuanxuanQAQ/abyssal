/**
 * ForceAtlas2 parameter constants (§4.2).
 */

export const FA2_SETTINGS = {
  gravity: 1.0,
  scalingRatio: 2.0,
  strongGravityMode: true,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  slowDown: 10,
  outboundAttractionDistribution: true,
  adjustSizes: true,
  edgeWeightInfluence: 1.0,
  linLogMode: false,
} as const;

export const LAYOUT_PHASES = {
  FULL_SPEED_ITERATIONS: 100,
  MEDIUM_SPEED_ITERATIONS: 200,
  SLOW_SPEED_ITERATIONS: 300,
  MEDIUM_SLOWDOWN_MULTIPLIER: 2,
  SLOW_SLOWDOWN_MULTIPLIER: 4,
} as const;

export const PIN_AND_COOL = {
  SAFE_DISTANCE_RATIO: 0.5,
  PHASE2_ITERATIONS: 50,
  PHASE2_SLOWDOWN_MULTIPLIER: 3,
  PHASE3_ITERATIONS: 50,
  PHASE3_SLOWDOWN_MULTIPLIER: 2,
} as const;
