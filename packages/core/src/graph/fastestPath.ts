import { bit, bits, fullMask, popcount } from './bitset';

/**
 * "What would close the circle soonest?" (round 4 #3-4, round 11). Played wins are free;
 * each result that still has to go a certain way costs 1. The answer is the earliest period by
 * which some circle can exist, then the fewest results needed by then.
 *
 * The engine is a min-cost Hamiltonian cycle search: depth-first with iterative deepening on
 * cost, a matching lower bound (teams left minus the most of them that played wins alone could
 * link), a feasibility check on all usable links, and memoized failures. Costs are 0 or 1 per
 * link today; a per-link cost (say -log p for "most likely") slots in at `optional`.
 */

/** A game not yet final: either team may still win it. Team references are node indices. */
export interface PendingGame {
  gameId: string;
  home: number;
  away: number;
  periodIndex: number;
}

/** One result the path needs: `winner` must beat `loser` in `gameId`. */
export interface NeededResult {
  gameId: string;
  winner: number;
  loser: number;
  periodIndex: number;
}

export interface FastestPath {
  /** The earliest period by whose end the circle can exist. */
  periodIndex: number;
  /** The fewest results needed, earliest game first. */
  needed: NeededResult[];
  /** The circle that would form: order[i] beats order[i + 1], and the last beats the first. */
  order: number[];
}

export interface PathSearchOptions {
  /** Search nodes allowed per cycle search before giving up (default 2 million). */
  nodeBudget?: number;
}

const DEFAULT_BUDGET = 2_000_000;

type CycleResult = { kind: 'found'; order: number[] } | { kind: 'none' } | { kind: 'budget' };

/** Most teams in `left` that can each take a distinct partner in `right` along `adj`. */
function matchingSize(left: number[], right: number, adj: Uint32Array): number {
  const owner = new Int8Array(32).fill(-1);
  const augment = (u: number, seen: { m: number }): boolean => {
    for (const v of bits((adj[u]! & right) >>> 0)) {
      if (seen.m & bit(v)) continue;
      seen.m = (seen.m | bit(v)) >>> 0;
      const o = owner[v]!;
      if (o < 0 || augment(o, seen)) {
        owner[v] = u;
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (const u of left) if (augment(u, { m: 0 })) size++;
  return size;
}

/**
 * A circle through all `n` teams using at most `maxCost` optional links (and any number of
 * fixed ones), or the cheapest such circle when `maxCost` is omitted.
 */
export function minCostCycle(
  n: number,
  fixed: Uint32Array,
  optional: Uint32Array,
  maxCost?: number,
  opts: PathSearchOptions = {},
): CycleResult & { cost?: number } {
  const full = fullMask(n);
  const all = new Uint32Array(n);
  const inAll = new Uint32Array(n);
  for (let u = 0; u < n; u++) {
    all[u] = (fixed[u]! | optional[u]!) >>> 0;
    for (const v of bits(all[u]!)) inAll[v] = (inAll[v]! | bit(u)) >>> 0;
  }
  for (let v = 0; v < n; v++) if (!all[v] || !inAll[v]) return { kind: 'none' };
  // Start from the team with the fewest ways in: its predecessor is the tightest choice.
  let start = 0;
  for (let v = 1; v < n; v++) if (popcount(inAll[v]!) < popcount(inAll[start]!)) start = v;

  const budget = opts.nodeBudget ?? DEFAULT_BUDGET;
  let nodes = 0;
  const path = [start];
  const failed = new Map<number, number>(); // (cur, visited) -> largest cost allowance that failed

  const lowerBound = (cur: number, unvisited: number): number | null => {
    const left = bits((unvisited | bit(cur)) >>> 0);
    const right = (unvisited | bit(start)) >>> 0;
    if (matchingSize(left, right, all) < left.length) return null;
    return left.length - matchingSize(left, right, fixed);
  };

  const dfs = (cur: number, visited: number, remaining: number): boolean => {
    if (++nodes > budget) throw BUDGET;
    if (visited === full) {
      if (fixed[cur]! & bit(start)) return true;
      return remaining >= 1 && (optional[cur]! & bit(start)) !== 0;
    }
    const unvisited = (full & ~visited) >>> 0;
    const key = cur * 0x100000000 + visited;
    const prior = failed.get(key);
    if (prior !== undefined && remaining <= prior) return false;
    const lb = lowerBound(cur, unvisited);
    if (lb === null || lb > remaining) {
      failed.set(key, Math.max(prior ?? -1, remaining));
      return false;
    }
    const onward = (v: number) => popcount((all[v]! & unvisited) >>> 0);
    const byOnward = (a: number, b: number) => onward(a) - onward(b);
    for (const v of bits((fixed[cur]! & unvisited) >>> 0).sort(byOnward)) {
      path.push(v);
      if (dfs(v, (visited | bit(v)) >>> 0, remaining)) return true;
      path.pop();
    }
    if (remaining > 0) {
      for (const v of bits((optional[cur]! & ~fixed[cur]! & unvisited) >>> 0).sort(byOnward)) {
        path.push(v);
        if (dfs(v, (visited | bit(v)) >>> 0, remaining - 1)) return true;
        path.pop();
      }
    }
    failed.set(key, Math.max(prior ?? -1, remaining));
    return false;
  };

  try {
    const root = lowerBound(start, (full & ~bit(start)) >>> 0);
    if (root === null) return { kind: 'none' };
    const ceiling = maxCost ?? n;
    for (let cost = root; cost <= ceiling; cost++) {
      failed.clear();
      path.length = 1;
      if (dfs(start, bit(start), cost)) return { kind: 'found', order: [...path], cost };
    }
    return { kind: 'none' };
  } catch (e) {
    if (e === BUDGET) return { kind: 'budget' };
    throw e;
  }
}

const BUDGET = Symbol('budget');

/** Played wins as adjacency masks: fixed[u] holds the teams u beat. */
export type FixedWins = Uint32Array;

/** Links that pending games through `periodIndex` could still create, both ways. */
function optionalThrough(n: number, pending: readonly PendingGame[], periodIndex: number) {
  const optional = new Uint32Array(n);
  for (const g of pending) {
    if (g.periodIndex > periodIndex) continue;
    optional[g.home] = (optional[g.home]! | bit(g.away)) >>> 0;
    optional[g.away] = (optional[g.away]! | bit(g.home)) >>> 0;
  }
  return optional;
}

/** The results a circle needs: its links that played wins don't already supply. */
function neededFor(
  order: readonly number[],
  fixed: FixedWins,
  pending: readonly PendingGame[],
  periodIndex: number,
): NeededResult[] {
  const needed: NeededResult[] = [];
  for (let i = 0; i < order.length; i++) {
    const winner = order[i]!;
    const loser = order[(i + 1) % order.length]!;
    if (fixed[winner]! & bit(loser)) continue;
    // The earliest game between the two that's in range supplies the result.
    let game: PendingGame | undefined;
    for (const g of pending) {
      const pair =
        (g.home === winner && g.away === loser) || (g.home === loser && g.away === winner);
      if (pair && g.periodIndex <= periodIndex && (!game || g.periodIndex < game.periodIndex))
        game = g;
    }
    if (game) needed.push({ gameId: game.gameId, winner, loser, periodIndex: game.periodIndex });
  }
  return needed.sort((a, b) => a.periodIndex - b.periodIndex);
}

/**
 * The earliest period a circle can close by, and the fewest results needed. Null if no circle
 * is possible this season, or if a search ran out of budget (never seen on NFL data).
 */
export function fastestPath(
  n: number,
  fixed: FixedWins,
  pending: readonly PendingGame[],
  opts: PathSearchOptions = {},
): FastestPath | null {
  const periods = [...new Set(pending.map((g) => g.periodIndex))].sort((a, b) => a - b);
  for (const periodIndex of periods) {
    const r = minCostCycle(n, fixed, optionalThrough(n, pending, periodIndex), undefined, opts);
    if (r.kind === 'budget') return null;
    if (r.kind === 'found') {
      return {
        periodIndex,
        needed: neededFor(r.order, fixed, pending, periodIndex),
        order: r.order,
      };
    }
  }
  return null;
}

export interface Ways {
  /** Every distinct set of results that closes the circle as fast (up to the cap), best first. */
  ways: NeededResult[][];
  /** False if the cap or a search budget cut the list short. */
  complete: boolean;
}

/**
 * All the equally fast ways: distinct sets of `cost` results that each close a circle by
 * `periodIndex`. Lawler's partition: after finding a set {s1..sm}, the rest of the space splits
 * into "forbid s1", "require s1, forbid s2", and so on, so no set is found twice.
 */
export function equallyFastWays(
  n: number,
  fixed: FixedWins,
  pending: readonly PendingGame[],
  best: FastestPath,
  cap = 20,
  opts: PathSearchOptions = {},
): Ways {
  const cost = best.needed.length;
  const optional = optionalThrough(n, pending, best.periodIndex);
  const key = (r: { winner: number; loser: number }) => r.winner * 32 + r.loser;
  type Sub = { forced: number[]; forbidden: number[] };
  const queue: Sub[] = [{ forced: [], forbidden: [] }];
  const ways: NeededResult[][] = [];
  let complete = true;

  while (queue.length > 0) {
    if (ways.length > cap) {
      complete = false;
      break;
    }
    const { forced, forbidden } = queue.shift()!;
    const f = Uint32Array.from(fixed);
    const o = Uint32Array.from(optional);
    for (const k of forced) f[k >> 5] = (f[k >> 5]! | bit(k & 31)) >>> 0;
    for (const k of forbidden) o[k >> 5] = (o[k >> 5]! & ~bit(k & 31)) >>> 0;
    const r = minCostCycle(n, f, o, cost - forced.length, opts);
    if (r.kind === 'budget') {
      complete = false;
      continue;
    }
    if (r.kind === 'none') continue;
    // Needed results against the real played wins, so forced results are listed too.
    const set = neededFor(r.order, fixed, pending, best.periodIndex);
    ways.push(set);
    const free = set.map(key).filter((k) => !forced.includes(k));
    free.forEach((k, i) => {
      queue.push({ forced: [...forced, ...free.slice(0, i)], forbidden: [...forbidden, k] });
    });
  }
  // Best first: the caller's path leads, the rest by earliest needed game.
  const bestKey = best.needed.map(key).sort().join();
  ways.sort((a, b) => {
    const ka = a.map(key).sort().join();
    const kb = b.map(key).sort().join();
    if (ka === bestKey) return -1;
    if (kb === bestKey) return 1;
    return (a[0]?.periodIndex ?? 0) - (b[0]?.periodIndex ?? 0);
  });
  return { ways: ways.slice(0, cap), complete };
}
