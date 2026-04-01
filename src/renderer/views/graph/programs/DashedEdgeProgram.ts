/**
 * DashedEdgeProgram — Dashed line for conflict edges (§3.4)
 *
 * Used for concept_conflict edge types. Renders a straight line with
 * a repeating dash pattern: 6px dash, 4px gap (period = 10px).
 *
 * Shader source constants are preserved for future custom dashed rendering.
 * Currently falls back to EdgeLineProgram.
 */

import { EdgeLineProgram } from 'sigma/rendering';

// ---------------------------------------------------------------------------
// GLSL Shader Sources (preserved for future custom dashed rendering)
// ---------------------------------------------------------------------------

export const DASHED_EDGE_VERTEX_SHADER = /* glsl */ `
precision mediump float;

attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_thickness;
attribute vec4 a_color;
attribute vec4 a_id;
attribute float a_positionCoord;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying float v_posAlongEdge;
varying float v_edgeLength;

void main() {
  vec2 pos = mix(a_positionStart, a_positionEnd, a_positionCoord);

  vec3 projected = u_matrix * vec3(pos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  vec2 delta = a_positionEnd - a_positionStart;
  float edgeLen = length(delta) * u_sizeRatio * u_pixelRatio;

  v_color = a_color;
  v_posAlongEdge = a_positionCoord * edgeLen;
  v_edgeLength = edgeLen;
}
`;

export const DASHED_EDGE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying float v_posAlongEdge;
varying float v_edgeLength;

const float DASH_LENGTH = 6.0;
const float GAP_LENGTH  = 4.0;
const float PERIOD      = 10.0;

void main() {
  float pos = mod(v_posAlongEdge, PERIOD);

  if (pos > DASH_LENGTH) discard;

  float dashAlpha = 1.0;
  dashAlpha *= smoothstep(0.0, 1.0, pos);
  dashAlpha *= 1.0 - smoothstep(DASH_LENGTH - 1.0, DASH_LENGTH, pos);

  gl_FragColor = vec4(v_color.rgb, v_color.a * dashAlpha);
}
`;

// ---------------------------------------------------------------------------
// Dash Pattern Constants (for CPU-side use / configuration)
// ---------------------------------------------------------------------------

export const DASH_LENGTH_PX = 6;
export const GAP_LENGTH_PX = 4;
export const DASH_PERIOD_PX = DASH_LENGTH_PX + GAP_LENGTH_PX;

// ---------------------------------------------------------------------------
// Sigma.js v3 Program — falls back to EdgeLineProgram
// ---------------------------------------------------------------------------

/**
 * Returns EdgeLineProgram as fallback. True dashed rendering requires a
 * custom WebGL program. Conflict edges are visually differentiated by
 * color (red) in the graph synchronizer.
 */
export function createDashedEdgeProgram() {
  return EdgeLineProgram;
}

export default {
  VERTEX_SHADER: DASHED_EDGE_VERTEX_SHADER,
  FRAGMENT_SHADER: DASHED_EDGE_FRAGMENT_SHADER,
  createProgram: createDashedEdgeProgram,
};
