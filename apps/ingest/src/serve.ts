import type { SeasonData } from '@sports-parity/core';
import type { Env } from './env';
import { LIVE_LEAGUES } from './leagues';
import {
  currentSeason,
  readState,
  toLatest,
  withUpdates,
  type Latest,
  type LiveState,
} from './state';

const LEAGUES = new Set(LIVE_LEAGUES.map((l) => l.id));
/** Reuse a state read for this long within one isolate, so polling costs few KV reads. */
const MEMO_MS = 15_000;
const memo = new Map<string, { at: number; state: LiveState | null; season: string | null }>();

const json = (body: string, headers: Record<string, string> = {}, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

async function liveFor(env: Env, league: string, now: number) {
  const hit = memo.get(league);
  if (hit && now - hit.at < MEMO_MS) return hit;
  const season = await currentSeason(env.ASSETS, league);
  const state = season ? await readState(env.LIVE, league, season) : null;
  const entry = { at: now, state, season };
  memo.set(league, entry);
  return entry;
}

/** Test hook: forget memoized state between cases. */
export const clearMemo = () => memo.clear();

/**
 * `/data/*` requests. The current season's file is the built baseline with live updates laid
 * over it; `latest.json` is the small file pages poll. Everything else is the static file.
 */
export async function serveData(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/data\/([a-z0-9-]+)\/([^/]+)\.json$/.exec(url.pathname);
  const league = match?.[1];
  if (!match || !league || !LEAGUES.has(league) || request.method !== 'GET') {
    return env.ASSETS.fetch(request);
  }
  const file = match[2]!;
  // A league whose files aren't in this build (or a bad state value) falls back to the static
  // files: a data route never errors because live state can't be read.
  let live: Awaited<ReturnType<typeof liveFor>>;
  try {
    live = await liveFor(env, league, now);
  } catch (error) {
    console.error(`live state unavailable: ${league}`, error);
    return env.ASSETS.fetch(request);
  }

  if (file === 'latest') {
    const latest: Latest = live.state
      ? toLatest(live.state)
      : {
          league,
          season: live.season ?? '',
          checkedAt: null,
          changedAt: null,
          inProgress: 0,
          nextKickoff: null,
        };
    return json(JSON.stringify(latest), { 'cache-control': 'no-store' });
  }

  if (file !== live.season || !live.state || Object.keys(live.state.updates).length === 0) {
    return env.ASSETS.fetch(request);
  }
  const asset = await env.ASSETS.fetch(new Request(url.origin + url.pathname));
  if (!asset.ok) return asset;
  const etag = `W/"${(asset.headers.get('etag') ?? '').replace(/^W\/|"/g, '')}-${live.state.changedAt ?? ''}"`;
  const headers = { etag, 'cache-control': 'no-cache' };
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  const merged = withUpdates((await asset.json()) as SeasonData, live.state);
  return json(JSON.stringify(merged), headers);
}
