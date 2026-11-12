/**
 * The closing moment's timeline (round 9): teams settle, the view pushes in on the game that
 * closed the circle while that link draws in, a pulse runs one lap round the ring, and the ring
 * blooms under a headline. Pure and stepped by `update(dt)` like the rest of the scene, so the
 * same frames can drive the screen or a video export.
 */

/** Levels of each effect at one instant, all 0..1. `lap` is -1 when the pulse isn't running. */
export interface MomentFrame {
  active: boolean;
  /** Push-in toward the closing link. */
  push: number;
  /** How much of the closing link is drawn. */
  draw: number;
  caption: number;
  lap: number;
  bloom: number;
  headline: number;
}

/** Seconds after the teams settle. The whole run is about six seconds. */
const T = {
  pushIn: [0, 0.8],
  draw: [0.4, 1.1],
  captionIn: [0.9, 1.2],
  captionOut: [2.2, 2.5],
  pushOut: [2.2, 2.9],
  lap: [2.6, 4.4],
  bloomUp: [4.2, 4.6],
  bloomDown: [4.6, 5.6],
  headlineIn: [4.3, 4.7],
  headlineOut: [5.6, 6.0],
  end: 6.0,
} as const;

/** Longest wait for teams to settle before the run starts anyway. */
export const SETTLE_TIMEOUT = 2.5;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const ramp = ([a, b]: readonly [number, number], t: number) => ease((t - a) / (b - a));

const IDLE: MomentFrame = {
  active: false,
  push: 0,
  draw: 1,
  caption: 0,
  lap: -1,
  bloom: 0,
  headline: 0,
};

export class ClosingMoment {
  private phase: 'idle' | 'settle' | 'run' = 'idle';
  private t = 0;
  private waited = 0;

  constructor(private readonly reducedMotion = false) {}

  get active(): boolean {
    return this.phase !== 'idle';
  }

  start(): void {
    this.phase = 'settle';
    this.t = 0;
    this.waited = 0;
  }

  /** Jump to the end state. */
  skip(): void {
    this.phase = 'idle';
  }

  /** Advance by dt seconds. `settled`: every team has reached its slot. */
  update(dt: number, settled: boolean): MomentFrame {
    if (this.phase === 'settle') {
      this.waited += dt;
      if (settled || this.waited >= SETTLE_TIMEOUT) this.phase = 'run';
      else return { ...IDLE, active: true, draw: 0 };
    }
    if (this.phase !== 'run') return IDLE;
    this.t += dt;
    const t = this.t;
    if (t >= T.end) {
      this.phase = 'idle';
      return IDLE;
    }
    const caption = ramp(T.captionIn, t) * (1 - ramp(T.captionOut, t));
    const headline = ramp(T.headlineIn, t) * (1 - ramp(T.headlineOut, t));
    if (this.reducedMotion) {
      // No push-in, lap or bloom: the link appears and the words fade in and out.
      return { active: true, push: 0, draw: 1, caption, lap: -1, bloom: 0, headline };
    }
    const [l0, l1] = T.lap;
    return {
      active: true,
      push: ramp(T.pushIn, t) * (1 - ramp(T.pushOut, t)),
      draw: ramp(T.draw, t),
      caption,
      // One lap, easing in and out.
      lap: t < l0 || t > l1 ? -1 : ease((t - l0) / (l1 - l0)),
      bloom: ramp(T.bloomUp, t) * (1 - ramp(T.bloomDown, t)),
      headline,
    };
  }
}
