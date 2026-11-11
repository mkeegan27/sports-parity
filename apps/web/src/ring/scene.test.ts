import { describe, expect, it } from 'vitest';
import { AngleSprings, primaryEdges, ringLayout, slotAngles } from './scene';

describe('ring scene model', () => {
  it('fits the ring inside the viewport with a minimum node size', () => {
    const phone = ringLayout(375, 500, 32);
    expect(phone.radius + phone.nodeRadius).toBeLessThanOrEqual(375 / 2);
    expect(phone.nodeRadius).toBeGreaterThanOrEqual(9);
    const tiny = ringLayout(120, 120, 32);
    expect(tiny.nodeRadius).toBe(9);
  });

  it('leaves a gap at the top until the circle closes', () => {
    const open = slotAngles({ order: [2, 0, 1], status: 'chain' }, 3);
    const step = (2 * Math.PI) / 4;
    expect(open[2]).toBeCloseTo(-Math.PI / 2 + step);
    expect(open[1]).toBeCloseTo(-Math.PI / 2 + 3 * step);
    const closed = slotAngles({ order: [2, 0, 1], status: 'circle' }, 3);
    expect(closed[2]).toBeCloseTo(-Math.PI / 2);
  });

  it('places teams outside a partial chain after it', () => {
    const angles = slotAngles({ order: [1, 0], status: 'partial' }, 4);
    expect(angles[2]! < angles[3]!).toBe(true);
    expect(angles[0]! < angles[2]!).toBe(true);
  });

  it('springs settle on targets the short way round, independent of frame size', () => {
    const run = (dt: number) => {
      const s = new AngleSprings(1);
      s.setTargets(Float64Array.of(3), true);
      s.setTargets(Float64Array.of(3 + 2 * Math.PI - 0.5)); // nearest copy is 2.5
      let t = 0;
      while (t < 3) {
        s.step(dt);
        t += dt;
      }
      return s.angle[0]!;
    };
    expect(run(1 / 60)).toBeCloseTo(2.5, 3);
    expect(run(1 / 60)).toBeCloseTo(run(1 / 30), 6);
  });

  it('adds the closing edge only for a circle', () => {
    expect(primaryEdges({ order: [0, 1, 2], status: 'chain' })).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(primaryEdges({ order: [0, 1, 2], status: 'circle' })).toHaveLength(3);
  });
});
