import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bit } from './bitset';
import { equallyFastWays, fastestPath, minCostCycle, type PendingGame } from './fastestPath';

/** Every circle through 0..n-1 that starts at 0. */
function* circles(n: number): Generator<number[]> {
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const permute = function* (a: number[], k: number): Generator<number[]> {
    if (k === a.length) yield [0, ...a];
    for (let i = k; i < a.length; i++) {
      [a[k], a[i]] = [a[i]!, a[k]!];
      yield* permute(a, k + 1);
      [a[k], a[i]] = [a[i]!, a[k]!];
    }
  };
  yield* permute(rest, 0);
}

/** Brute force: earliest period, fewest results, and every distinct set of needed links. */
function brute(n: number, fixed: Uint32Array, pending: PendingGame[]) {
  const periods = [...new Set(pending.map((g) => g.periodIndex))].sort((a, b) => a - b);
  for (const p of periods) {
    const can = (u: number, v: number) =>
      pending.some(
        (g) =>
          g.periodIndex <= p && ((g.home === u && g.away === v) || (g.home === v && g.away === u)),
      );
    let best = Infinity;
    const sets = new Map<number, Set<string>>();
    for (const c of circles(n)) {
      let cost = 0;
      const need: string[] = [];
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const u = c[i]!;
        const v = c[(i + 1) % n]!;
        if (fixed[u]! & bit(v)) continue;
        if (!can(u, v)) ok = false;
        else {
          cost++;
          need.push(`${u}>${v}`);
        }
      }
      if (!ok) continue;
      best = Math.min(best, cost);
      const s = sets.get(cost) ?? new Set<string>();
      s.add(need.sort().join());
      sets.set(cost, s);
    }
    if (best < Infinity) return { periodIndex: p, cost: best, ways: sets.get(best)! };
  }
  return null;
}

const league = fc.integer({ min: 3, max: 6 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    played: fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1)), { maxLength: n * 2 }),
    games: fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1), fc.integer({ min: 1, max: 3 })), {
      maxLength: n * 3,
    }),
  }),
);

function setup({
  n,
  played,
  games,
}: {
  n: number;
  played: [number, number][];
  games: [number, number, number][];
}) {
  const fixed = new Uint32Array(n);
  for (const [w, l] of played) if (w !== l) fixed[w] = (fixed[w]! | bit(l)) >>> 0;
  const pending: PendingGame[] = games
    .filter(([h, a]) => h !== a)
    .map(([home, away, periodIndex], i) => ({ gameId: `g${i}`, home, away, periodIndex }));
  return { fixed, pending };
}

describe('fastestPath', () => {
  it('matches brute force on small leagues: earliest period, then fewest results', () => {
    fc.assert(
      fc.property(league, (l) => {
        const { fixed, pending } = setup(l);
        const want = brute(l.n, fixed, pending);
        const got = fastestPath(l.n, fixed, pending);
        if (!want) return got === null;
        expect(got).not.toBeNull();
        expect(got!.periodIndex).toBe(want.periodIndex);
        expect(got!.needed).toHaveLength(want.cost);
        // The circle is real once the needed results are added, and uses games in range.
        const all = Uint32Array.from(fixed);
        for (const r of got!.needed) {
          all[r.winner] = (all[r.winner]! | bit(r.loser)) >>> 0;
          expect(r.periodIndex).toBeLessThanOrEqual(got!.periodIndex);
        }
        got!.order.forEach((u, i) =>
          expect(all[u]! & bit(got!.order[(i + 1) % l.n]!)).toBeTruthy(),
        );
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('lists every equally fast way exactly once', () => {
    fc.assert(
      fc.property(league, (l) => {
        const { fixed, pending } = setup(l);
        const want = brute(l.n, fixed, pending);
        const best = fastestPath(l.n, fixed, pending);
        if (!want || !best) return true;
        const { ways, complete } = equallyFastWays(l.n, fixed, pending, best, 1000);
        expect(complete).toBe(true);
        const keys = ways.map((w) =>
          w
            .map((r) => `${r.winner}>${r.loser}`)
            .sort()
            .join(),
        );
        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(keys)).toEqual(want.ways);
        expect(keys[0]).toBe(
          best.needed
            .map((r) => `${r.winner}>${r.loser}`)
            .sort()
            .join(),
        );
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('caps the list and says so', () => {
    // Four teams, nothing played, every pair meets in period 1: many equally fast ways.
    const n = 4;
    const pending: PendingGame[] = [];
    for (let u = 0; u < n; u++)
      for (let v = u + 1; v < n; v++)
        pending.push({ gameId: `${u}-${v}`, home: u, away: v, periodIndex: 1 });
    const fixed = new Uint32Array(n);
    const best = fastestPath(n, fixed, pending)!;
    expect(best.needed).toHaveLength(4);
    const all = equallyFastWays(n, fixed, pending, best, 100);
    expect(all.ways).toHaveLength(6); // 3! circles through 0, each a different set of results
    expect(all.complete).toBe(true);
    const capped = equallyFastWays(n, fixed, pending, best, 2);
    expect(capped.ways).toHaveLength(2);
    expect(capped.complete).toBe(false);
  });

  it('reports a spent budget instead of a wrong answer', () => {
    const n = 8;
    const optional = new Uint32Array(n).fill(0xff);
    expect(minCostCycle(n, new Uint32Array(n), optional, undefined, { nodeBudget: 3 }).kind).toBe(
      'budget',
    );
  });
});
