import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bits, fullMask, popcount } from './bitset';
import { findHamiltonianCycle, findHamiltonianPath, findLongestPath } from './hamiltonian';
import { stronglyConnectedComponents } from './scc';

/** Random digraph on n <= 8 nodes as bitset adjacency (no self-loops). */
const digraph = fc
  .integer({ min: 1, max: 8 })
  .chain((n) =>
    fc.tuple(
      fc.constant(n),
      fc.array(fc.array(fc.boolean(), { minLength: n, maxLength: n }), {
        minLength: n,
        maxLength: n,
      }),
    ),
  )
  .map(([n, matrix]) => {
    const out = new Uint32Array(n);
    const inn = new Uint32Array(n);
    matrix.forEach((row, u) =>
      row.forEach((edge, v) => {
        if (edge && u !== v) {
          out[u] = (out[u]! | (1 << v)) >>> 0;
          inn[v] = (inn[v]! | (1 << u)) >>> 0;
        }
      }),
    );
    return { n, out, inn };
  });

const hasEdge = (out: Uint32Array, u: number, v: number) => ((out[u]! >>> v) & 1) === 1;

function* permutations(items: number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i]!, ...p];
  }
}

const isPath = (out: Uint32Array, order: number[]) =>
  order.every((u, i) => i === 0 || hasEdge(out, order[i - 1]!, u));
const isCycle = (out: Uint32Array, order: number[]) =>
  order.length > 1 && isPath(out, order) && hasEdge(out, order[order.length - 1]!, order[0]!);
const visitsAllOnce = (n: number, order: number[]) =>
  order.length === n && new Set(order).size === n;

function bruteForce(n: number, out: Uint32Array) {
  let cycle = false;
  let path = false;
  for (const p of permutations(Array.from({ length: n }, (_, i) => i))) {
    if (isPath(out, p)) path = true;
    if (isCycle(out, p)) cycle = true;
  }
  return { cycle, path };
}

function bruteLongestPath(n: number, out: Uint32Array): number {
  let best = n > 0 ? 1 : 0;
  const extend = (path: number[], used: number) => {
    best = Math.max(best, path.length);
    for (const v of bits(out[path[path.length - 1]!]! & ~used))
      extend([...path, v], (used | (1 << v)) >>> 0);
  };
  for (let s = 0; s < n; s++) extend([s], 1 << s);
  return best;
}

describe('bitset', () => {
  it('builds full masks safely up to 32 teams', () => {
    expect(fullMask(31)).toBe(0x7fffffff);
    expect(fullMask(32)).toBe(0xffffffff);
    expect(popcount(fullMask(32))).toBe(32);
    expect(bits(fullMask(32))).toHaveLength(32);
    expect(() => fullMask(33)).toThrow(RangeError);
  });
});

describe('Hamiltonian search', () => {
  it('agrees with brute force on random graphs and returns valid orders', () => {
    fc.assert(
      fc.property(digraph, ({ n, out, inn }) => {
        const truth = bruteForce(n, out);
        const cycle = findHamiltonianCycle(out, inn);
        const path = findHamiltonianPath(out, inn);
        expect(cycle.kind).not.toBe('unknown');
        expect(path.kind).not.toBe('unknown');
        expect(cycle.kind === 'found').toBe(truth.cycle && n > 1);
        expect(path.kind === 'found').toBe(truth.path);
        if (cycle.kind === 'found') {
          expect(visitsAllOnce(n, cycle.order)).toBe(true);
          expect(isCycle(out, cycle.order)).toBe(true);
        }
        if (path.kind === 'found') {
          expect(visitsAllOnce(n, path.order)).toBe(true);
          expect(isPath(out, path.order)).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('finds the true longest path', () => {
    fc.assert(
      fc.property(digraph, ({ n, out }) => {
        const { order, exact } = findLongestPath(out);
        expect(exact).toBe(true);
        expect(new Set(order).size).toBe(order.length);
        expect(isPath(out, order)).toBe(true);
        expect(order.length).toBe(bruteLongestPath(n, out));
      }),
      { numRuns: 300 },
    );
  });

  it('reports unknown rather than a wrong answer when the budget runs out', () => {
    // A 12-cycle plus chords: solvable, but not within a budget of 1 node.
    const n = 12;
    const out = new Uint32Array(n);
    const inn = new Uint32Array(n);
    for (let u = 0; u < n; u++) {
      for (const v of [(u + 1) % n, (u + 5) % n]) {
        out[u] = (out[u]! | (1 << v)) >>> 0;
        inn[v] = (inn[v]! | (1 << u)) >>> 0;
      }
    }
    expect(findHamiltonianCycle(out, inn, { budget: 1 }).kind).toBe('unknown');
    expect(findHamiltonianCycle(out, inn).kind).toBe('found');
  });
});

describe('strongly connected components', () => {
  it('partitions nodes into mutually reachable groups', () => {
    fc.assert(
      fc.property(digraph, ({ n, out }) => {
        const reach = Array.from({ length: n }, (_, s) => {
          let seen = 1 << s;
          let frontier = 1 << s;
          while (frontier) {
            let next = 0;
            for (const v of bits(frontier)) next |= out[v]!;
            frontier = next & ~seen;
            seen |= next;
          }
          return seen >>> 0;
        });
        const comps = stronglyConnectedComponents(out);
        expect(comps.reduce((acc, c) => acc | c, 0) >>> 0).toBe(fullMask(n));
        expect(comps.reduce((acc, c) => acc + popcount(c), 0)).toBe(n);
        for (const c of comps) {
          for (const u of bits(c)) {
            for (let v = 0; v < n; v++) {
              const mutual = ((reach[u]! >>> v) & 1) === 1 && ((reach[v]! >>> u) & 1) === 1;
              expect(((c >>> v) & 1) === 1).toBe(mutual);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
