/**
 * ConceptNodeProgram — Diamond-shaped node (§3.3)
 *
 * Renders concept nodes as anti-aliased diamonds using an L1 (Manhattan)
 * distance SDF in the fragment shader. Point-sprite based rendering.
 *
 * Shader source constants + program factory.
 * TODO: Wire into Sigma.js v3 custom program API on integration.
 */

// ---------------------------------------------------------------------------
// GLSL Shader Sources
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
// Sigma.js v3 Program Integration
// ---------------------------------------------------------------------------

/**
 * Creates a custom NodeProgram class for diamond-shaped concept nodes.
 *
 * Usage with Sigma v3:
 * ```ts
 * const sigma = new Sigma(graph, container, {
 *   nodeProgramClasses: {
 *     concept: createConceptNodeProgram(),
 *   },
 * });
 * ```
 *
 * @returns A program class suitable for Sigma's nodeProgramClasses setting.
 */
export function createConceptNodeProgram(): unknown {
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
    //   class ConceptNodeProgram extends NodeProgram {
    //     getDefinition() {
    //       return {
    //         VERTICES: 1,
    //         ARRAY_ITEMS_PER_VERTEX: 5,
    //         VERTEX_SHADER_SOURCE: CONCEPT_NODE_VERTEX_SHADER,
    //         FRAGMENT_SHADER_SOURCE: CONCEPT_NODE_FRAGMENT_SHADER,
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
    return null;
  }
}

export default {
  VERTEX_SHADER: CONCEPT_NODE_VERTEX_SHADER,
  FRAGMENT_SHADER: CONCEPT_NODE_FRAGMENT_SHADER,
  createProgram: createConceptNodeProgram,
};
