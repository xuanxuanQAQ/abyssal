/**
 * ForceAtlas2 Web Worker with Pin-and-Cool + velocity clamping
 * (§4.3, §4.4, Δ-1, Δ-6, Δ-7).
 *
 * This runs in a Web Worker context — no React or DOM APIs.
 */

import Graph from 'graphology';

// @ts-expect-error graphology-layout-forceatlas2/iterate lacks type declarations
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import iterate from 'graphology-layout-forceatlas2/iterate';

import { FA2_SETTINGS, LAYOUT_PHASES, PIN_AND_COOL } from './layoutSettings';
import {
  computeGlobalSpeed,
  detectConvergence,
} from './convergenceDetector';
import {
  clampVelocities,
  computeGraphDiameter,
  computeMaxVelocity,
} from './velocityClamp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeInit {
  id: string;
  x: number;
  y: number;
  size: number;
}

interface EdgeInit {
  source: string;
  target: string;
  weight: number;
}

type IncomingMessage =
  | { type: 'init'; nodes: NodeInit[]; edges: EdgeInit[] }
  | { type: 'control'; action: 'start' | 'pause' | 'resume' | 'stop' }
  | { type: 'pinNode'; nodeId: string; x: number; y: number }
  | { type: 'unpinNode'; nodeId: string }
  | { type: 'addNodes'; newNodes: NodeInit[]; newEdges: EdgeInit[] }
  | { type: 'returnBuffer'; buffer: Float32Array };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let graph: Graph | null = null;
let running = false;
let iteration = 0;
let currentSlowDown = FA2_SETTINGS.slowDown;

// [Δ-7] Double buffer
let bufA: Float32Array | null = null;
let bufB: Float32Array | null = null;
let useBufferA = true;
let pendingReturnBuffer: Float32Array | null = null;

// Fixed (pinned) nodes
const pinnedNodes = new Set<string>();

// Node ordering for consistent buffer packing
let nodeOrder: string[] = [];

// Previous positions for velocity/convergence calculations
let previousPositions: Float32Array | null = null;

// Phase tracking
let totalIterations = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allocateBuffers(nodeCount: number): void {
  bufA = new Float32Array(nodeCount * 2);
  bufB = new Float32Array(nodeCount * 2);
  previousPositions = new Float32Array(nodeCount * 2);
}

function packPositions(buf: Float32Array): void {
  if (!graph) return;
  for (let i = 0; i < nodeOrder.length; i++) {
    const nodeId = nodeOrder[i];
    const attrs = graph.getNodeAttributes(nodeId);
    buf[i * 2] = attrs.x as number;
    buf[i * 2 + 1] = attrs.y as number;
  }
}

function savePreviousPositions(): void {
  if (!graph || !previousPositions) return;
  for (let i = 0; i < nodeOrder.length; i++) {
    const nodeId = nodeOrder[i];
    const attrs = graph.getNodeAttributes(nodeId);
    previousPositions[i * 2] = attrs.x as number;
    previousPositions[i * 2 + 1] = attrs.y as number;
  }
}

function applyPositionsFromBuffer(buf: Float32Array): void {
  if (!graph) return;
  for (let i = 0; i < nodeOrder.length; i++) {
    const nodeId = nodeOrder[i];
    graph.setNodeAttribute(nodeId, 'x', buf[i * 2]);
    graph.setNodeAttribute(nodeId, 'y', buf[i * 2 + 1]);
  }
}

function restorePinnedNodes(): void {
  if (!graph) return;
  for (const nodeId of pinnedNodes) {
    const attrs = graph.getNodeAttributes(nodeId);
    if (attrs._pinX !== undefined && attrs._pinY !== undefined) {
      graph.setNodeAttribute(nodeId, 'x', attrs._pinX);
      graph.setNodeAttribute(nodeId, 'y', attrs._pinY);
    }
  }
}

function getEffectiveSlowDown(): number {
  if (totalIterations < LAYOUT_PHASES.FULL_SPEED_ITERATIONS) {
    return currentSlowDown;
  } else if (
    totalIterations <
    LAYOUT_PHASES.FULL_SPEED_ITERATIONS + LAYOUT_PHASES.MEDIUM_SPEED_ITERATIONS
  ) {
    return currentSlowDown * LAYOUT_PHASES.MEDIUM_SLOWDOWN_MULTIPLIER;
  } else {
    return currentSlowDown * LAYOUT_PHASES.SLOW_SLOWDOWN_MULTIPLIER;
  }
}

function getCurrentBuffer(): Float32Array | null {
  if (useBufferA) {
    return bufA;
  }
  return bufB;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function runIteration(): void {
  if (!running || !graph || !previousPositions) return;

  const nodeCount = nodeOrder.length;
  if (nodeCount === 0) return;

  // 1. Save previous positions
  savePreviousPositions();

  // 2. Run one FA2 iteration with current slowDown
  const effectiveSlowDown = getEffectiveSlowDown();
  const settings = {
    ...FA2_SETTINGS,
    slowDown: effectiveSlowDown,
  };

  iterate(graph, settings);

  // Restore pinned node positions (FA2 may have moved them)
  restorePinnedNodes();

  // 3. Pick a buffer to send
  let outBuffer = getCurrentBuffer();
  if (!outBuffer) {
    // If both buffers are in-flight, use the pending return buffer
    if (pendingReturnBuffer) {
      outBuffer = pendingReturnBuffer;
      pendingReturnBuffer = null;
    } else {
      // Cannot send this frame — skip
      scheduleNext();
      return;
    }
  }

  // 4. Pack positions into the buffer
  packPositions(outBuffer);

  // 5. Apply velocity clamping
  const graphDiameter = computeGraphDiameter(outBuffer, nodeCount);
  const maxVelocity = computeMaxVelocity(graphDiameter);

  const clampResult = clampVelocities(
    outBuffer,
    previousPositions,
    nodeCount,
    maxVelocity,
  );

  if (clampResult.nanDetected) {
    self.postMessage({
      type: 'error',
      message: `NaN detected in ${clampResult.nanNodeIndices.length} node(s): [${clampResult.nanNodeIndices.join(', ')}]. Positions reset to centroid.`,
    });
    // Write clamped positions back to graph
    applyPositionsFromBuffer(outBuffer);
  }

  if (clampResult.clamped) {
    // Write clamped positions back to graph
    applyPositionsFromBuffer(outBuffer);
  }

  // 6. Compute global speed + convergence
  const globalSpeed = computeGlobalSpeed(
    outBuffer,
    previousPositions,
    nodeCount,
  );
  const convergence = detectConvergence(globalSpeed);

  iteration++;
  totalIterations++;

  // 7. Transfer buffer
  const transferBuffer = outBuffer;
  // Mark this buffer as in-flight
  if (useBufferA && outBuffer === bufA) {
    bufA = null;
  } else if (!useBufferA && outBuffer === bufB) {
    bufB = null;
  }
  useBufferA = !useBufferA;

  const msg = {
    type: 'positions',
    buffer: transferBuffer,
    globalSpeed,
    iteration,
  };
  const transfer = [transferBuffer.buffer] as unknown as Transferable[];
  // Worker context postMessage with Transferable
  (self.postMessage as (msg: unknown, transfer: Transferable[]) => void)(msg, transfer);

  // 8. Convergence: auto-pause
  if (convergence.isConverged) {
    running = false;
    self.postMessage({ type: 'converged' });
    return;
  }

  scheduleNext();
}

function scheduleNext(): void {
  if (running) {
    setTimeout(runIteration, 0);
  }
}

// ---------------------------------------------------------------------------
// Pin-and-Cool: 3-phase incremental layout (§4.4, Δ-1)
// ---------------------------------------------------------------------------

function pinAndCool(newNodes: NodeInit[], newEdges: EdgeInit[]): void {
  if (!graph) return;

  const existingNodeIds = new Set(graph.nodes());

  // Phase 1: safe init — place new nodes near their neighbors
  for (const node of newNodes) {
    let initX = node.x;
    let initY = node.y;

    // Try to place near existing connected neighbors
    const connectedEdges = newEdges.filter(
      (e) =>
        (e.source === node.id && existingNodeIds.has(e.target)) ||
        (e.target === node.id && existingNodeIds.has(e.source)),
    );

    if (connectedEdges.length > 0) {
      let sumX = 0;
      let sumY = 0;
      for (const edge of connectedEdges) {
        const neighborId =
          edge.source === node.id ? edge.target : edge.source;
        if (graph.hasNode(neighborId)) {
          sumX += graph.getNodeAttribute(neighborId, 'x') as number;
          sumY += graph.getNodeAttribute(neighborId, 'y') as number;
        }
      }
      const neighborCount = connectedEdges.length;
      const diameter = computeGraphDiameter(
        previousPositions ?? new Float32Array(0),
        nodeOrder.length,
      );
      const offset = diameter * PIN_AND_COOL.SAFE_DISTANCE_RATIO;
      initX = sumX / neighborCount + (Math.random() - 0.5) * offset;
      initY = sumY / neighborCount + (Math.random() - 0.5) * offset;
    }

    graph.addNode(node.id, { x: initX, y: initY, size: node.size });
  }

  for (const edge of newEdges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      if (!graph.hasEdge(edge.source, edge.target)) {
        graph.addEdge(edge.source, edge.target, { weight: edge.weight });
      }
    }
  }

  // Rebuild node order and buffers
  nodeOrder = graph.nodes();
  const nodeCount = nodeOrder.length;
  allocateBuffers(nodeCount);

  // Pin all old nodes
  for (const nodeId of existingNodeIds) {
    pinnedNodes.add(nodeId);
    const attrs = graph.getNodeAttributes(nodeId);
    graph.setNodeAttribute(nodeId, '_pinX', attrs.x);
    graph.setNodeAttribute(nodeId, '_pinY', attrs.y);
  }

  // Phase 2: iterate with old nodes fixed
  const phase2Settings = {
    ...FA2_SETTINGS,
    slowDown:
      FA2_SETTINGS.slowDown * PIN_AND_COOL.PHASE2_SLOWDOWN_MULTIPLIER,
  };
  for (let i = 0; i < PIN_AND_COOL.PHASE2_ITERATIONS; i++) {
    savePreviousPositions();
    iterate(graph, phase2Settings);
    restorePinnedNodes();
  }

  // Unpin old nodes
  for (const nodeId of existingNodeIds) {
    pinnedNodes.delete(nodeId);
    graph.removeNodeAttribute(nodeId, '_pinX');
    graph.removeNodeAttribute(nodeId, '_pinY');
  }

  // Phase 3: iterate with all nodes free but high slowDown
  const phase3Settings = {
    ...FA2_SETTINGS,
    slowDown:
      FA2_SETTINGS.slowDown * PIN_AND_COOL.PHASE3_SLOWDOWN_MULTIPLIER,
  };
  for (let i = 0; i < PIN_AND_COOL.PHASE3_ITERATIONS; i++) {
    savePreviousPositions();
    iterate(graph, phase3Settings);
    restorePinnedNodes(); // still respect user-pinned nodes
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<IncomingMessage>): void => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      graph = new Graph();

      for (const node of msg.nodes) {
        graph.addNode(node.id, { x: node.x, y: node.y, size: node.size });
      }

      for (const edge of msg.edges) {
        if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
          graph.addEdge(edge.source, edge.target, { weight: edge.weight });
        }
      }

      nodeOrder = graph.nodes();
      const nodeCount = nodeOrder.length;
      allocateBuffers(nodeCount);
      iteration = 0;
      totalIterations = 0;
      currentSlowDown = FA2_SETTINGS.slowDown;
      break;
    }

    case 'control': {
      switch (msg.action) {
        case 'start':
          running = true;
          scheduleNext();
          break;
        case 'pause':
          running = false;
          break;
        case 'resume':
          running = true;
          scheduleNext();
          break;
        case 'stop':
          running = false;
          iteration = 0;
          totalIterations = 0;
          break;
      }
      break;
    }

    case 'pinNode': {
      if (graph && graph.hasNode(msg.nodeId)) {
        pinnedNodes.add(msg.nodeId);
        graph.setNodeAttribute(msg.nodeId, 'x', msg.x);
        graph.setNodeAttribute(msg.nodeId, 'y', msg.y);
        graph.setNodeAttribute(msg.nodeId, '_pinX', msg.x);
        graph.setNodeAttribute(msg.nodeId, '_pinY', msg.y);
      }
      break;
    }

    case 'unpinNode': {
      if (graph && graph.hasNode(msg.nodeId)) {
        pinnedNodes.delete(msg.nodeId);
        graph.removeNodeAttribute(msg.nodeId, '_pinX');
        graph.removeNodeAttribute(msg.nodeId, '_pinY');
      }
      break;
    }

    case 'addNodes': {
      // [Δ-1] Pin-and-Cool 3-phase incremental layout
      const wasRunning = running;
      running = false;
      pinAndCool(msg.newNodes, msg.newEdges);
      if (wasRunning) {
        running = true;
        scheduleNext();
      }
      break;
    }

    case 'returnBuffer': {
      // [Δ-7] Double-buffer return: reclaim the transferred buffer
      const returned = msg.buffer;
      if (!bufA) {
        bufA = returned;
      } else if (!bufB) {
        bufB = returned;
      } else {
        // Both slots full; keep as pending
        pendingReturnBuffer = returned;
      }
      break;
    }
  }
};
