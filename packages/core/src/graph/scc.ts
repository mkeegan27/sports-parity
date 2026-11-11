import { bit, bits } from './bitset';

/**
 * Strongly connected components (Tarjan, iterative). A circle of parity requires the whole
 * league to be one component, so watching components merge shows progress toward a circle.
 * Returns components as bitmasks, in reverse topological order of the condensation.
 */
export function stronglyConnectedComponents(out: ArrayLike<number>): number[] {
  const n = out.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const components: number[] = [];
  let counter = 0;

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work: { v: number; next: number[] }[] = [];
    const open = (v: number) => {
      index[v] = low[v] = counter++;
      stack.push(v);
      onStack[v] = 1;
      work.push({ v, next: bits(out[v]!) });
    };
    open(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const w = frame.next.shift();
      if (w !== undefined) {
        if (index[w] === -1) open(w);
        else if (onStack[w]) low[frame.v] = Math.min(low[frame.v]!, index[w]!);
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low[parent.v] = Math.min(low[parent.v]!, low[frame.v]!);
      if (low[frame.v] === index[frame.v]) {
        let comp = 0;
        let x: number;
        do {
          x = stack.pop()!;
          onStack[x] = 0;
          comp = (comp | bit(x)) >>> 0;
        } while (x !== frame.v);
        components.push(comp);
      }
    }
  }
  return components;
}
