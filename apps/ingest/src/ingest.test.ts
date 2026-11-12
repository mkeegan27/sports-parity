import type { Game, SeasonData } from '@sports-parity/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { espnEvent } from '../../../packages/adapters/src/espn/fixtures';
import type { Env } from './env';
import { runIngest, SWEEP_EVERY } from './ingest';
import { clearMemo, serveData } from './serve';
import { stateKey, type LiveState } from './state';

const team = (id: string) => ({
  franchiseId: id,
  abbr: id,
  name: id,
  nickname: id,
  colors: { primary: '#000000', secondary: '#ffffff' },
  groups: [],
});
const game = (
  id: string,
  espn: string,
  home: string,
  away: string,
  kickoff: string,
  over: Partial<Game> = {},
): Game => ({
  id,
  gameType: 'regular',
  period: { index: 10, label: 'Week 10' },
  scheduledAt: kickoff,
  status: 'scheduled',
  home,
  away,
  neutralSite: false,
  sourceIds: { nflverse: id, espn },
  ...over,
});

// Thursday night: NYG-WAS kicks off 01:15 UTC; Sunday's DET-NE is days away.
const baseline: SeasonData = {
  schemaVersion: 1,
  league: 'nfl',
  season: '2026',
  generatedAt: '2026-11-12T00:00:00Z',
  sources: [],
  teams: ['NYG', 'WAS', 'DET', 'NE'].map(team),
  games: [
    game('tnf', '1', 'NYG', 'WAS', '2026-11-12T20:15:00-05:00'),
    game('sun', '2', 'DET', 'NE', '2026-11-15T13:00:00-05:00'),
  ],
};

function fakeEnv() {
  const kv = new Map<string, string>();
  const files: Record<string, unknown> = {
    '/data/nfl/index.json': { seasons: [{ season: '2025' }, { season: '2026' }] },
    '/data/nfl/2026.json': baseline,
    '/data/nfl/2025.json': { season: '2025' },
  };
  const env: Env = {
    ASSETS: {
      fetch: (req) => {
        const path = new URL(typeof req === 'string' ? req : req.url).pathname;
        const body = files[path];
        return Promise.resolve(
          body === undefined
            ? new Response('not found', { status: 404 })
            : new Response(JSON.stringify(body), { headers: { etag: `"${path.length}"` } }),
        );
      },
    },
    LIVE: {
      get: (k) => Promise.resolve(kv.get(k) ?? null),
      put: (k, v) => {
        kv.set(k, v);
        return Promise.resolve();
      },
    },
  };
  return { env, kv };
}

/** ESPN answers with whatever `board` holds, and records each URL asked for. */
function fakeEspn(board: { events: unknown[] }) {
  const urls: string[] = [];
  const fetchText = (url: string) => {
    urls.push(url);
    return Promise.resolve(JSON.stringify(board));
  };
  return { urls, fetchText };
}

const state = (kv: Map<string, string>) =>
  JSON.parse(kv.get(stateKey('nfl', '2026'))!) as LiveState;

describe('runIngest', () => {
  beforeEach(clearMemo);

  it('sweeps the current week when no game is on, then rests for a few hours', async () => {
    const { env, kv } = fakeEnv();
    const espn = fakeEspn({ events: [espnEvent({ id: '1', home: ['NYG'], away: ['WSH'] })] });
    const noon = new Date('2026-11-12T17:00:00Z');
    const first = await runIngest(env, noon, espn.fetchText);
    expect(first).toMatchObject({ kind: 'checked', mode: 'sweep', changed: [] });
    expect(espn.urls).toEqual([
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    ]);
    expect(state(kv)).toMatchObject({
      checkedAt: noon.toISOString(),
      changedAt: null,
      inProgress: 0,
    });
    // Nothing differs from the baseline, so nothing is kept.
    expect(state(kv).updates).toEqual({});
    expect(state(kv).nextKickoff).toBe('2026-11-12T20:15:00-05:00');

    const later = new Date(noon.getTime() + SWEEP_EVERY - 60_000);
    expect(await runIngest(env, later, espn.fetchText)).toEqual({ kind: 'idle', season: '2026' });
    expect(espn.urls).toHaveLength(1);
  });

  it('checks the game day every run during a game, and records the final', async () => {
    const { env, kv } = fakeEnv();
    const live = fakeEspn({
      events: [
        espnEvent({
          id: '1',
          home: ['NYG', 7],
          away: ['WSH', 3],
          name: 'STATUS_IN_PROGRESS',
          state: 'in',
          period: 1,
          clock: '2:00',
        }),
      ],
    });
    const kickoff = new Date('2026-11-13T01:20:00Z');
    const r = await runIngest(env, kickoff, live.fetchText);
    expect(r).toMatchObject({ kind: 'checked', mode: 'live', changed: ['tnf'] });
    expect(live.urls).toEqual([
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261112',
    ]);
    expect(state(kv)).toMatchObject({ inProgress: 1, changedAt: kickoff.toISOString() });

    const done = fakeEspn({
      events: [
        espnEvent({
          id: '1',
          home: ['NYG', 17],
          away: ['WSH', 20],
          name: 'STATUS_FINAL',
          state: 'post',
          completed: true,
          period: 4,
        }),
      ],
    });
    const end = new Date('2026-11-13T04:30:00Z');
    expect(await runIngest(env, end, done.fetchText)).toMatchObject({
      mode: 'live',
      changed: ['tnf'],
    });
    expect(state(kv)).toMatchObject({ inProgress: 0, changedAt: end.toISOString() });
    expect(state(kv).updates['1']).toMatchObject({
      status: 'final',
      score: { home: 17, away: 20 },
    });

    // Final now, so the game no longer counts as live: the next run is the overdue sweep, and
    // the one after rests.
    expect(await runIngest(env, new Date('2026-11-13T04:35:00Z'), done.fetchText)).toMatchObject({
      mode: 'sweep',
    });
    expect(await runIngest(env, new Date('2026-11-13T04:40:00Z'), done.fetchText)).toEqual({
      kind: 'idle',
      season: '2026',
    });
  });

  it('keeps the last good state when ESPN sends something unreadable', async () => {
    const { env, kv } = fakeEnv();
    const bad = { urls: [], fetchText: () => Promise.resolve('{"oops": true}') };
    await expect(runIngest(env, new Date('2026-11-12T17:00:00Z'), bad.fetchText)).rejects.toThrow(
      /events/,
    );
    expect(kv.size).toBe(0);
  });
});

describe('serveData', () => {
  beforeEach(clearMemo);
  const get = (env: Env, path: string, headers: Record<string, string> = {}) =>
    serveData(new Request(`https://example.dev${path}`, { headers }), env);

  it('serves latest.json before and after the first check', async () => {
    const { env, kv } = fakeEnv();
    expect(await (await get(env, '/data/nfl/latest.json')).json()).toMatchObject({
      season: '2026',
      checkedAt: null,
    });
    const espn = fakeEspn({
      events: [
        espnEvent({
          id: '1',
          home: ['NYG', 17],
          away: ['WSH', 20],
          name: 'STATUS_FINAL',
          state: 'post',
          completed: true,
          period: 4,
        }),
      ],
    });
    await runIngest(env, new Date('2026-11-13T04:30:00Z'), espn.fetchText);
    clearMemo();
    const latest = await get(env, '/data/nfl/latest.json');
    expect(latest.headers.get('cache-control')).toBe('no-store');
    expect(await latest.json()).toMatchObject({
      changedAt: '2026-11-13T04:30:00.000Z',
      inProgress: 0,
    });
    expect(state(kv).updates['1']).toBeDefined();
  });

  it('lays live results over the current season, with a revalidating ETag', async () => {
    const { env } = fakeEnv();
    const espn = fakeEspn({
      events: [
        espnEvent({
          id: '1',
          home: ['NYG', 17],
          away: ['WSH', 20],
          name: 'STATUS_FINAL',
          state: 'post',
          completed: true,
          period: 4,
        }),
      ],
    });
    await runIngest(env, new Date('2026-11-13T04:30:00Z'), espn.fetchText);
    clearMemo();
    const res = await get(env, '/data/nfl/2026.json?v=1');
    const body = (await res.json()) as SeasonData;
    expect(body.games[0]).toMatchObject({ status: 'final', score: { home: 17, away: 20 } });
    expect(body.games[1]!.status).toBe('scheduled');
    const etag = res.headers.get('etag')!;
    expect((await get(env, '/data/nfl/2026.json', { 'if-none-match': etag })).status).toBe(304);
    // Older seasons and other files are the static ones.
    expect(await (await get(env, '/data/nfl/2025.json')).json()).toEqual({ season: '2025' });
    expect((await get(env, '/data/nhl/2026.json')).status).toBe(404);
  });
});
