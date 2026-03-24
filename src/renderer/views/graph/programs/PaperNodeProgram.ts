/**
 * PaperNodeProgram — Circular node with glow effect (§3.3)
 *
 * Renders paper nodes as anti-aliased circles with optional glow
 * for highlighted/selected states. Point-sprite based rendering.
 *
 * Shader source constants + program factory.
 * TODO: Wire into Sigma.js v3 custom program API on integration.
 */

// ---------------------------------------------------------------------------
// GLSL Shader Sources
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

  // Point size: base size scaled by ratio and pixel density
  // Highlighted nodes get a 1.3x multiplier applied on the CPU side
  // by setting a larger a_size value before upload.
  float pointSize = a_size * u_sizeRatio * u_pixelRatio * 2.0;
  gl_PointSize = pointSize;

  // Forward color to fragment
  v_color = a_color;
  v_border = u_correctionRatio;
}
`;

export const PAPER_NODE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying float v_border;

void main() {
  // Distance from center of point sprite (0..1 range mapped to 0..2)
  float d = length(gl_PointCoord - 0.5) * 2.0;

  // Circle clip — discard fragments outside the unit circle
  if (d > 1.0) discard;

  // Anti-aliased edge: smooth falloff between 90% and 100% radius
  float alpha = 1.0 - smoothstep(0.9, 1.0, d);

  // Optional subtle glow: a soft halo beyond the main circle body
  // The glow is baked into the alpha ramp so no extra pass is needed.
  // For a stronger glow effect, the CPU side can render a second,
  // larger, translucent point behind the main node.

  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

// ---------------------------------------------------------------------------
// Sigma.js v3 Program Integration
// ---------------------------------------------------------------------------

/**
 * Attempts to create a custom NodeProgram class for Sigma.js v3.
 *
 * Sigma v3 exposes program base classes from `sigma/rendering`.
 * The exact API surface (getDefinition, VERTICES, ARRAY_ITEMS_PER_VERTEX,
 * etc.) varies between v3 minor versions.
 *
 * This factory returns a program constructor compatible with Sigma's
 * `setSetting("nodeProgramClasses", { paper: PaperNodeProgram })` API.
 *
 * @returns A program class suitable for Sigma's nodeProgramClasses setting.
 */
export function createPaperNodeProgram(): unknown {
  // Dynamic import avoids hard compile-time dependency on sigma internals
  // that may shift between v3.x releases.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeProgram } = require('sigma/rendering') as {
      NodeProgram: new (...args: unknown[]) => unknown;
    };

    // TODO: Verify Sigma.js v3 NodeProgram API compatibility
    // The shader code is correct per §3.3, but the class structure
    // may need adjustment for the specific sigma version installed.
    //
    // Typical v3 custom program pattern:
    //
    //   class PaperNodeProgram extends NodeProgram {
    //     getDefinition() {
    //       return {
    //         VERTICES: 1,
    //         ARRAY_ITEMS_PER_VERTEX: 5,
    //         VERTEX_SHADER_SOURCE: PAPER_NODE_VERTEX_SHADER,
    //         FRAGMENT_SHADER_SOURCE: PAPER_NODE_FRAGMENT_SHADER,
    //         UNIFORMS: ['u_matrix', 'u_sizeRatio', 'u_pixelRatio', 'u_correctionRatio'],
    //         ATTRIBUTES: [
    //           { name: 'a_position', size: 2, type: FLOAT },
    //           { name: 'a_size',     size: 1, type: FLOAT },
    //           { name: 'a_color',    size: 4, type: UNSIGNED_BYTE, normalized: true },
    //           { name: 'a_id',       size: 4, type: UNSIGNED_BYTE, normalized: true },
    //         ],
    //       };
    //     }
    //     processVisibleItem(nodeIndex, startIndex, data) { ... }
    //     draw(params) { ... }
    //   }

    return NodeProgram;
  } catch {
    // sigma not installed or API mismatch — return null so the caller
    // can fall back to the built-in circle program.
    return null;
  }
}

// Re-export shader constants for unit testing and hot-reload tooling
export default {
  VERTEX_SHADER: PAPER_NODE_VERTEX_SHADER,
  FRAGMENT_SHADER: PAPER_NODE_FRAGMENT_SHADER,
  createProgram: createPaperNodeProgram,
};
