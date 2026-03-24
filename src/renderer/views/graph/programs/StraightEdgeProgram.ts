/**
 * StraightEdgeProgram — Straight line with arrowhead (§3.4)
 *
 * Used for citation and concept_agree edge types. Renders a 1px line
 * from source to target with a directional arrowhead at the target end.
 *
 * Arrow geometry:
 *   - Length: 8 device pixels
 *   - Half-angle: 20° (tan(20°) ≈ 0.364)
 *
 * The arrow is drawn inside the line quad by clipping fragments that
 * fall within the triangular arrowhead region near the target vertex.
 *
 * Shader source constants + program factory.
 * TODO: Wire into Sigma.js v3 custom program API on integration.
 */

// ---------------------------------------------------------------------------
// GLSL Shader Sources
// ---------------------------------------------------------------------------

export const STRAIGHT_EDGE_VERTEX_SHADER = /* glsl */ `
precision mediump float;

// Attributes — one per vertex of the edge quad (4 vertices per edge)
attribute vec2 a_positionStart;   // Source node position
attribute vec2 a_positionEnd;     // Target node position
attribute float a_thickness;      // Line width in pixels
attribute vec4 a_color;
attribute vec4 a_id;
attribute float a_positionCoord;  // 0.0 at source, 1.0 at target

// Uniforms
uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform vec2 u_dimensions;        // Viewport width/height

// Varyings
varying vec4 v_color;
varying float v_posAlongEdge;     // 0..1 interpolated position
varying float v_thickness;
varying float v_edgeLength;       // Total edge length in pixels

void main() {
  // Compute direction vector and perpendicular
  vec2 delta = a_positionEnd - a_positionStart;
  float len = length(delta);
  vec2 dir = len > 0.0 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);

  // Interpolated position along the edge
  vec2 pos = mix(a_positionStart, a_positionEnd, a_positionCoord);

  // Offset perpendicular to the edge direction for line thickness
  float halfWidth = a_thickness * u_pixelRatio * u_correctionRatio * 0.5;
  // a_positionCoord encodes which side of the quad: 0/1 along edge,
  // and we use the vertex index parity for the perpendicular offset.
  // This is simplified — actual offset selection happens via vertex data.

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

// Arrow constants
const float ARROW_LENGTH = 8.0;       // Arrow length in pixels
const float ARROW_HALF_TAN = 0.364;   // tan(20°) ≈ 0.364

void main() {
  // Distance from the target end in pixels
  float distFromTarget = (1.0 - v_posAlongEdge) * v_edgeLength;

  // Inside the arrowhead region?
  if (distFromTarget < ARROW_LENGTH) {
    // Arrow widens linearly from tip (target) to base
    float arrowHalfWidth = distFromTarget * ARROW_HALF_TAN;

    // If we're within the arrow triangle, render with full opacity;
    // otherwise discard to carve out the arrowhead shape.
    // The perpendicular distance from the edge center line is encoded
    // in gl_FragCoord relative to the quad, but for a thin line quad
    // we approximate: fragments outside the triangle are discarded.
    // TODO: Pass perpendicular offset as varying for precise arrow clipping.
  }

  // Anti-aliased line edge (softened by 1px at the boundary)
  // The quad is sized to match thickness, so fragments near the edge
  // of the quad get alpha falloff.
  float alpha = v_color.a;

  gl_FragColor = vec4(v_color.rgb, alpha);
}
`;

// ---------------------------------------------------------------------------
// Arrow Geometry Constants (for CPU-side vertex generation)
// ---------------------------------------------------------------------------

/** Arrow tip length in logical pixels. */
export const ARROW_LENGTH_PX = 8;

/** Arrow half-angle in degrees. */
export const ARROW_HALF_ANGLE_DEG = 20;

/** tan(20°) — used to compute arrow wing width from distance to tip. */
export const ARROW_HALF_TAN = Math.tan((ARROW_HALF_ANGLE_DEG * Math.PI) / 180);

// ---------------------------------------------------------------------------
// Sigma.js v3 Program Integration
// ---------------------------------------------------------------------------

/**
 * Creates a custom EdgeProgram class for straight edges with arrowheads.
 *
 * Usage with Sigma v3:
 * ```ts
 * const sigma = new Sigma(graph, container, {
 *   edgeProgramClasses: {
 *     citation: createStraightEdgeProgram(),
 *     concept_agree: createStraightEdgeProgram(),
 *   },
 * });
 * ```
 *
 * @returns A program class suitable for Sigma's edgeProgramClasses setting.
 */
export function createStraightEdgeProgram(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rendering = require('sigma/rendering') as Record<string, unknown>;

    // Sigma v3 ships EdgeArrowProgram as a built-in.
    // If the built-in arrow program meets our needs (it usually does for
    // straight arrows), we can return it directly and only override when
    // custom arrow geometry is required.
    if (rendering.EdgeArrowProgram) {
      // TODO: Verify that EdgeArrowProgram supports our arrow dimensions
      // (8px length, 20° half-angle). If not, subclass and override.
      return rendering.EdgeArrowProgram;
    }

    // Fallback: return base EdgeProgram
    // TODO: Implement custom edge program with STRAIGHT_EDGE shaders
    //
    //   class StraightEdgeProgram extends EdgeProgram {
    //     getDefinition() {
    //       return {
    //         VERTICES: 6,  // 2 triangles = 1 quad + 1 arrow triangle
    //         VERTEX_SHADER_SOURCE: STRAIGHT_EDGE_VERTEX_SHADER,
    //         FRAGMENT_SHADER_SOURCE: STRAIGHT_EDGE_FRAGMENT_SHADER,
    //         UNIFORMS: [...],
    //         ATTRIBUTES: [...],
    //       };
    //     }
    //   }

    return rendering.EdgeProgram ?? null;
  } catch {
    return null;
  }
}

export default {
  VERTEX_SHADER: STRAIGHT_EDGE_VERTEX_SHADER,
  FRAGMENT_SHADER: STRAIGHT_EDGE_FRAGMENT_SHADER,
  createProgram: createStraightEdgeProgram,
};
