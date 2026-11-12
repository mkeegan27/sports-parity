import {
  analyzeSeason,
  parseSeasonData,
  type LeagueConfig,
  type SeasonAnalysis,
  type SeasonData,
} from '@sports-parity/core';
import { useEffect, useMemo, useState } from 'react';

export interface SeasonIndexEntry {
  season: string;
  games: number;
  completed: number;
}

type Loadable<T> = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; value: T };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/** Seasons available for a league, newest first. */
export function useSeasonIndex(league: string): Loadable<SeasonIndexEntry[]> {
  const [result, setResult] = useState<Loadable<SeasonIndexEntry[]>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    getJson(`/data/${league}/index.json`)
      .then((json) => {
        const seasons = (json as { seasons: SeasonIndexEntry[] }).seasons;
        if (live) setResult({ state: 'ready', value: [...seasons].reverse() });
      })
      .catch((e: unknown) => live && setResult({ state: 'error', error: String(e) }));
    return () => {
      live = false;
    };
  }, [league]);
  return result;
}

/**
 * Load, validate and analyze one season. Analysis runs on the main thread for now (tens of ms).
 * A new `version` (the live feed's `changedAt`) refetches it; the old data stays on screen until
 * the new arrives, and stays put if the refetch fails.
 */
export function useSeason(
  league: LeagueConfig,
  season: string | undefined,
  version?: string,
): Loadable<{ data: SeasonData; analysis: SeasonAnalysis }> {
  const key = season ? `${league.id}/${season}` : null;
  const [loaded, setLoaded] = useState<{ key: string; result: Loadable<SeasonData> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const url = version ? `/data/${key}.json?v=${encodeURIComponent(version)}` : `/data/${key}.json`;
    getJson(url)
      .then((json) => live && setLoaded({ key, result: { state: 'ready', value: parseSeasonData(json) } }))
      .catch(
        (e: unknown) =>
          live &&
          setLoaded((prev) =>
            prev?.key === key && prev.result.state === 'ready'
              ? prev
              : { key, result: { state: 'error', error: String(e) } },
          ),
      );
    return () => {
      live = false;
    };
  }, [key, version]);
  return useMemo(() => {
    const data: Loadable<SeasonData> = loaded && loaded.key === key ? loaded.result : { state: 'loading' };
    if (data.state !== 'ready') return data;
    const analysis = analyzeSeason(data.value, { gameTypes: league.defaultGameTypes });
    return { state: 'ready', value: { data: data.value, analysis } };
  }, [loaded, key, league.defaultGameTypes]);
}
