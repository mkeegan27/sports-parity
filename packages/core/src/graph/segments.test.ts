import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bit } from './bitset';
import { findLongestPath } from './hamiltonian';
import { chainBreaks, chainSegments } from './segments';

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
          out[u] = (out[u]! | bit(v)) >>> 0;
          inn[v] = (inn[v]! | bit(u)) >>> 0;
        }
      }),
    );
    return { n, out, inn };
  });

const beats = (out: Uint32Array, u: number, v: number) => ((out[u]! >>> v) & 1) === 1;

describe('chainSegments', () => {
  it('covers every team once with valid chains that cannot be joined', () => {
    fc.assert(
      fc.property(digraph, ({ n, out }) => {
        const main = findLongestPath(out).order;
        const segments = chainSegments(out, main, false);
        expect(segments[0]).toEqual(main);
        expect(segments.flat().sort((a, b) => a - b)).toEqual(
          Array.from({ length: n }, (_, i) => i),
        );
        for (const s of segments) {
          for (let i = 0; i + 1 < s.length; i++) expect(beats(out, s[i]!, s[i + 1]!)).toBe(true);
        }
        // Each chain was the longest available, so no later chain links to or from an earlier one.
        segments.forEach((a, i) =>
          segments.slice(i + 1).forEach((b) => {
            expect(beats(out, a[a.length - 1]!, b[0]!)).toBe(false);
            expect(beats(out, b[b.length - 1]!, a[0]!)).toBe(false);
          }),
        );
      }),
    );
  });

  it('leaves a closed circle whole', () => {
    expect(chainSegments(new Uint32Array([0b10, 0b100, 0b1]), [0, 1, 2], true)).toEqual([
      [0, 1, 2],
    ]);
  });
});

describe('chainBreaks', () => {
  it('explains each break', () => {
    // 0 beat 1; 2 beat 3; 3 has no wins; 0 has no losses.
    const out = new Uint32Array([0b0010, 0, 0b1000, 0]);
    const inn = new Uint32Array([0, 0b0001, 0, 0b0100]);
    out[1] = bit(2); // 1 beat 2: main chain 0 -> 1 -> 2 -> 3
    inn[2] = bit(1);
    expect(chainBreaks(out, inn, [[0, 1, 2, 3]], false)).toEqual([
      { after: 3, before: 0, reason: 'winless' },
    ]);
    expect(chainBreaks(out, inn, [[2, 3], [1], [0]], false)).toEqual([
      { after: 3, before: 1, reason: 'winless' },
      { after: 1, before: 0, reason: 'unbeaten' },
      { after: 0, before: 2, reason: 'unlinked' },
    ]);
    expect(chainBreaks(out, inn, [[0, 1, 2, 3]], true)).toEqual([]);
  });
});
