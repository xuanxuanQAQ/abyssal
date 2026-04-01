/**
 * ConceptNodeProgram — Diamond-shaped node (§3.3)
 *
 * Renders concept nodes as anti-aliased diamonds using an L1 (Manhattan)
 * distance SDF in the fragment shader. Point-sprite based rendering.
 *
 * Shader source constants are preserved for future custom WebGL implementation.
 * Currently falls back to Sigma's built-in NodeCircleProgram.
 */

import { NodeCircleProgram } from 'sigma/rendering';

// ---------------------------------------------------------------------------
// GLSL Shader Sources (preserved for future custom diamond rendering)
// ---------------------------------------------------------------------------

export const CONCEPT_NODE_VERTEX_SHADER = /* glsl */ `
precision mediump float;

// Attributes
attribute vec2 a_position;
attribute float a_size;
attribute vec4 a_color;
attribute vec4 a_id;

// Uniforms
uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;

// Varyings
varying vec4 v_color;

void main() {
  vec3 projected = u_matrix * vec3(a_position, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  // Diamond needs a slightly larger point sprite than a circle of the
  // same nominal size because the diamond's corners touch the sprite edge.
  // sqrt(2) ≈ 1.4142; we use 1.42 for a tiny margin.
  float pointSize = a_size * u_sizeRatio * u_pixelRatio * 2.0 * 1.42;
  gl_PointSize = pointSize;

  v_color = a_color;
}
`;

export const CONCEPT_NODE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;

void main() {
  // Map point-sprite coordinates to [-1, 1] centered space
  vec2 p = (gl_PointCoord - 0.5) * 2.0;

  // L1 / Manhattan distance gives a diamond (rotated square) SDF
  float d = abs(p.x) + abs(p.y);

  // Clip outside the diamond boundary
  if (d > 1.0) discard;

  // Anti-aliased edge with smooth falloff
  float alpha = 1.0 - smoothstep(0.85, 1.0, d);

  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

// ---------------------------------------------------------------------------
// Sigma.js v3 Program — uses built-in circle as fallback
// ---------------------------------------------------------------------------

/**
 * Returns NodeCircleProgram as fallback. The diamond shape requires a full
 * custom WebGL program; node type differentiation is handled via color/size
 * in the graph synchronizer's node attributes.
 */
export function createConceptNodeProgram() {
  return NodeCircleProgram;
}

export default {
  VERTEX_SHADER: CONCEPT_NODE_VERTEX_SHADER,
  FRAGMENT_SHADER: CONCEPT_NODE_FRAGMENT_SHADER,
  createProgram: createConceptNodeProgram,
};
