import type { FastestPath, GameType, NeededResult, SeasonData } from '@sports-parity/core';
import { useEffect, useRef, useState } from 'react';
import type { PathReply, PathRequest } from './fastest';

export interface PathState {
  /** For this data object; stale answers for older data are never shown. */
  data: SeasonData;
  path: FastestPath | null;
  /** Equally fast ways, best first; null until counted (or when not counted at all). */
  ways: NeededResult[][] | null;
  complete: boolean;
}

/**
 * The fastest path to a circle for `data`, worked out in a Web Worker. Pass null to skip (a
 * past season, say). Returns null while the first answer is on its way.
 */
export function usePath(data: SeasonData | null, gameTypes: readonly GameType[]): PathState | null {
  const worker = useRef<Worker | null>(null);
  const [state, setState] = useState<PathState | null>(null);

  useEffect(() => {
    if (!data) return;
    const w = (worker.current ??= new Worker(new URL('./pathWorker.ts', import.meta.url), {
      type: 'module',
    }));
    const id = Math.random();
    const onReply = (e: MessageEvent<PathReply>) => {
      const r = e.data;
      if (r.id !== id) return;
      if (r.kind === 'best') setState({ data, path: r.path, ways: null, complete: true });
      else setState((s) => (s?.data === data ? { ...s, ways: r.ways, complete: r.complete } : s));
    };
    w.addEventListener('message', onReply);
    const req: PathRequest = { id, season: data, gameTypes: [...gameTypes] };
    w.postMessage(req);
    return () => w.removeEventListener('message', onReply);
  }, [data, gameTypes]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  return state && state.data === data ? state : null;
}
