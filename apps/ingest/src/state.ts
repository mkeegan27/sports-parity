import { applyUpdates, type GameUpdates, type SeasonData } from '@sports-parity/core';
import { ESPN_SOURCE } from '@sports-parity/adapters';
import type { AssetFetcher, KvStore } from './env';

/**
 * What the Worker keeps in KV for a league's current season: the ESPN updates laid over the
 * nflverse baseline, plus the times the page shows. One small JSON value per season, written
 * only when a check runs.
 */
export interface LiveState {
  version: 1;
  league: string;
  season: string;
  updates: GameUpdates;
  /** Last successful check of the source. */
  checkedAt: string | null;
  /** Last time any game's facts changed. Pages refetch the season when this moves. */
  changedAt: string | null;
  /** Last full-week sweep (the every-3-hours check outside game windows). */
  sweptAt: string | null;
  inProgress: number;
  /** The next scheduled kickoff, so pages can poll faster just before games. */
  nextKickoff: string | null;
}

/** The small file open pages poll. */
export type Latest = Pick<
  LiveState,
  'league' | 'season' | 'checkedAt' | 'changedAt' | 'inProgress' | 'nextKickoff'
>;

export const stateKey = (league: string, season: string) => `live:${league}:${season}`;

export const emptyState = (league: string, season: string): LiveState => ({
  version: 1,
  league,
  season,
  updates: {},
  checkedAt: null,
  changedAt: null,
  sweptAt: null,
  inProgress: 0,
  nextKickoff: null,
});

export async function readState(
  kv: KvStore,
  league: string,
  season: string,
): Promise<LiveState | null> {
  const text = await kv.get(stateKey(league, season), { cacheTtl: 30 });
  if (!text) return null;
  const state = JSON.parse(text) as LiveState;
  return state.version === 1 ? state : null;
}

export const toLatest = (s: LiveState): Latest => ({
  league: s.league,
  season: s.season,
  checkedAt: s.checkedAt,
  changedAt: s.changedAt,
  inProgress: s.inProgress,
  nextKickoff: s.nextKickoff,
});

const ASSET_ORIGIN = 'https://assets.local';

/** A JSON file from the built site. The baseline files were validated when the site was built. */
export async function assetJson<T>(assets: AssetFetcher, path: string): Promise<T> {
  const res = await assets.fetch(new Request(ASSET_ORIGIN + path));
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** The newest season in the league's index (the one live updates apply to). */
export async function currentSeason(assets: AssetFetcher, league: string): Promise<string | null> {
  const index = await assetJson<{ seasons: { season: string }[] }>(
    assets,
    `/data/${league}/index.json`,
  );
  return index.seasons.at(-1)?.season ?? null;
}

export const withUpdates = (baseline: SeasonData, state: LiveState | null): SeasonData =>
  state ? applyUpdates(baseline, ESPN_SOURCE, state.updates) : baseline;
