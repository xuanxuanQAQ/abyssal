/**
 * PaperNodeProgram — Circular node with glow effect (§3.3)
 *
 * Renders paper nodes as anti-aliased circles with optional glow
 * for highlighted/selected states. Point-sprite based rendering.
 *
 * Shader source constants are preserved for future custom glow implementation.
 * Currently uses Sigma's built-in NodeCircleProgram.
 */

import { NodeCircleProgram } from 'sigma/rendering';

// ---------------------------------------------------------------------------
// GLSL Shader Sources (preserved for future custom glow rendering)
// ---------------------------------------------------------------------------

export const PAPER_NODE_VERTEX_SHADER = /* glsl */ `
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

// Varyings — passed to fragment shader
varying vec4 v_color;
varying float v_border;

void main() {
  vec3 projected = u_matrix * vec3(a_position, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  float pointSize = a_size * u_sizeRatio * u_pixelRatio * 2.0;
  gl_PointSize = pointSize;

  v_color = a_color;
  v_border = u_correctionRatio;
}
`;

export const PAPER_NODE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying float v_border;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;

  if (d > 1.0) discard;

  float alpha = 1.0 - smoothstep(0.9, 1.0, d);

  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

// ---------------------------------------------------------------------------
// Sigma.js v3 Program — uses built-in circle program
// ---------------------------------------------------------------------------

/**
 * Returns NodeCircleProgram. The circle shape matches the spec for paper nodes.
 * Glow effect can be achieved via the CPU-side highlight reducer.
 */
export function createPaperNodeProgram() {
  return NodeCircleProgram;
}

export default {
  VERTEX_SHADER: PAPER_NODE_VERTEX_SHADER,
  FRAGMENT_SHADER: PAPER_NODE_FRAGMENT_SHADER,
  createProgram: createPaperNodeProgram,
};
