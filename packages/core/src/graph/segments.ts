import { bit, has } from './bitset';
import { findLongestPath, type SearchOptions } from './hamiltonian';

/** Why a chain stops where it does. */
export type BreakReason =
  /** The team at the end hasn't beaten anyone. */
  | 'winless'
  /** The team after the break hasn't lost to anyone. */
  | 'unbeaten'
  /** Neither, but the team at the end hasn't beaten the team after the break. */
  | 'unlinked';

export interface ChainBreak {
  /** Last team before the break. */
  after: number;
  /** First team after the break. */
  before: number;
  reason: BreakReason;
}

/**
 * Cover every team with chains, for drawing an unclosed ring: the main chain first, then the
 * longest chain among the teams left over, and so on. Because each chain is the longest
 * available when it's picked, no two chains can be joined end to end.
 *
 * `closed` means `mainOrder` is already a full circle, so there is nothing to split.
 */
export function chainSegments(
  out: ArrayLike<number>,
  mainOrder: readonly number[],
  closed: boolean,
  search: SearchOptions = { budget: 200_000 },
): number[][] {
  const n = out.length;
  const segments = [Array.from(mainOrder)];
  if (closed) return segments;
  const placed = new Set(mainOrder);
  let rest = Array.from({ length: n }, (_, i) => i).filter((i) => !placed.has(i));
  while (rest.length > 0) {
    // Induced subgraph on the leftover teams, renumbered 0..rest.length-1.
    const local = rest.map((u) => {
      let mask = 0;
      rest.forEach((v, j) => {
        if (has(out[u]!, v)) mask = (mask | bit(j)) >>> 0;
      });
      return mask;
    });
    const { order } = findLongestPath(local, search);
    const segment = order.map((j) => rest[j]!);
    segments.push(segment);
    const taken = new Set(segment);
    rest = rest.filter((u) => !taken.has(u));
  }
  return segments;
}

/** The break after each segment (wrapping around), with the reason it can't be crossed yet. */
export function chainBreaks(
  out: ArrayLike<number>,
  inn: ArrayLike<number>,
  segments: readonly (readonly number[])[],
  closed: boolean,
): ChainBreak[] {
  if (closed) return [];
  return segments.map((segment, i) => {
    const after = segment[segment.length - 1]!;
    const before = segments[(i + 1) % segments.length]![0]!;
    const reason: BreakReason =
      out[after] === 0 ? 'winless' : inn[before] === 0 ? 'unbeaten' : 'unlinked';
    return { after, before, reason };
  });
}
