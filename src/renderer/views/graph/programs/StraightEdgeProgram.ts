/**
 * StraightEdgeProgram — Straight line with arrowhead (§3.4)
 *
 * Used for citation and concept_agree edge types.
 * Arrow geometry: 8 device pixels length, 20° half-angle.
 *
 * Shader source constants are preserved for future custom arrow rendering.
 * Currently uses Sigma's built-in EdgeArrowProgram.
 */

import { EdgeArrowProgram } from 'sigma/rendering';

// ---------------------------------------------------------------------------
// GLSL Shader Sources (preserved for future custom arrow rendering)
// ---------------------------------------------------------------------------

export const STRAIGHT_EDGE_VERTEX_SHADER = /* glsl */ `
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
uniform vec2 u_dimensions;

varying vec4 v_color;
varying float v_posAlongEdge;
varying float v_thickness;
varying float v_edgeLength;

void main() {
  vec2 delta = a_positionEnd - a_positionStart;
  float len = length(delta);
  vec2 dir = len > 0.0 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);

  vec2 pos = mix(a_positionStart, a_positionEnd, a_positionCoord);

  float halfWidth = a_thickness * u_pixelRatio * u_correctionRatio * 0.5;

  vec3 projected = u_matrix * vec3(pos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  v_color = a_color;
  v_posAlongEdge = a_positionCoord;
  v_thickness = a_thickness * u_pixelRatio;
  v_edgeLength = len * u_sizeRatio * u_pixelRatio;
}
`;

export const STRAIGHT_EDGE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying float v_posAlongEdge;
varying float v_thickness;
varying float v_edgeLength;

const float ARROW_LENGTH = 8.0;
const float ARROW_HALF_TAN = 0.364;

void main() {
  float distFromTarget = (1.0 - v_posAlongEdge) * v_edgeLength;

  if (distFromTarget < ARROW_LENGTH) {
    float arrowHalfWidth = distFromTarget * ARROW_HALF_TAN;
  }

  float alpha = v_color.a;
  gl_FragColor = vec4(v_color.rgb, alpha);
}
`;

// ---------------------------------------------------------------------------
// Arrow Geometry Constants (for CPU-side vertex generation)
// ---------------------------------------------------------------------------

export const ARROW_LENGTH_PX = 8;
export const ARROW_HALF_ANGLE_DEG = 20;
export const ARROW_HALF_TAN = Math.tan((ARROW_HALF_ANGLE_DEG * Math.PI) / 180);

// ---------------------------------------------------------------------------
// Sigma.js v3 Program — uses built-in EdgeArrowProgram
// ---------------------------------------------------------------------------

/**
 * Returns EdgeArrowProgram which renders straight edges with arrowheads.
 */
export function createStraightEdgeProgram() {
  return EdgeArrowProgram;
}

export default {
  VERTEX_SHADER: STRAIGHT_EDGE_VERTEX_SHADER,
  FRAGMENT_SHADER: STRAIGHT_EDGE_FRAGMENT_SHADER,
  createProgram: createStraightEdgeProgram,
};
