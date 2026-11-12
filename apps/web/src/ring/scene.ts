/**
 * Pure scene model for the ring: layout, slot angles and motion. No rendering here, so the same
 * model can drive the WebGL renderer, the DOM overlay and video export. Everything advances
 * only through `step`/`update(dt)`, which keeps animation deterministic.
 */
import {
  chainBreaks,
  chainSegments,
  type ChainBreak,
  type Snapshot,
  type WinGraph,
} from '@sports-parity/core';

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Ring model: what sits in each slot around the ring.

/** A position on the ring: a team, or a break where the chain can't continue yet. */
export type Slot = { kind: 'team'; team: number } | { kind: 'break'; index: number };

export interface RingModel {
  teamCount: number;
  closed: boolean;
  /** Chains covering every team; the first is the longest. A closed circle is one segment. */
  segments: number[][];
  /** breaks[i] follows segments[i]. Empty when the circle is closed. */
  breaks: ChainBreak[];
  /** Clockwise from the top. When open, slot 0 is the break before the main chain. */
  slots: Slot[];
  slotOfTeam: Int32Array;
  slotOfBreak: Int32Array;
  /** Rim edges: each team and the next one in its chain, plus the closing edge of a circle. */
  edges: [winner: number, loser: number][];
}

export type RingSnapshot = Pick<Snapshot, 'order' | 'status'> & {
  graph: Pick<WinGraph, 'out' | 'inn'>;
};

export function buildRingModel(snapshot: RingSnapshot): RingModel {
  const { out, inn } = snapshot.graph;
  const teamCount = out.length;
  const closed = snapshot.status === 'circle';
  const segments = teamCount === 0 ? [] : chainSegments(out, snapshot.order, closed);
  const breaks = chainBreaks(out, inn, segments, closed);

  const slots: Slot[] = [];
  segments.forEach((segment, i) => {
    // The break before each segment is the one after the previous segment (wrapping round).
    if (!closed) slots.push({ kind: 'break', index: (i + segments.length - 1) % segments.length });
    for (const team of segment) slots.push({ kind: 'team', team });
  });

  const slotOfTeam = new Int32Array(teamCount).fill(-1);
  const slotOfBreak = new Int32Array(breaks.length).fill(-1);
  slots.forEach((slot, k) => {
    if (slot.kind === 'team') slotOfTeam[slot.team] = k;
    else slotOfBreak[slot.index] = k;
  });

  const edges: [number, number][] = [];
  for (const segment of segments) {
    for (let i = 0; i + 1 < segment.length; i++) edges.push([segment[i]!, segment[i + 1]!]);
  }
  const ring = segments[0];
  if (closed && ring && ring.length > 1) edges.push([ring[ring.length - 1]!, ring[0]!]);

  return { teamCount, closed, segments, breaks, slots, slotOfTeam, slotOfBreak, edges };
}

/** Angle of slot k (clockwise from the top) on an unrotated ring. */
export const slotAngle = (k: number, slotCount: number) =>
  -Math.PI / 2 + (k * TAU) / Math.max(slotCount, 1);

/** Unrotated target angle for every team. */
export function slotAngles(model: RingModel): Float64Array {
  const angles = new Float64Array(model.teamCount);
  for (let i = 0; i < model.teamCount; i++) {
    angles[i] = slotAngle(model.slotOfTeam[i]!, model.slots.length);
  }
  return angles;
}

// ---------------------------------------------------------------------------------------------
// Layouts: the full circle, the reel, and the blend between them.

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

/** The whole ring, fitted into the viewport above `bottomInset` (room for a button). */
export function ringLayout(
  width: number,
  height: number,
  slotCount: number,
  bottomInset = 0,
): RingLayout {
  const usable = Math.max(0, height - bottomInset);
  const size = Math.max(0, Math.min(width, usable));
  // Node radius scales with the spacing between slots, within readable bounds.
  const approxRadius = size / 2 - EDGE_MARGIN - MIN_NODE_RADIUS;
  const spacing = (TAU * Math.max(approxRadius, 1)) / Math.max(slotCount, 1);
  const nodeRadius = clamp(spacing * 0.3, MIN_NODE_RADIUS, MAX_NODE_RADIUS);
  const radius = Math.max(nodeRadius * 2, size / 2 - EDGE_MARGIN - nodeRadius - 4);
  return { width, height, cx: width / 2, cy: usable / 2, radius, nodeRadius };
}

/** Teams visible at once in the reel (roughly; the arc shows a little of the next ones). */
export const REEL_TEAMS_VISIBLE = 3.3;

/** Width reserved to the right of each reel node for its DOM card. */
export const reelCardWidth = (width: number) => Math.min(320, width * 0.6);
/** Gap between a reel node and its card, and between the card and the screen edge. */
export const REEL_CARD_GAP = 14;

/**
 * The reel: the right-hand side of a much bigger ring, about three teams tall. The ring's
 * center sits far off screen to the left, so the visible arc is gently curved.
 */
export function reelLayout(width: number, height: number, slotCount: number): RingLayout {
  const spacing = clamp(height / REEL_TEAMS_VISIBLE, 110, 220);
  const radius = (spacing * Math.max(slotCount, 1)) / TAU;
  const nodeRadius = clamp(spacing * 0.15, 18, 26);
  const nodeX = Math.max(
    nodeRadius + 16,
    width - reelCardWidth(width) - nodeRadius - 2 * REEL_CARD_GAP,
  );
  return { width, height, cx: nodeX - radius, cy: height / 2, radius, nodeRadius };
}

/**
 * Blend two layouts. The radius changes geometrically (it reads as a zoom) while the ring's
 * rightmost point, where the reel focuses, moves in a straight line.
 */
export function blendLayout(a: RingLayout, b: RingLayout, t: number): RingLayout {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const radius = a.radius * (b.radius / a.radius) ** t;
  const focusX = lerp(a.cx + a.radius, b.cx + b.radius, t);
  return {
    width: b.width,
    height: b.height,
    cx: focusX - radius,
    cy: lerp(a.cy, b.cy, t),
    radius,
    nodeRadius: lerp(a.nodeRadius, b.nodeRadius, t),
  };
}

// ---------------------------------------------------------------------------------------------
// Motion: teams as bodies that travel round the ring without passing through each other.

export interface MotionConfig {
  /** Spring pulling each body toward its slot, per second squared (in slots). */
  stiffness: number;
  damping: number;
  /** Speed limit in slots per second, so long trips cruise at a pace the eye can follow. */
  maxSpeed: number;
  /** How far a travelling body leaves the rim to pass the others, in node radii. */
  laneDepth: number;
  laneStiffness: number;
  /** Bodies closer than this (center to center, in node radii) push apart. */
  collideDistance: number;
}

const critical = (k: number, ratio = 1) => ratio * 2 * Math.sqrt(k);

/**
 * Week-to-week motion. Slow enough to follow: a one-slot move takes about a second, and a trip
 * halfway round cruises at `maxSpeed`. Nearly critically damped, so teams settle without
 * wobbling; the jostle comes from collisions instead.
 */
export const RING_MOTION: MotionConfig = {
  stiffness: 12,
  damping: critical(12, 0.9),
  maxSpeed: 6,
  laneDepth: 2.6,
  laneStiffness: 60,
  collideDistance: 2.4,
};

/** Break markers just glide; they don't change lanes or collide. */
export const MARKER_MOTION: MotionConfig = { ...RING_MOTION, laneDepth: 0 };

const SUBSTEP = 1 / 240;

export const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapPi = (a: number) => a - Math.round(a / TAU) * TAU;

/**
 * Bodies on the ring. Each has an angle (unrotated, radians) and a `lift` off the rim in node
 * radii (positive is outward). A body with somewhere to go moves into a lane, inside the ring
 * when travelling clockwise and outside when travelling counter-clockwise, so teams swapping
 * places pass on opposite sides of each other and slide past the teams that stay put.
 * Collisions resolve whatever the lanes don't. Deterministic: fixed substeps, fixed pair order.
 */
export class RingBodies {
  readonly angle: Float64Array;
  /** Radians per second. */
  readonly velocity: Float64Array;
  readonly target: Float64Array;
  readonly lift: Float64Array;
  private readonly liftVelocity: Float64Array;
  private stepAngle = TAU;

  constructor(
    n: number,
    private readonly config: MotionConfig = RING_MOTION,
  ) {
    this.angle = new Float64Array(n);
    this.velocity = new Float64Array(n);
    this.target = new Float64Array(n);
    this.lift = new Float64Array(n);
    this.liftVelocity = new Float64Array(n);
  }

  get count(): number {
    return this.angle.length;
  }

  /** New slot angles. `stepAngle` is the angle between neighbouring slots. */
  setTargets(targets: Float64Array, stepAngle: number, snap = false): void {
    this.stepAngle = stepAngle > 0 ? stepAngle : TAU;
    for (let i = 0; i < targets.length; i++) {
      // Unwrap the target to the copy nearest the current angle (the short way round).
      const t = targets[i]!;
      this.target[i] = t + Math.round((this.angle[i]! - t) / TAU) * TAU;
      if (snap) {
        this.angle[i] = this.target[i]!;
        this.velocity[i] = 0;
        this.lift[i] = 0;
        this.liftVelocity[i] = 0;
      }
    }
  }

  /** Shift every angle (and target) by `delta` without moving anything relative to the targets. */
  shift(delta: number): void {
    for (let i = 0; i < this.angle.length; i++) {
      this.angle[i] = this.angle[i]! + delta;
      this.target[i] = this.target[i]! + delta;
    }
  }

  /** How far body i still has to go, in slots (or lane depths, if it's still off the rim). */
  remaining(i: number): number {
    const along = Math.abs(this.target[i]! - this.angle[i]!) / this.stepAngle;
    const depth = this.config.laneDepth;
    return depth > 0 ? Math.max(along, Math.abs(this.lift[i]!) / depth) : along;
  }

  /**
   * Advance by dt seconds. `slotWidth` is the distance between neighbouring slots in node radii
   * (it changes with the zoom); 0 turns collisions off. Returns true while anything moves.
   */
  step(dt: number, slotWidth = 0): boolean {
    const { stiffness, damping, maxSpeed, laneDepth, laneStiffness } = this.config;
    const laneDamping = critical(laneStiffness);
    const step = this.stepAngle;
    const vmax = maxSpeed * step;
    // Never wider than the slots themselves, or bodies at rest would push each other forever.
    const reach = Math.min(this.config.collideDistance, slotWidth * 0.9);
    const n = this.angle.length;
    for (let t = 0; t < dt - 1e-9; t += SUBSTEP) {
      const h = Math.min(SUBSTEP, dt - t);
      for (let i = 0; i < n; i++) {
        // Along the ring, in slots: a spring with a speed limit.
        const ds = (this.target[i]! - this.angle[i]!) / step;
        const acc = stiffness * ds - damping * (this.velocity[i]! / step);
        const v = clamp(this.velocity[i]! + acc * step * h, -vmax, vmax);
        this.velocity[i] = v;
        this.angle[i] = this.angle[i]! + v * h;
        // Across the ring: into the lane for the direction of travel, back to the rim on arrival.
        const want = laneDepth * -Math.sign(ds) * smoothstep(0.15, 0.75, Math.abs(ds));
        const la = laneStiffness * (want - this.lift[i]!) - laneDamping * this.liftVelocity[i]!;
        this.liftVelocity[i] = this.liftVelocity[i]! + la * h;
        this.lift[i] = this.lift[i]! + this.liftVelocity[i]! * h;
      }
      if (reach > 0) this.collide(reach, slotWidth);
    }
    for (let i = 0; i < n; i++) {
      if (this.remaining(i) > 1e-4 || Math.abs(this.velocity[i]! / step) > 1e-3) return true;
    }
    return false;
  }

  /** Push overlapping bodies apart, half each, measured on the screen-like (slots, lift) plane. */
  private collide(reach: number, slotWidth: number): void {
    const step = this.stepAngle;
    const n = this.angle.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = (wrapPi(this.angle[j]! - this.angle[i]!) / step) * slotWidth;
        const dy = this.lift[j]! - this.lift[i]!;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2);
        // Exactly on top of each other: separate across the ring, the later index outward.
        const nx = d > 1e-9 ? dx / d : 0;
        const ny = d > 1e-9 ? dy / d : 1;
        const push = (reach - d) / 2;
        const da = ((nx * push) / slotWidth) * step;
        this.angle[i] = this.angle[i]! - da;
        this.angle[j] = this.angle[j]! + da;
        this.lift[i] = this.lift[i]! - ny * push;
        this.lift[j] = this.lift[j]! + ny * push;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Camera: zoom between the circle (z = 0) and the reel (z = 1), and scrolling along the reel.

/** Slots per second while the reel drifts: about one team every three seconds. */
export const DRIFT_SPEED = 0.33;
const ZOOM_SPRING = { stiffness: 110, damping: 2 * Math.sqrt(110) }; // critically damped
const SCROLL_SPRING = { stiffness: 70, damping: 2 * Math.sqrt(70) };
/** Fling friction, used to project where a fling would stop. */
const FLING_FRICTION = 3.5;
const WHEEL_SETTLE_SECONDS = 0.14;

/**
 * Scroll position `pos` is measured in slots: slot k sits at the reel's focus (3 o'clock)
 * when pos = k. Rotation is weighted by z, so the circle view is never rotated.
 */
export class ReelCamera {
  z = 0;
  zTarget = 0;
  private zVel = 0;
  private zHeld = false;

  pos = 0;
  private vel = 0;
  private target = 0;
  private mode: 'rest' | 'held' | 'wheel' = 'rest';
  private wheelIdle = 0;
  /** Auto-scroll. Any manual scroll turns it off; only an explicit resume turns it back on. */
  drifting = false;

  constructor(
    public slotCount = 1,
    private readonly reducedMotion = false,
  ) {}

  get stepAngle(): number {
    return TAU / Math.max(this.slotCount, 1);
  }

  /** Rotation to add to every unrotated angle. */
  rotation(): number {
    return this.z * (Math.PI / 2 - this.pos * this.stepAngle);
  }

  /** The copy of `slot` (mod slotCount) nearest to `near`. */
  private nearest(slot: number, near: number): number {
    const n = Math.max(this.slotCount, 1);
    return slot + Math.round((near - slot) / n) * n;
  }

  /** Zoom into the reel focused on `slot`. */
  dive(slot: number, drift: boolean): void {
    if (this.z < 0.02) {
      // Pick the copy of the slot that rotates the ring the short way (at most half a turn).
      const n = Math.max(this.slotCount, 1);
      const turns = Math.round((Math.PI / 2 - slot * this.stepAngle) / TAU);
      this.pos = slot + turns * n;
      this.target = this.pos;
      this.vel = 0;
      this.mode = 'rest';
    } else {
      this.goTo(slot);
    }
    this.drifting = drift && !this.reducedMotion;
    this.zTarget = 1;
    if (this.reducedMotion) this.z = 1;
  }

  /** Zoom back out to the full circle. */
  exit(): void {
    this.drifting = false;
    if (this.z === 1) this.normalize(true);
    this.zTarget = 0;
    if (this.reducedMotion) this.z = 0;
  }

  /** Scroll to a slot (the nearest copy), stopping auto-scroll. */
  goTo(slot: number): void {
    this.drifting = false;
    this.mode = 'rest';
    this.target = this.nearest(slot, this.pos);
  }

  /** Step n teams (or breaks) forward or back. */
  stepBy(n: number): void {
    const base = this.mode === 'rest' && !this.drifting ? this.target : Math.round(this.pos);
    this.drifting = false;
    this.mode = 'rest';
    this.target = base + n;
  }

  grab(): void {
    this.drifting = false;
    this.mode = 'held';
    this.vel = 0;
  }

  drag(deltaSlots: number): void {
    this.pos += deltaSlots;
  }

  /** Let go after a drag, with the finger's velocity in slots per second. */
  release(velocity: number): void {
    this.mode = 'rest';
    this.vel = velocity;
    this.target = Math.round(this.pos + velocity / FLING_FRICTION);
  }

  /** Mouse wheel or trackpad scroll; snaps to a slot shortly after the scrolling stops. */
  nudge(deltaSlots: number): void {
    this.drifting = false;
    this.mode = 'wheel';
    this.vel = 0;
    this.pos += deltaSlots;
    this.wheelIdle = 0;
  }

  setDrift(on: boolean): void {
    this.drifting = on && !this.reducedMotion;
    if (this.drifting) this.mode = 'rest';
  }

  /** Pinch sets zoom directly; on release it settles on whichever view is nearer. */
  pinch(z: number): void {
    this.zHeld = true;
    this.zVel = 0;
    this.z = clamp(z, 0, 1);
  }

  endPinch(): void {
    this.zHeld = false;
    this.zTarget = this.z > 0.5 ? 1 : 0;
    if (this.zTarget === 0) this.drifting = false;
  }

  /** Remap scroll positions after the slots change, keeping the same team in focus. */
  remap(oldModel: RingModel, newModel: RingModel): void {
    const oldN = Math.max(oldModel.slots.length, 1);
    const k = Math.round(this.pos);
    // The team at the focus, or the next team after a break.
    let anchorSlot = k;
    let team: number | undefined;
    for (let j = 0; j < oldN; j++) {
      const slot = oldModel.slots[(((k + j) % oldN) + oldN) % oldN];
      if (slot?.kind === 'team') {
        anchorSlot = k + j;
        team = slot.team;
        break;
      }
    }
    this.slotCount = newModel.slots.length;
    if (team === undefined || team >= newModel.teamCount) return;
    const newSlot = newModel.slotOfTeam[team]!;
    this.pos = newSlot + (this.pos - anchorSlot);
    this.target = newSlot + (this.target - anchorSlot);
  }

  /** Bring pos into [0, slotCount) (or the shortest-rotation range) when doing so is invisible. */
  private normalize(shortest = false): void {
    const n = Math.max(this.slotCount, 1);
    const shift = shortest
      ? -Math.round((Math.PI / 2 - this.pos * this.stepAngle) / TAU) * n
      : Math.floor(this.pos / n) * n;
    this.pos -= shift;
    this.target -= shift;
  }

  /** Advance by dt seconds. Returns true while anything is moving. */
  update(dt: number): boolean {
    for (let t = 0; t < dt - 1e-9; t += SUBSTEP) {
      const h = Math.min(SUBSTEP, dt - t);
      if (!this.zHeld) {
        if (this.reducedMotion) this.z = this.zTarget;
        const acc =
          ZOOM_SPRING.stiffness * (this.zTarget - this.z) - ZOOM_SPRING.damping * this.zVel;
        this.zVel += acc * h;
        this.z = clamp(this.z + this.zVel * h, 0, 1);
      }
      if (this.mode === 'wheel') {
        this.wheelIdle += h;
        if (this.wheelIdle > WHEEL_SETTLE_SECONDS) {
          this.mode = 'rest';
          this.target = Math.round(this.pos);
        }
      } else if (this.mode === 'rest') {
        if (this.drifting && this.z > 0.98) {
          this.pos += DRIFT_SPEED * h;
          this.target = this.pos;
          this.vel = DRIFT_SPEED;
        } else {
          const acc =
            SCROLL_SPRING.stiffness * (this.target - this.pos) - SCROLL_SPRING.damping * this.vel;
          this.vel += acc * h;
          this.pos += this.vel * h;
        }
      }
    }
    if (!this.zHeld && Math.abs(this.z - this.zTarget) < 5e-4 && Math.abs(this.zVel) < 5e-3) {
      this.z = this.zTarget;
      this.zVel = 0;
    }
    if (this.mode === 'rest' && !this.drifting) {
      if (Math.abs(this.target - this.pos) < 1e-4 && Math.abs(this.vel) < 1e-3) {
        this.pos = this.target;
        this.vel = 0;
      }
    }
    if (this.z === 0 || this.z === 1) this.normalize();
    return (
      this.zHeld ||
      this.z !== this.zTarget ||
      this.mode !== 'rest' ||
      this.pos !== this.target ||
      (this.drifting && this.z > 0.98)
    );
  }
}
