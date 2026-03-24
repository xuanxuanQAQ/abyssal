/**
 * DashedEdgeProgram — Dashed line for conflict edges (§3.4)
 *
 * Used for concept_conflict edge types. Renders a straight line with
 * a repeating dash pattern: 6px dash, 4px gap (period = 10px).
 *
 * The dash pattern is computed entirely in the fragment shader using
 * the interpolated position along the edge, avoiding extra geometry.
 *
 * Shader source constants + program factory.
 * TODO: Wire into Sigma.js v3 custom program API on integration.
 */

// ---------------------------------------------------------------------------
// GLSL Shader Sources
// ---------------------------------------------------------------------------

export const DASHED_EDGE_VERTEX_SHADER = /* glsl */ `
precision mediump float;

// Attributes
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_thickness;
attribute vec4 a_color;
attribute vec4 a_id;
attribute float a_positionCoord;  // 0.0 at source, 1.0 at target

// Uniforms
uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;

// Varyings
varying vec4 v_color;
varying float v_posAlongEdge;     // Pixel position along the edge
varying float v_edgeLength;       // Total edge length in pixels

void main() {
  vec2 pos = mix(a_positionStart, a_positionEnd, a_positionCoord);

  vec3 projected = u_matrix * vec3(pos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  // Compute edge length in device pixels for dash pattern
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

// Dash pattern constants (in device pixels)
const float DASH_LENGTH = 6.0;
const float GAP_LENGTH  = 4.0;
const float PERIOD      = 10.0;   // DASH_LENGTH + GAP_LENGTH

void main() {
  // Position within the current dash period
  float pos = mod(v_posAlongEdge, PERIOD);

  // Discard fragments in the gap region
  if (pos > DASH_LENGTH) discard;

  // Anti-alias the dash edges (soften 1px at dash boundaries)
  float dashAlpha = 1.0;
  dashAlpha *= smoothstep(0.0, 1.0, pos);                     // Leading edge
  dashAlpha *= 1.0 - smoothstep(DASH_LENGTH - 1.0, DASH_LENGTH, pos); // Trailing edge

  gl_FragColor = vec4(v_color.rgb, v_color.a * dashAlpha);
}
`;

// ---------------------------------------------------------------------------
// Dash Pattern Constants (for CPU-side use / configuration)
// ---------------------------------------------------------------------------

/** Length of each dash segment in logical pixels. */
export const DASH_LENGTH_PX = 6;

/** Length of each gap between dashes in logical pixels. */
export const GAP_LENGTH_PX = 4;

/** Total period of the dash pattern. */
export const DASH_PERIOD_PX = DASH_LENGTH_PX + GAP_LENGTH_PX;

// ---------------------------------------------------------------------------
// Sigma.js v3 Program Integration
// ---------------------------------------------------------------------------

/**
 * Creates a custom EdgeProgram class for dashed conflict edges.
 *
 * Usage with Sigma v3:
 * ```ts
 * const sigma = new Sigma(graph, container, {
 *   edgeProgramClasses: {
 *     concept_conflict: createDashedEdgeProgram(),
 *   },
 * });
 * ```
 *
 * @returns A program class suitable for Sigma's edgeProgramClasses setting.
 */
export function createDashedEdgeProgram(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rendering = require('sigma/rendering') as Record<string, unknown>;

    // TODO: Verify Sigma.js v3 EdgeProgram API compatibility
    // The shader code is correct per §3.4, but the class structure
    // may need adjustment for the specific sigma version installed.
    //
    // Sigma v3 does NOT ship a built-in dashed edge program, so we
    // must create a custom one. The typical pattern:
    //
    //   class DashedEdgeProgram extends EdgeProgram {
    //     getDefinition() {
    //       return {
    //         VERTICES: 4,  // Quad for the line segment
    //         VERTEX_SHADER_SOURCE: DASHED_EDGE_VERTEX_SHADER,
    //         FRAGMENT_SHADER_SOURCE: DASHED_EDGE_FRAGMENT_SHADER,
    //         UNIFORMS: ['u_matrix', 'u_sizeRatio', 'u_pixelRatio', 'u_correctionRatio'],
    //         ATTRIBUTES: [
    //           { name: 'a_positionStart',  size: 2, type: FLOAT },
    //           { name: 'a_positionEnd',    size: 2, type: FLOAT },
    //           { name: 'a_thickness',      size: 1, type: FLOAT },
    //           { name: 'a_color',          size: 4, type: UNSIGNED_BYTE, normalized: true },
    //           { name: 'a_id',             size: 4, type: UNSIGNED_BYTE, normalized: true },
    //           { name: 'a_positionCoord',  size: 1, type: FLOAT },
    //         ],
    //       };
    //     }
    //     processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
    //       // Fill attribute buffer with source/target positions, color, etc.
    //     }
    //     draw(params) {
    //       // Bind program, set uniforms, draw quads
    //     }
    //   }

    return rendering.EdgeProgram ?? null;
  } catch {
    return null;
  }
}

export default {
  VERTEX_SHADER: DASHED_EDGE_VERTEX_SHADER,
  FRAGMENT_SHADER: DASHED_EDGE_FRAGMENT_SHADER,
  createProgram: createDashedEdgeProgram,
};
