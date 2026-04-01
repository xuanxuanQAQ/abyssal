/**
 * CurvedEdgeProgram — SDF Bézier curve for multi-edges (§3.4) [Δ-2]
 *
 * Used for semantic_neighbor edges and parallel (multi-)edges between
 * the same node pair. Each curve is rendered as a single quad (4 vertices).
 * The fragment shader evaluates distance to a quadratic Bézier curve.
 *
 * Shader source constants are preserved for future custom curved rendering.
 * Currently falls back to EdgeLineProgram (sigma v3 has no built-in curve program).
 */

import { EdgeLineProgram } from 'sigma/rendering';

// ---------------------------------------------------------------------------
// GLSL Shader Sources (preserved for future SDF Bézier curve rendering)
// ---------------------------------------------------------------------------

export const CURVED_EDGE_VERTEX_SHADER = /* glsl */ `
precision mediump float;

attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_curvature;
attribute float a_thickness;
attribute vec4 a_color;
attribute vec4 a_id;
attribute vec2 a_quadCoord;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_quadUV;
varying vec2 v_p0;
varying vec2 v_p1;
varying vec2 v_p2;
varying float v_thickness;

void main() {
  vec2 midpoint = (a_positionStart + a_positionEnd) * 0.5;
  vec2 delta = a_positionEnd - a_positionStart;
  float edgeLen = length(delta);
  vec2 dir = edgeLen > 0.0 ? delta / edgeLen : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  vec2 controlPoint = midpoint + perp * a_curvature * edgeLen;

  vec2 bboxMin = min(min(a_positionStart, a_positionEnd), controlPoint);
  vec2 bboxMax = max(max(a_positionStart, a_positionEnd), controlPoint);

  float padding = a_thickness * u_pixelRatio * u_correctionRatio * 2.0
                / (u_sizeRatio * u_pixelRatio);
  bboxMin -= vec2(padding);
  bboxMax += vec2(padding);

  vec2 pos = mix(bboxMin, bboxMax, a_quadCoord);

  vec3 projected = u_matrix * vec3(pos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  vec2 bboxSize = bboxMax - bboxMin;
  vec2 invSize = vec2(
    bboxSize.x > 0.0 ? 1.0 / bboxSize.x : 0.0,
    bboxSize.y > 0.0 ? 1.0 / bboxSize.y : 0.0
  );

  v_p0 = (a_positionStart - bboxMin) * invSize;
  v_p1 = (controlPoint - bboxMin) * invSize;
  v_p2 = (a_positionEnd - bboxMin) * invSize;

  v_quadUV = a_quadCoord;
  v_color = a_color;
  v_thickness = a_thickness * u_pixelRatio * u_correctionRatio
              / (length(bboxSize) * u_sizeRatio * u_pixelRatio) * 2.0;
}
`;

export const CURVED_EDGE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying vec2 v_quadUV;
varying vec2 v_p0;
varying vec2 v_p1;
varying vec2 v_p2;
varying float v_thickness;

float sdBezier(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  vec2 A = b0 - 2.0 * b1 + b2;
  vec2 B_coeff = 2.0 * (b1 - b0);

  float minDist = 1e10;
  float bestT = 0.0;

  for (int i = 0; i <= 4; i++) {
    float t = float(i) / 4.0;
    vec2 q = (A * t + B_coeff) * t + b0;
    float d = dot(p - q, p - q);
    if (d < minDist) {
      minDist = d;
      bestT = t;
    }
  }

  for (int i = 0; i < 5; i++) {
    vec2 q = (A * bestT + B_coeff) * bestT + b0;
    vec2 dq = 2.0 * A * bestT + B_coeff;
    vec2 diff = q - p;

    float f  = dot(diff, dq);
    float fp = dot(dq, dq) + dot(diff, 2.0 * A);

    if (abs(fp) > 1e-6) {
      bestT -= f / fp;
    }
    bestT = clamp(bestT, 0.0, 1.0);
  }

  vec2 nearest = (A * bestT + B_coeff) * bestT + b0;
  return length(p - nearest);
}

void main() {
  float d = sdBezier(v_quadUV, v_p0, v_p1, v_p2);

  float halfW = v_thickness * 0.5;

  if (d > halfW) discard;

  float aa = 1.0 - smoothstep(halfW - 0.01, halfW, d);

  gl_FragColor = vec4(v_color.rgb, v_color.a * aa);
}
`;

// ---------------------------------------------------------------------------
// Curvature Utilities (CPU-side)
// ---------------------------------------------------------------------------

export const DEFAULT_CURVATURE = 0;

/**
 * Computes curvature for the i-th parallel edge in a bundle of `n`.
 */
export function computeParallelCurvature(
  index: number,
  total: number,
  maxCurv = 0.3,
): number {
  if (total <= 1) return DEFAULT_CURVATURE;
  const half = (total - 1) / 2;
  return ((index - half) / (half || 1)) * maxCurv;
}

// ---------------------------------------------------------------------------
// Sigma.js v3 Program — falls back to EdgeLineProgram
// ---------------------------------------------------------------------------

/**
 * Returns EdgeLineProgram as fallback. True Bézier curve rendering requires
 * a custom WebGL program or the @sigma/edge-curve community package.
 * Parallel edges are visually differentiated by color in the graph synchronizer.
 */
export function createCurvedEdgeProgram() {
  return EdgeLineProgram;
}

export default {
  VERTEX_SHADER: CURVED_EDGE_VERTEX_SHADER,
  FRAGMENT_SHADER: CURVED_EDGE_FRAGMENT_SHADER,
  createProgram: createCurvedEdgeProgram,
  computeParallelCurvature,
};
