import { applyGameUpdate, sameGame, type GameUpdates, type SeasonData } from '@sports-parity/core';
import {
  ESPN_SOURCE,
  espnDate,
  espnScoreboardUrl,
  parseEspnScoreboard,
  reconcileEspn,
  type EspnGame,
} from '@sports-parity/adapters';
import type { Env, FetchText } from './env';
import {
  assetJson,
  currentSeason,
  emptyState,
  readState,
  stateKey,
  withUpdates,
  type LiveState,
} from './state';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A game counts as live from kickoff until it's final, or until this long after kickoff. */
export const GAME_WINDOW = 6 * HOUR;
/** Outside game windows, the whole current week is re-checked this often. */
export const SWEEP_EVERY = 3 * HOUR;

const LEAGUE = 'nfl';

export type IngestResult =
  | { kind: 'idle'; season: string }
  | {
      kind: 'checked';
      season: string;
      mode: 'live' | 'sweep';
      urls: string[];
      changed: string[];
      rejected: { espnId: string; reason: string }[];
    };

/**
 * What to fetch now: the days of games inside their window (every run), or the current week
 * (every few hours otherwise), or nothing.
 */
export function plan(
  season: SeasonData,
  state: LiveState,
  now: Date,
): { mode: 'live' | 'sweep'; urls: string[] } | null {
  const t = now.getTime();
  const days = new Set<string>();
  for (const g of season.games) {
    const kickoff = Date.parse(g.scheduledAt);
    const inWindow = g.status === 'scheduled' && kickoff <= t && t - kickoff < GAME_WINDOW;
    if (g.status === 'in_progress' || inWindow) days.add(espnDate(new Date(kickoff)));
  }
  if (days.size > 0)
    return { mode: 'live', urls: [...days].sort().map((d) => espnScoreboardUrl(d)) };
  const swept = state.sweptAt ? Date.parse(state.sweptAt) : -Infinity;
  if (t - swept >= SWEEP_EVERY) return { mode: 'sweep', urls: [espnScoreboardUrl()] };
  return null;
}

/** Drop updates that say nothing the baseline doesn't (after a redeploy picks them up). */
function prune(baseline: SeasonData, updates: GameUpdates): GameUpdates {
  const kept: GameUpdates = {};
  for (const g of baseline.games) {
    const id = g.sourceIds[ESPN_SOURCE];
    const u = id === undefined ? undefined : updates[id];
    if (id !== undefined && u && !sameGame(g, applyGameUpdate(g, u))) kept[id] = u;
  }
  return kept;
}

/** One cron run: decide whether to check, fetch ESPN, merge, and save. */
export async function runIngest(
  env: Env,
  now: Date,
  fetchText: FetchText,
): Promise<IngestResult | null> {
  const season = await currentSeason(env.ASSETS, LEAGUE);
  if (!season) return null;
  const baseline = await assetJson<SeasonData>(env.ASSETS, `/data/${LEAGUE}/${season}.json`);
  const state = (await readState(env.LIVE, LEAGUE, season)) ?? emptyState(LEAGUE, season);
  const effective = withUpdates(baseline, state);

  const todo = plan(effective, state, now);
  if (!todo) return { kind: 'idle', season };

  const games: EspnGame[] = [];
  for (const url of todo.urls) games.push(...parseEspnScoreboard(JSON.parse(await fetchText(url))));
  const result = reconcileEspn(effective, games);

  const updates = prune(baseline, { ...state.updates, ...result.updates });
  const merged = withUpdates(baseline, { ...state, updates });
  const t = now.getTime();
  const iso = now.toISOString();
  const upcoming = merged.games
    .filter((g) => g.status === 'scheduled' && Date.parse(g.scheduledAt) > t)
    .map((g) => g.scheduledAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const next: LiveState = {
    ...state,
    updates,
    checkedAt: iso,
    changedAt: result.changed.length > 0 ? iso : state.changedAt,
    sweptAt: todo.mode === 'sweep' ? iso : state.sweptAt,
    inProgress: merged.games.filter((g) => g.status === 'in_progress').length,
    nextKickoff: upcoming[0] ?? null,
  };
  await env.LIVE.put(stateKey(LEAGUE, season), JSON.stringify(next));
  return {
    kind: 'checked',
    season,
    mode: todo.mode,
    urls: todo.urls,
    changed: result.changed.map((g) => g.id),
    rejected: result.rejected,
  };
}
