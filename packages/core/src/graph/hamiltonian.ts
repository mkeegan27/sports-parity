import { bit, bits, fullMask, has, popcount } from './bitset';

/**
 * Exact Hamiltonian cycle / path search over bitset adjacency (n <= 32).
 *
 * Finding a Hamiltonian cycle is NP-complete in general. It is tractable here because n is
 * small and the pruning is strong:
 *  - degree checks: every remaining team still needs a usable predecessor and successor;
 *  - reachability: every remaining team must be reachable from the path's current end;
 *  - matching relaxation: the remaining teams must admit a perfect predecessor matching
 *    (a cycle/path cover), checked with Kuhn's augmenting paths;
 *  - memoized dead ends keyed by (current end, visited set).
 * On every NFL week from 1999 to 2026 the slowest cycle search took a few milliseconds.
 */

export type SearchResult =
  | { kind: 'found'; order: number[] }
  | { kind: 'none' }
  /** The node budget ran out before the search finished. */
  | { kind: 'unknown' };

export interface SearchOptions {
  /** Max DFS nodes before giving up with `unknown`. */
  budget?: number;
  /**
   * A preferred ring order (for example last week's, or the season's eventual circle). The
   * search tries each team's successor in this order first, so when several answers exist the
   * one found resembles the hint. It never changes what is found or proven, only which valid
   * answer comes first. If the hinted search runs out of budget, the plain search runs instead.
   */
  hint?: readonly number[] | undefined;
}

const DEFAULT_BUDGET = 2_000_000;
/** Budget for a hinted attempt before falling back to the plain (usually faster) ordering. */
const HINTED_BUDGET = 200_000;

/** How a hint ranks successors: steps forward from one team to another along the hint. */
interface HintRank {
  rank: Int32Array;
  length: number;
}

function hintRank(n: number, hint: readonly number[] | undefined): HintRank | null {
  if (!hint || hint.length === 0) return null;
  const rank = new Int32Array(Math.max(n, 32)).fill(-1);
  hint.forEach((v, i) => {
    if (v >= 0 && v < n && rank[v] === -1) rank[v] = i;
  });
  return { rank, length: hint.length };
}

/** 1 if `to` directly follows `from` in the hint, 2 if one team later, and so on. */
function hintSteps(h: HintRank, from: number, to: number): number {
  const a = h.rank[from]!;
  const b = h.rank[to]!;
  if (a < 0 || b < 0) return h.length + 1;
  return (b - a + h.length) % h.length || h.length;
}

/** Order candidate successors: along the hint first (if any), then fewest onward options. */
function orderCandidates(
  candidates: number[],
  cur: number,
  onward: (v: number) => number,
  hint: HintRank | null,
): number[] {
  return candidates.sort(
    (a, b) =>
      (hint ? hintSteps(hint, cur, a) - hintSteps(hint, cur, b) : 0) ||
      onward(a) - onward(b) ||
      a - b,
  );
}

/** Restrict a hint to the teams in `keep`, renumbered to their positions in `keep`. */
export function localHint(
  hint: readonly number[] | undefined,
  keep: readonly number[],
): number[] | undefined {
  if (!hint) return undefined;
  const pos = new Map(keep.map((v, i) => [v, i]));
  const local: number[] = [];
  for (const v of hint) {
    const i = pos.get(v);
    if (i !== undefined) local.push(i);
  }
  return local;
}

/** Run a search with the hint first; if that runs out of budget, run it plain. */
function withHintFallback(
  opts: SearchOptions,
  run: (opts: SearchOptions) => SearchResult,
): SearchResult {
  if (!opts.hint || opts.hint.length === 0) return run(opts);
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const hinted = run({ ...opts, budget: Math.min(budget, HINTED_BUDGET) });
  return hinted.kind === 'unknown' ? run({ ...opts, hint: undefined }) : hinted;
}

class BudgetExceeded extends Error {}

/**
 * Size of a maximum matching that gives each node in `targets` a distinct predecessor drawn
 * from `sources`, along edges in `out`.
 */
export function predecessorMatchingSize(
  out: ArrayLike<number>,
  sources: number,
  targets: number,
): number {
  const srcList = bits(sources);
  let size = 0;
  const preds = new Uint32Array(32);
  for (const v of bits(targets)) {
    let m = 0;
    for (const u of srcList) if (has(out[u]!, v)) m |= 1 << u;
    preds[v] = m >>> 0;
  }
  const usedBy = new Int8Array(32).fill(-1); // source -> the target it is matched to
  // Kuhn's algorithm: augment from each target, looking for a free (or freeable) predecessor.
  const tryAugment = (v: number, seen: { m: number }): boolean => {
    for (const u of bits(preds[v]!)) {
      if (has(seen.m, u)) continue;
      seen.m = (seen.m | bit(u)) >>> 0;
      const owner = usedBy[u]!;
      if (owner === -1 || tryAugment(owner, seen)) {
        usedBy[u] = v;
        return true;
      }
    }
    return false;
  };
  for (const v of bits(targets)) if (tryAugment(v, { m: 0 })) size++;
  return size;
}

/** Can every node in `targets` be reached from `from` using only nodes in `targets`? */
function reachesAll(out: ArrayLike<number>, from: number, targets: number): boolean {
  let seen = 0;
  let frontier = (out[from]! & targets) >>> 0;
  while (frontier !== 0) {
    seen = (seen | frontier) >>> 0;
    let next = 0;
    for (const v of bits(frontier)) next |= out[v]!;
    frontier = (next & targets & ~seen) >>> 0;
  }
  return (seen & targets) >>> 0 === targets;
}

interface DfsSpec {
  n: number;
  out: ArrayLike<number>;
  inn: ArrayLike<number>;
  start: number;
  /** Cycle: the last node must link back to `start`. Path: it may end anywhere. */
  closeCycle: boolean;
  budget: { left: number };
  hint: HintRank | null;
}

function dfsSearch(spec: DfsSpec): number[] | null {
  const { n, out, inn, start, closeCycle, budget, hint } = spec;
  const full = fullMask(n);
  const path = [start];
  const deadEnds = new Set<number>();

  const step = (cur: number, visited: number): boolean => {
    if (--budget.left < 0) throw new BudgetExceeded();
    if (visited === full) return !closeCycle || has(out[cur]!, start);
    const remaining = (full & ~visited) >>> 0;

    // Degree checks: each remaining node needs a predecessor among remaining∪{cur}
    // and (for cycles, or for all but one node on a path) a successor among remaining∪{start}.
    const predPool = (remaining | bit(cur)) >>> 0;
    const succPool = closeCycle ? (remaining | bit(start)) >>> 0 : remaining;
    let deadSuccessors = 0;
    for (const v of bits(remaining)) {
      if ((inn[v]! & predPool) === 0) return false;
      if ((out[v]! & succPool) === 0 && ++deadSuccessors > (closeCycle ? 0 : 1)) return false;
    }
    if (!reachesAll(out, cur, remaining)) return false;

    const key = visited * 32 + cur;
    if (deadEnds.has(key)) return false;
    // Cycle cover / path cover relaxation. For a cycle, `start` also needs a predecessor.
    const needPred = closeCycle ? (remaining | bit(start)) >>> 0 : remaining;
    if (predecessorMatchingSize(out, predPool, needPred) < popcount(needPred)) {
      deadEnds.add(key);
      return false;
    }

    const onward = (v: number) => popcount(out[v]! & remaining);
    const candidates = orderCandidates(bits(out[cur]! & remaining), cur, onward, hint);
    for (const v of candidates) {
      path.push(v);
      if (step(v, (visited | bit(v)) >>> 0)) return true;
      path.pop();
    }
    deadEnds.add(key);
    return false;
  };

  return step(start, bit(start)) ? path : null;
}

/** Find a cycle through every node, or prove none exists. */
export function findHamiltonianCycle(
  out: ArrayLike<number>,
  inn: ArrayLike<number>,
  opts: SearchOptions = {},
): SearchResult {
  return withHintFallback(opts, (o) => cycleSearch(out, inn, o));
}

function cycleSearch(
  out: ArrayLike<number>,
  inn: ArrayLike<number>,
  opts: SearchOptions,
): SearchResult {
  const n = out.length;
  if (n < 2) return { kind: 'none' };
  for (let v = 0; v < n; v++) if (out[v] === 0 || inn[v] === 0) return { kind: 'none' };
  // Start at the most constrained node: fewest teams that beat it.
  let start = 0;
  for (let v = 1; v < n; v++) if (popcount(inn[v]!) < popcount(inn[start]!)) start = v;
  try {
    const order = dfsSearch({
      n,
      out,
      inn,
      start,
      closeCycle: true,
      budget: { left: opts.budget ?? DEFAULT_BUDGET },
      hint: hintRank(n, opts.hint),
    });
    return order ? { kind: 'found', order } : { kind: 'none' };
  } catch (e) {
    if (e instanceof BudgetExceeded) return { kind: 'unknown' };
    throw e;
  }
}

/** Find a path through every node (a "chain"), or prove none exists. */
export function findHamiltonianPath(
  out: ArrayLike<number>,
  inn: ArrayLike<number>,
  opts: SearchOptions = {},
): SearchResult {
  return withHintFallback(opts, (o) => pathSearch(out, inn, o));
}

function pathSearch(
  out: ArrayLike<number>,
  inn: ArrayLike<number>,
  opts: SearchOptions,
): SearchResult {
  const n = out.length;
  if (n === 0) return { kind: 'none' };
  if (n === 1) return { kind: 'found', order: [0] };
  const sources: number[] = [];
  let sinks = 0;
  for (let v = 0; v < n; v++) {
    if (inn[v] === 0) sources.push(v);
    if (out[v] === 0) sinks++;
    if (inn[v] === 0 && out[v] === 0) return { kind: 'none' };
  }
  if (sources.length > 1 || sinks > 1) return { kind: 'none' };
  const starts =
    sources.length === 1
      ? sources
      : Array.from({ length: n }, (_, i) => i).sort(
          (a, b) => popcount(inn[a]!) - popcount(inn[b]!) || a - b,
        );
  const budget = { left: opts.budget ?? DEFAULT_BUDGET };
  const hint = hintRank(n, opts.hint);
  try {
    for (const start of starts) {
      const order = dfsSearch({ n, out, inn, start, closeCycle: false, budget, hint });
      if (order) return { kind: 'found', order };
    }
    return { kind: 'none' };
  } catch (e) {
    if (e instanceof BudgetExceeded) return { kind: 'unknown' };
    throw e;
  }
}

/** Induced subgraph on `keep`, compacted to indices 0..k-1, plus the map back to originals. */
function inducedSubgraph(out: ArrayLike<number>, keep: number[]) {
  const pos = new Map(keep.map((v, i) => [v, i]));
  const subOut = new Uint32Array(keep.length);
  const subIn = new Uint32Array(keep.length);
  keep.forEach((u, i) => {
    for (const v of bits(out[u]!)) {
      const j = pos.get(v);
      if (j === undefined) continue;
      subOut[i] = (subOut[i]! | bit(j)) >>> 0;
      subIn[j] = (subIn[j]! | bit(i)) >>> 0;
    }
  });
  return { subOut, subIn };
}

/**
 * Longest simple path, for weeks where no chain covers every team.
 *
 * Key bound: a path can contain at most one team nobody has beaten (only as its first team)
 * and at most one team that hasn't beaten anyone (only as its last). So with s such sources
 * and t such sinks, the longest path has at most n - (s - 1) - (t - 1) teams. We try each
 * choice of kept source/sink with the exact Hamiltonian path search; hitting the bound proves
 * optimality. Otherwise a bounded DFS runs, exact only if it finishes within budget.
 */
export function findLongestPath(
  out: ArrayLike<number>,
  opts: SearchOptions = {},
): { order: number[]; exact: boolean } {
  const n = out.length;
  if (n === 0) return { order: [], exact: true };
  const inn = new Uint32Array(n);
  for (let u = 0; u < n; u++) for (const v of bits(out[u]!)) inn[v] = (inn[v]! | bit(u)) >>> 0;
  const isolated = Array.from({ length: n }, (_, v) => v).filter(
    (v) => out[v] === 0 && inn[v] === 0,
  );
  const sources = Array.from({ length: n }, (_, v) => v).filter(
    (v) => inn[v] === 0 && out[v] !== 0,
  );
  const sinks = Array.from({ length: n }, (_, v) => v).filter((v) => out[v] === 0 && inn[v] !== 0);
  const connected = n - isolated.length;
  if (connected === 0) return { order: [0], exact: true };
  const bound = connected - Math.max(0, sources.length - 1) - Math.max(0, sinks.length - 1);

  // Every simple path lies inside one of these "base" sets (one kept source, one kept sink).
  const baseSets: number[][] = [];
  for (const s of sources.length > 0 ? sources : [-1]) {
    for (const t of sinks.length > 0 ? sinks : [-1]) {
      const dropped = new Set([
        ...isolated,
        ...sources.filter((x) => x !== s),
        ...sinks.filter((x) => x !== t),
      ]);
      baseSets.push(Array.from({ length: n }, (_, v) => v).filter((v) => !dropped.has(v)));
    }
  }

  // Look for a path of length bound - extra by dropping `extra` more teams from a base set and
  // asking the exact search for a chain through the rest. A level that is exhaustively empty
  // proves the longest path is shorter, so the first hit is optimal.
  const MAX_EXTRA = 2;
  const MAX_TRIES = 5000;
  let tries = 0;
  let anyUnknown = false;
  for (let extra = 0; extra <= MAX_EXTRA && bound - extra > 1; extra++) {
    let levelUnknown = false;
    for (const base of baseSets) {
      for (const drop of combinations(base, extra)) {
        if (++tries > MAX_TRIES) return boundedLongestPath(out, bound - extra, opts, false);
        const keep = base.filter((v) => !drop.includes(v));
        const { subOut, subIn } = inducedSubgraph(out, keep);
        const res = findHamiltonianPath(subOut, subIn, {
          budget: 50_000,
          hint: localHint(opts.hint, keep),
        });
        if (res.kind === 'found')
          return { order: res.order.map((i) => keep[i]!), exact: !anyUnknown };
        if (res.kind === 'unknown') levelUnknown = true;
      }
    }
    anyUnknown ||= levelUnknown;
  }
  const cap = anyUnknown ? bound : Math.max(1, bound - MAX_EXTRA - 1);
  return boundedLongestPath(out, cap, opts, true);
}

function* combinations<T>(items: readonly T[], k: number, from = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i]!, ...rest];
  }
}

/**
 * Exhaustive longest-path DFS with reachability pruning; stops early at `cap` teams.
 * `capProven`: no path longer than `cap` exists, so reaching it is optimal.
 */
function boundedLongestPath(
  out: ArrayLike<number>,
  cap: number,
  opts: SearchOptions,
  capProven: boolean,
): { order: number[]; exact: boolean } {
  const n = out.length;
  let best: number[] = [0];
  const path: number[] = [];
  let left = opts.budget ?? DEFAULT_BUDGET;
  const hint = hintRank(n, opts.hint);

  const reachableCount = (from: number, allowed: number) => {
    let seen = 0;
    let frontier = (out[from]! & allowed) >>> 0;
    while (frontier !== 0) {
      seen = (seen | frontier) >>> 0;
      let next = 0;
      for (const v of bits(frontier)) next |= out[v]!;
      frontier = (next & allowed & ~seen) >>> 0;
    }
    return popcount(seen);
  };

  const step = (cur: number, visited: number) => {
    if (--left < 0) throw new BudgetExceeded();
    if (path.length > best.length) best = [...path];
    if (best.length >= cap) return;
    const allowed = (fullMask(n) & ~visited) >>> 0;
    if (path.length + reachableCount(cur, allowed) <= best.length) return;
    const onward = (v: number) => popcount(out[v]! & allowed);
    for (const v of orderCandidates(bits(out[cur]! & allowed), cur, onward, hint)) {
      path.push(v);
      step(v, (visited | bit(v)) >>> 0);
      path.pop();
      if (best.length >= cap) return;
    }
  };

  try {
    for (let s = 0; s < n && best.length < cap; s++) {
      path.length = 0;
      path.push(s);
      step(s, bit(s));
    }
    // Finished: exhaustive unless we stopped early at an unproven cap.
    return { order: best, exact: best.length < cap || capProven };
  } catch (e) {
    if (e instanceof BudgetExceeded) return { order: best, exact: false };
    throw e;
  }
}
