import { useEffect, useState } from 'react';

/** The small file the site's Worker serves for each league (see apps/ingest). */
export interface Latest {
  league: string;
  season: string;
  /** Last successful check of the live source. */
  checkedAt: string | null;
  /** Last time any game changed; the season file is refetched when this moves. */
  changedAt: string | null;
  inProgress: number;
  nextKickoff: string | null;
}

const FAST_MS = 60_000;
const SLOW_MS = 5 * 60_000;
/** Poll fast from this long before a kickoff. */
const WARMUP_MS = 15 * 60_000;

const isLatest = (v: unknown): v is Latest =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Latest).season === 'string' &&
  typeof (v as Latest).inProgress === 'number';

/** Every minute while games are on or about to start, every five minutes otherwise. */
export function pollDelay(latest: Latest | null, now: number): number {
  if (!latest) return SLOW_MS;
  if (latest.inProgress > 0) return FAST_MS;
  const next = latest.nextKickoff ? Date.parse(latest.nextKickoff) : NaN;
  return next - now < WARMUP_MS ? FAST_MS : SLOW_MS;
}

/**
 * Poll the league's `latest.json` while the page is visible, and right away when it becomes
 * visible again. Null until the first answer, and stays null where there's no Worker (the Vite
 * dev server, for one), so the page simply shows no live state.
 */
export function useLatest(league: string): Latest | null {
  const [latest, setLatest] = useState<Latest | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let current: Latest | null = null;
    const poll = async () => {
      window.clearTimeout(timer);
      try {
        const res = await fetch(`/data/${league}/latest.json`, { cache: 'no-store' });
        const body: unknown = res.ok ? await res.json() : null;
        if (alive && isLatest(body)) {
          current = body;
          setLatest((prev) =>
            prev &&
            prev.checkedAt === body.checkedAt &&
            prev.changedAt === body.changedAt &&
            prev.inProgress === body.inProgress
              ? prev
              : body,
          );
        }
      } catch {
        // Offline or no Worker: try again later.
      }
      if (alive && document.visibilityState === 'visible') {
        timer = window.setTimeout(() => void poll(), pollDelay(current, Date.now()));
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
      else window.clearTimeout(timer);
    };
    void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [league]);
  return latest;
}
