/**
 * 32-bit team sets. Node i is bit i. All results are normalized with `>>> 0` so bit 31
 * never turns a mask negative (a bug the 31-team seasons exposed in the spike).
 */
export const MAX_NODES = 32;

export function fullMask(n: number): number {
  if (n < 0 || n > MAX_NODES) throw new RangeError(`team count ${n} outside 0..${MAX_NODES}`);
  return n === 32 ? 0xffffffff : ((1 << n) >>> 0) - 1;
}

export const bit = (i: number): number => (1 << i) >>> 0;

export const has = (mask: number, i: number): boolean => ((mask >>> i) & 1) === 1;

export const add = (mask: number, i: number): number => (mask | (1 << i)) >>> 0;

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Indices of set bits, ascending. */
export function bits(mask: number): number[] {
  const out: number[] = [];
  let m = mask >>> 0;
  while (m !== 0) {
    const low = (m & -m) >>> 0;
    out.push(31 - Math.clz32(low));
    m = (m ^ low) >>> 0;
  }
  return out;
}
