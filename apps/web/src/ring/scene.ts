/**
 * Pure scene model for the ring: layout, slot angles and spring motion. No rendering here,
 * so the same model can drive the WebGL renderer, the accessible overlay and video export.
 * Everything advances only through `step(dt)`, which keeps animation deterministic.
 */
import type { Snapshot } from '@sports-parity/core';

export interface RingLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
  nodeRadius: number;
}

const MIN_NODE_RADIUS = 9;
const MAX_NODE_RADIUS = 22;
const EDGE_MARGIN = 12;

export function ringLayout(width: number, height: number, teamCount: number): RingLayout {
  const size = Math.max(0, Math.min(width, height));
  // Node radius scales with the spacing between slots, within readable bounds.
  const approxRadius = size / 2 - EDGE_MARGIN - MIN_NODE_RADIUS;
  const spacing = (2 * Math.PI * Math.max(approxRadius, 1)) / Math.max(teamCount, 1);
  const nodeRadius = Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, spacing * 0.3));
  const radius = Math.max(nodeRadius * 2, size / 2 - EDGE_MARGIN - nodeRadius - 4);
  return { width, height, cx: width / 2, cy: height / 2, radius, nodeRadius };
}

/**
 * Target angle for every team. The ring order fills the slots clockwise from the top. Unless
 * the circle is complete, one empty slot is left at the top: the visible gap where it would close.
 * Teams outside the current longest chain (partial status) sit after the chain.
 */
export function slotAngles(
  snapshot: Pick<Snapshot, 'order' | 'status'>,
  teamCount: number,
): Float64Array {
  const placed = new Set(snapshot.order);
  const rest = Array.from({ length: teamCount }, (_, i) => i).filter((i) => !placed.has(i));
  const sequence = [...snapshot.order, ...rest];
  const closed = snapshot.status === 'circle';
  const slots = closed ? teamCount : teamCount + 1;
  const step = (2 * Math.PI) / slots;
  const angles = new Float64Array(teamCount);
  sequence.forEach((team, i) => {
    // Closed: first team at the top. Open: the gap slot (index slots-1) lands at the top.
    angles[team] = -Math.PI / 2 + (closed ? i : i + 1) * step;
  });
  return angles;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Slightly underdamped: nodes overshoot a touch and settle, like objects in a jar. */
export const JAR_SPRING: SpringConfig = { stiffness: 90, damping: 13 };

/** Springs on each node's angle around the ring, always taking the short way round. */
export class AngleSprings {
  readonly angle: Float64Array;
  readonly velocity: Float64Array;
  readonly target: Float64Array;

  constructor(
    n: number,
    private readonly config: SpringConfig = JAR_SPRING,
  ) {
    this.angle = new Float64Array(n);
    this.velocity = new Float64Array(n);
    this.target = new Float64Array(n);
  }

  setTargets(targets: Float64Array, snap = false): void {
    for (let i = 0; i < targets.length; i++) {
      // Unwrap the target to the copy nearest the current angle.
      const t = targets[i]!;
      const turns = Math.round((this.angle[i]! - t) / (2 * Math.PI));
      this.target[i] = t + turns * 2 * Math.PI;
      if (snap) {
        this.angle[i] = this.target[i]!;
        this.velocity[i] = 0;
      }
    }
  }

  /** Advance by dt seconds. Returns true while anything is still moving. */
  step(dt: number): boolean {
    const { stiffness, damping } = this.config;
    let moving = false;
    // Fixed substeps keep the integration stable and identical for any frame rate.
    const sub = 1 / 240;
    for (let t = 0; t < dt - 1e-9; t += sub) {
      const h = Math.min(sub, dt - t);
      for (let i = 0; i < this.angle.length; i++) {
        const force = stiffness * (this.target[i]! - this.angle[i]!) - damping * this.velocity[i]!;
        this.velocity[i] = this.velocity[i]! + force * h;
        this.angle[i] = this.angle[i]! + this.velocity[i]! * h;
      }
    }
    for (let i = 0; i < this.angle.length; i++) {
      if (Math.abs(this.target[i]! - this.angle[i]!) > 1e-4 || Math.abs(this.velocity[i]!) > 1e-3)
        moving = true;
    }
    return moving;
  }
}

/** Primary edges for a snapshot: consecutive pairs in ring order, plus the closing edge. */
export function primaryEdges(snapshot: Pick<Snapshot, 'order' | 'status'>): [number, number][] {
  const { order } = snapshot;
  const edges: [number, number][] = [];
  for (let i = 0; i + 1 < order.length; i++) edges.push([order[i]!, order[i + 1]!]);
  if (snapshot.status === 'circle' && order.length > 1)
    edges.push([order[order.length - 1]!, order[0]!]);
  return edges;
}
