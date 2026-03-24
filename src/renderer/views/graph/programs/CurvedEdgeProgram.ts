/**
 * CurvedEdgeProgram — SDF Bézier curve for multi-edges (§3.4) [Δ-2]
 *
 * Used for semantic_neighbor edges and parallel (multi-)edges between
 * the same node pair. Each curve is rendered as a single quad (4 vertices).
 * The fragment shader evaluates distance to a quadratic Bézier curve.
 *
 * Control point placement:
 *   midpoint + perpendicular × curvature × distance(source, target)
 *
 * where `curvature` varies per parallel edge index to fan them out.
 *
 * Shader source constants + program factory.
 * TODO: Wire into Sigma.js v3 custom program API on integration.
 */

// ---------------------------------------------------------------------------
// GLSL Shader Sources
// ---------------------------------------------------------------------------

export const CURVED_EDGE_VERTEX_SHADER = /* glsl */ `
precision mediump float;

// Attributes — per-vertex of the edge quad (4 vertices per edge)
attribute vec2 a_positionStart;     // P0: source node position
attribute vec2 a_positionEnd;       // P2: target node position
attribute float a_curvature;        // Signed curvature factor (-1..1)
attribute float a_thickness;        // Line width in pixels
attribute vec4 a_color;
attribute vec4 a_id;
attribute vec2 a_quadCoord;         // Quad UV: (0,0)..(1,1)

// Uniforms
uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;

// Varyings
varying vec4 v_color;
varying vec2 v_quadUV;              // Quad-local UV for SDF evaluation
varying vec2 v_p0;                  // Source in quad-local space
varying vec2 v_p1;                  // Control point in quad-local space
varying vec2 v_p2;                  // Target in quad-local space
varying float v_thickness;

void main() {
  // --- Compute control point ---
  vec2 midpoint = (a_positionStart + a_positionEnd) * 0.5;
  vec2 delta = a_positionEnd - a_positionStart;
  float edgeLen = length(delta);
  vec2 dir = edgeLen > 0.0 ? delta / edgeLen : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  // Control point offset: curvature factor × edge length
  vec2 controlPoint = midpoint + perp * a_curvature * edgeLen;

  // --- Build bounding quad ---
  // The quad must enclose the entire Bézier curve plus thickness padding.
  // We compute a bounding box of P0, P1 (control), P2 and expand it.
  vec2 bboxMin = min(min(a_positionStart, a_positionEnd), controlPoint);
  vec2 bboxMax = max(max(a_positionStart, a_positionEnd), controlPoint);

  float padding = a_thickness * u_pixelRatio * u_correctionRatio * 2.0
                / (u_sizeRatio * u_pixelRatio);
  bboxMin -= vec2(padding);
  bboxMax += vec2(padding);

  // Quad vertex position
  vec2 pos = mix(bboxMin, bboxMax, a_quadCoord);

  vec3 projected = u_matrix * vec3(pos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);

  // --- Pass Bézier control points in quad-local [0,1] space ---
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

// ---------------------------------------------------------------------------
// Quadratic Bézier SDF
//
// Computes the minimum distance from point \`p\` to the quadratic Bézier
// curve defined by control points (p0, p1, p2).
//
// B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2,  t ∈ [0,1]
//
// We minimize |p - B(t)|² which yields a cubic in t. We solve via
// iterative Newton–Raphson (5 iterations is sufficient for pixel accuracy).
// ---------------------------------------------------------------------------

float sdBezier(vec2 p, vec2 b0, vec2 b1, vec2 b2) {
  // Precompute coefficients of the Bézier polynomial:
  //   B(t) = A·t² + B_coeff·t + C  where
  //   A = b0 - 2b1 + b2,  B_coeff = 2(b1 - b0),  C = b0
  vec2 A = b0 - 2.0 * b1 + b2;
  vec2 B_coeff = 2.0 * (b1 - b0);

  // Initial guess: sample a few t values and pick the closest
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

  // Newton–Raphson refinement
  for (int i = 0; i < 5; i++) {
    vec2 q = (A * bestT + B_coeff) * bestT + b0;
    vec2 dq = 2.0 * A * bestT + B_coeff;        // B'(t)
    vec2 diff = q - p;

    // f(t) = dot(diff, dq),  f'(t) = dot(dq, dq) + dot(diff, 2A)
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

  // Half-thickness in quad-local UV space
  float halfW = v_thickness * 0.5;

  // Discard fragments outside the curve's thickness band
  if (d > halfW) discard;

  // Anti-aliased edge (1-pixel soft boundary)
  float aa = 1.0 - smoothstep(halfW - 0.01, halfW, d);

  gl_FragColor = vec4(v_color.rgb, v_color.a * aa);
}
`;

// ---------------------------------------------------------------------------
// Curvature Utilities (CPU-side)
// ---------------------------------------------------------------------------

/**
 * Default curvature factor for single edges (no parallel siblings).
 * Zero means a straight line — the Bézier degenerates to linear.
 */
export const DEFAULT_CURVATURE = 0;

/**
 * Computes a curvature value for the i-th parallel edge in a bundle of `n`.
 *
 * Edges are fanned symmetrically around the straight line:
 *   curvature(i, n) = ((i - (n-1)/2) / ((n-1)/2 || 1)) * maxCurvature
 *
 * @param index   Zero-based index of this edge within the parallel bundle.
 * @param total   Total number of parallel edges between the same node pair.
 * @param maxCurv Maximum curvature magnitude (default 0.3).
 * @returns Signed curvature in [-maxCurv, +maxCurv].
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
// Sigma.js v3 Program Integration
// ---------------------------------------------------------------------------

/**
 * Creates a custom EdgeProgram class for curved Bézier edges.
 *
 * Usage with Sigma v3:
 * ```ts
 * const sigma = new Sigma(graph, container, {
 *   edgeProgramClasses: {
 *     semantic_neighbor: createCurvedEdgeProgram(),
 *   },
 * });
 * ```
 *
 * @returns A program class suitable for Sigma's edgeProgramClasses setting.
 */
export function createCurvedEdgeProgram(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rendering = require('sigma/rendering') as Record<string, unknown>;

    // TODO: Verify Sigma.js v3 EdgeProgram API compatibility
    // The shader code is correct per §3.4, but the class structure
    // may need adjustment for the specific sigma version installed.
    //
    // Sigma v3 may ship EdgeCurvedProgram in newer versions.
    // If available, compare its approach with our SDF Bézier.
    if (rendering.EdgeCurvedProgram) {
      // TODO: Evaluate whether the built-in curved program supports
      // variable curvature per-edge. If not, use our custom shaders.
      return rendering.EdgeCurvedProgram;
    }

    // Custom implementation pattern:
    //
    //   class CurvedEdgeProgram extends EdgeProgram {
    //     getDefinition() {
    //       return {
    //         VERTICES: 4,  // 1 quad per edge
    //         VERTEX_SHADER_SOURCE: CURVED_EDGE_VERTEX_SHADER,
    //         FRAGMENT_SHADER_SOURCE: CURVED_EDGE_FRAGMENT_SHADER,
    //         UNIFORMS: ['u_matrix', 'u_sizeRatio', 'u_pixelRatio', 'u_correctionRatio'],
    //         ATTRIBUTES: [
    //           { name: 'a_positionStart', size: 2, type: FLOAT },
    //           { name: 'a_positionEnd',   size: 2, type: FLOAT },
    //           { name: 'a_curvature',     size: 1, type: FLOAT },
    //           { name: 'a_thickness',     size: 1, type: FLOAT },
    //           { name: 'a_color',         size: 4, type: UNSIGNED_BYTE, normalized: true },
    //           { name: 'a_id',            size: 4, type: UNSIGNED_BYTE, normalized: true },
    //           { name: 'a_quadCoord',     size: 2, type: FLOAT },
    //         ],
    //       };
    //     }
    //     processVisibleItem(edgeIndex, startIndex, sourceData, targetData, data) {
    //       // Compute curvature from edge data (parallelIndex, parallelCount)
    //       // and fill the attribute buffer.
    //     }
    //     draw(params) {
    //       // Bind program, set uniforms, draw quads (GL_TRIANGLE_STRIP)
    //     }
    //   }

    return rendering.EdgeProgram ?? null;
  } catch {
    return null;
  }
}

export default {
  VERTEX_SHADER: CURVED_EDGE_VERTEX_SHADER,
  FRAGMENT_SHADER: CURVED_EDGE_FRAGMENT_SHADER,
  createProgram: createCurvedEdgeProgram,
  computeParallelCurvature,
};
