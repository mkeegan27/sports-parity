import { describe, expect, it } from 'vitest';
import {
  blendLayout,
  buildRingModel,
  ReelCamera,
  RING_MOTION,
  RingBodies,
  reelLayout,
  ringLayout,
  slotAngle,
  slotAngles,
  type RingSnapshot,
} from './scene';

/** Snapshot over n teams with the given wins as [winner, loser] pairs. */
function snap(
  n: number,
  wins: [number, number][],
  order: number[],
  status: RingSnapshot['status'],
): RingSnapshot {
  const out = new Uint32Array(n);
  const inn = new Uint32Array(n);
  for (const [w, l] of wins) {
    out[w] = (out[w]! | (1 << l)) >>> 0;
    inn[l] = (inn[l]! | (1 << w)) >>> 0;
  }
  return { order, status, graph: { out, inn } };
}

const run = (fn: (dt: number) => unknown, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) fn(dt);
};

describe('ring model', () => {
  it('closes a circle with no breaks', () => {
    const m = buildRingModel(
      snap(
        3,
        [
          [2, 0],
          [0, 1],
          [1, 2],
        ],
        [2, 0, 1],
        'circle',
      ),
    );
    expect(m.slots.map((s) => (s.kind === 'team' ? s.team : 'gap'))).toEqual([2, 0, 1]);
    expect(m.edges).toHaveLength(3);
    expect(slotAngles(m)[2]).toBeCloseTo(-Math.PI / 2);
  });

  it('leaves a break at the top of an unclosed chain', () => {
    const m = buildRingModel(
      snap(
        3,
        [
          [2, 0],
          [0, 1],
        ],
        [2, 0, 1],
        'chain',
      ),
    );
    expect(m.slots.map((s) => (s.kind === 'team' ? s.team : 'gap'))).toEqual(['gap', 2, 0, 1]);
    expect(m.breaks).toEqual([{ after: 1, before: 2, reason: 'winless' }]);
    expect(m.edges).toEqual([
      [2, 0],
      [0, 1],
    ]);
    expect(slotAngles(m)[2]).toBeCloseTo(slotAngle(1, 4));
  });

  it('groups leftover teams into their own chains, each followed by a break', () => {
    // Main chain 0 -> 1 -> 2; leftovers 3 -> 4 and 5 alone.
    const m = buildRingModel(
      snap(
        6,
        [
          [0, 1],
          [1, 2],
          [3, 4],
        ],
        [0, 1, 2],
        'partial',
      ),
    );
    expect(m.segments).toEqual([[0, 1, 2], [3, 4], [5]]);
    expect(m.slots.map((s) => (s.kind === 'team' ? s.team : `b${s.index}`))).toEqual([
      'b2',
      0,
      1,
      2,
      'b0',
      3,
      4,
      'b1',
      5,
    ]);
    expect(m.edges).toContainEqual([3, 4]);
  });
});

describe('layouts', () => {
  it('fits the circle inside the viewport with a minimum node size', () => {
    const phone = ringLayout(375, 500, 33);
    expect(phone.radius + phone.nodeRadius).toBeLessThanOrEqual(375 / 2);
    expect(phone.nodeRadius).toBeGreaterThanOrEqual(9);
    expect(ringLayout(120, 120, 33).nodeRadius).toBe(9);
    // The bottom inset keeps the ring clear of a button.
    const inset = ringLayout(375, 420, 33, 60);
    expect(inset.cy + inset.radius + inset.nodeRadius).toBeLessThanOrEqual(360);
  });

  it('shows about three teams in the reel, with room for cards', () => {
    const reel = reelLayout(375, 560, 33);
    const spacing = (reel.radius * 2 * Math.PI) / 33;
    expect(560 / spacing).toBeGreaterThan(3);
    expect(560 / spacing).toBeLessThan(4);
    // The focused node (3 o'clock) is on screen with a card's width to its right.
    const x = reel.cx + reel.radius;
    expect(x).toBeGreaterThan(0);
    expect(375 - x).toBeGreaterThan(200);
  });

  it('blends from circle to reel continuously', () => {
    const a = ringLayout(375, 560, 33);
    const b = reelLayout(375, 560, 33);
    expect(blendLayout(a, b, 0)).toEqual(a);
    expect(blendLayout(a, b, 1)).toEqual(b);
    const mid = blendLayout(a, b, 0.5);
    expect(mid.radius).toBeGreaterThan(a.radius);
    expect(mid.radius).toBeLessThan(b.radius);
  });
});

describe('ring bodies', () => {
  const TAU = Math.PI * 2;
  const n = 8;
  const step = TAU / n;
  const SLOT_WIDTH = 3.3; // node radii between slots, as in the phone circle
  /** Bodies sitting in slots `from`, then sent to slots `to`. */
  const bodies = (from: number[], to: number[]) => {
    const b = new RingBodies(from.length);
    b.setTargets(
      Float64Array.from(from, (k) => k * step),
      step,
      true,
    );
    b.setTargets(
      Float64Array.from(to, (k) => k * step),
      step,
    );
    return b;
  };
  /** Closest any two bodies get (center to center, node radii) while settling. */
  const closest = (b: RingBodies, seconds: number, dt = 1 / 60) => {
    let min = Infinity;
    run(
      (h) => {
        b.step(h, SLOT_WIDTH);
        for (let i = 0; i < b.count; i++) {
          for (let j = i + 1; j < b.count; j++) {
            const da = b.angle[j]! - b.angle[i]!;
            const dx = ((da - Math.round(da / TAU) * TAU) / step) * SLOT_WIDTH;
            const dy = b.lift[j]! - b.lift[i]!;
            min = Math.min(min, Math.hypot(dx, dy));
          }
        }
      },
      seconds,
      dt,
    );
    return min;
  };

  it('settles on the targets the short way round, independent of frame rate', () => {
    const settle = (dt: number) => {
      const b = new RingBodies(1);
      b.setTargets(Float64Array.of(3), step, true);
      b.setTargets(Float64Array.of(3 + TAU - 0.5), step); // nearest copy is 2.5
      run((h) => b.step(h), 4, dt);
      return [b.angle[0]!, b.lift[0]!];
    };
    expect(settle(1 / 60)[0]).toBeCloseTo(2.5, 3);
    expect(settle(1 / 60)[1]).toBeCloseTo(0, 3);
    expect(settle(1 / 60)[0]).toBeCloseTo(settle(1 / 30)[0]!, 6);
  });

  it('moves slowly enough to follow: a one-slot step takes about a second', () => {
    const b = bodies([0], [1]);
    run((h) => b.step(h), 0.4);
    expect(b.remaining(0)).toBeGreaterThan(0.25); // still well on its way
    run((h) => b.step(h), 1.6);
    expect(b.remaining(0)).toBeLessThan(0.01);
  });

  it('cruises at the speed limit on long trips', () => {
    // Half way round a 32-team ring, as for an NFL team.
    const step32 = TAU / 32;
    const b = new RingBodies(1);
    b.setTargets(Float64Array.of(0), step32, true);
    b.setTargets(Float64Array.of(16 * step32 - 1e-6), step32);
    let fastest = 0;
    run((h) => {
      b.step(h);
      fastest = Math.max(fastest, Math.abs(b.velocity[0]!) / step32);
    }, 5);
    expect(fastest).toBeCloseTo(RING_MOTION.maxSpeed, 3);
    expect(b.remaining(0)).toBeLessThan(0.01);
  });

  it('lets neighbours swap places without passing through each other', () => {
    const b = bodies([0, 1], [1, 0]);
    expect(closest(b, 4)).toBeGreaterThan(RING_MOTION.collideDistance * 0.9);
    // Clockwise travel takes the inside lane, counter-clockwise the outside.
    const c = bodies([0, 1], [1, 0]);
    run((h) => c.step(h, SLOT_WIDTH), 0.5);
    expect(c.lift[0]).toBeLessThan(-1);
    expect(c.lift[1]).toBeGreaterThan(1);
  });

  it('keeps teams apart through a full reversal, then settles', () => {
    const from = [0, 1, 2, 3, 4, 5, 6, 7];
    const b = bodies(from, [...from].reverse());
    expect(closest(b, 8)).toBeGreaterThan(RING_MOTION.collideDistance * 0.75);
    for (let i = 0; i < n; i++) expect(b.remaining(i)).toBeLessThan(0.01);
  });

  it('untangles a full reshuffle of 32 teams within a few seconds, staying near the rim', () => {
    const step33 = TAU / 33; // 32 teams and a break
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const perm = [...Array(32).keys()];
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j]!, perm[i]!];
    }
    const b = new RingBodies(32);
    b.setTargets(
      Float64Array.from(perm, (_, i) => i * step33),
      step33,
      true,
    );
    b.setTargets(
      Float64Array.from(perm, (k) => k * step33),
      step33,
    );
    let maxLift = 0;
    run((h) => {
      b.step(h, SLOT_WIDTH);
      for (let i = 0; i < 32; i++) maxLift = Math.max(maxLift, Math.abs(b.lift[i]!));
    }, 5);
    for (let i = 0; i < 32; i++) expect(b.remaining(i)).toBeLessThan(0.02);
    expect(maxLift).toBeLessThan(RING_MOTION.laneDepth + 1);
  });

  it('shifts everything without disturbing the motion', () => {
    const b = bodies([0, 1], [1, 0]);
    b.shift(1);
    expect(b.angle[0]).toBeCloseTo(1);
    expect(b.target[0]).toBeCloseTo(1 + step);
  });
});

describe('reel camera', () => {
  const visible = (cam: ReelCamera, slot: number) => {
    const a = slotAngle(slot, cam.slotCount) + cam.rotation();
    return Math.atan2(Math.sin(a), Math.cos(a));
  };

  it('never rotates the circle view', () => {
    const cam = new ReelCamera(10);
    cam.pos = 7;
    expect(cam.rotation()).toBeCloseTo(0);
  });

  it('dives to bring a team to the focus, rotating at most half a turn', () => {
    for (const slot of [0, 3, 6, 9]) {
      const cam = new ReelCamera(10);
      cam.dive(slot, false);
      expect(Math.abs(Math.PI / 2 - cam.pos * cam.stepAngle)).toBeLessThanOrEqual(Math.PI + 1e-9);
      run((dt) => cam.update(dt), 3);
      expect(cam.z).toBe(1);
      expect(visible(cam, slot)).toBeCloseTo(0, 6);
    }
  });

  it('drifts forward until the user scrolls, then stays stopped', () => {
    const cam = new ReelCamera(10);
    cam.dive(2, true);
    run((dt) => cam.update(dt), 3);
    const drifted = cam.pos;
    expect(drifted).toBeGreaterThan(2.3); // forward = later in the chain, moving up the screen
    cam.nudge(0.4);
    run((dt) => cam.update(dt), 2);
    expect(cam.drifting).toBe(false);
    expect(Number.isInteger(cam.pos)).toBe(true); // snapped to a slot
    const stopped = cam.pos;
    run((dt) => cam.update(dt), 2);
    expect(cam.pos).toBe(stopped);
    cam.setDrift(true);
    run((dt) => cam.update(dt), 1);
    expect(cam.pos).toBeGreaterThan(stopped);
  });

  it('flings to a slot past the release point', () => {
    const cam = new ReelCamera(20);
    cam.dive(0, false);
    run((dt) => cam.update(dt), 3);
    cam.grab();
    cam.drag(0.3);
    cam.release(7);
    run((dt) => cam.update(dt), 3);
    expect(cam.pos).toBe(2);
  });

  it('keeps the focused team in focus when the slots change', () => {
    const before = buildRingModel(
      snap(
        3,
        [
          [0, 1],
          [1, 2],
        ],
        [0, 1, 2],
        'chain',
      ),
    );
    const after = buildRingModel(
      snap(
        3,
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
        [0, 1, 2],
        'circle',
      ),
    );
    const cam = new ReelCamera(before.slots.length);
    cam.dive(before.slotOfTeam[1]!, false);
    run((dt) => cam.update(dt), 3);
    cam.remap(before, after);
    expect(visible(cam, after.slotOfTeam[1]!)).toBeCloseTo(0, 6);
  });

  it('zooms back out the short way', () => {
    const cam = new ReelCamera(10);
    cam.dive(0, true);
    run((dt) => cam.update(dt), 30); // drifts several turns
    cam.exit();
    expect(Math.abs(cam.rotation())).toBeLessThanOrEqual(Math.PI + 1e-9);
    run((dt) => cam.update(dt), 3);
    expect(cam.z).toBe(0);
  });
});
