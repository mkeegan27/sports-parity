import { describe, expect, it } from 'vitest';
import { ClosingMoment, SETTLE_TIMEOUT, type MomentFrame } from './moment';

/** Run a moment at 60fps, recording every frame. */
function play(moment: ClosingMoment, seconds: number, settled: () => boolean = () => true) {
  const frames: MomentFrame[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) frames.push(moment.update(1 / 60, settled()));
  return frames;
}

describe('closing moment', () => {
  it('runs push-in, link, lap, bloom and headline in order, in about six seconds', () => {
    const m = new ClosingMoment();
    m.start();
    const frames = play(m, 8);
    const firstOver = (pick: (f: MomentFrame) => number, level = 0.5) =>
      frames.findIndex((f) => pick(f) > level) / 60;
    const push = firstOver((f) => f.push);
    const draw = firstOver((f) => f.draw);
    const lap = firstOver((f) => f.lap, 0);
    const bloom = firstOver((f) => f.bloom);
    const headline = firstOver((f) => f.headline);
    expect(push).toBeLessThan(draw);
    expect(draw).toBeLessThan(lap);
    expect(lap).toBeLessThan(bloom);
    expect(bloom).toBeLessThanOrEqual(headline);
    const end = frames.findIndex((f) => !f.active) / 60;
    expect(end).toBeGreaterThan(5.5);
    expect(end).toBeLessThan(6.5);
    // The pulse leaves from the closing link as the view pulls back, and the whole circle is in
    // view before it is a fifth of the way round.
    const lapFrames = frames.filter((f) => f.lap >= 0);
    expect(lapFrames[0]!.push).toBeGreaterThan(0);
    expect(Math.max(...lapFrames.filter((f) => f.lap > 0.2).map((f) => f.push))).toBeLessThan(0.01);
    expect(lapFrames.at(-1)!.lap).toBeGreaterThan(0.99);
  });

  it('waits for the teams to settle, but not forever', () => {
    const m = new ClosingMoment();
    m.start();
    const waiting = play(m, 1, () => false);
    expect(waiting.every((f) => f.active && f.push === 0 && f.draw === 0)).toBe(true);
    const later = play(m, SETTLE_TIMEOUT, () => false);
    expect(later.some((f) => f.push > 0)).toBe(true);
  });

  it('can be skipped straight to the end state', () => {
    const m = new ClosingMoment();
    m.start();
    play(m, 1);
    m.skip();
    expect(m.update(1 / 60, true)).toMatchObject({ active: false, draw: 1, push: 0, lap: -1 });
  });

  it('only fades words in and out under reduced motion', () => {
    const m = new ClosingMoment(true);
    m.start();
    const frames = play(m, 7);
    expect(frames.every((f) => f.push === 0 && f.lap === -1 && f.bloom === 0)).toBe(true);
    expect(frames.some((f) => f.headline > 0.9)).toBe(true);
    expect(frames.every((f) => f.draw === 1 || !f.active || f.draw === 0)).toBe(true);
  });
});
