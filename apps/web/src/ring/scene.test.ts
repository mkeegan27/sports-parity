import { describe, expect, it } from 'vitest';
import {
  AngleSprings,
  blendLayout,
  buildRingModel,
  ReelCamera,
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

describe('springs', () => {
  it('settle on targets the short way round, independent of frame size', () => {
    const settle = (dt: number) => {
      const s = new AngleSprings(1);
      s.setTargets(Float64Array.of(3), true);
      s.setTargets(Float64Array.of(3 + 2 * Math.PI - 0.5)); // nearest copy is 2.5
      run((h) => s.step(h), 3, dt);
      return s.angle[0]!;
    };
    expect(settle(1 / 60)).toBeCloseTo(2.5, 3);
    expect(settle(1 / 60)).toBeCloseTo(settle(1 / 30), 6);
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
