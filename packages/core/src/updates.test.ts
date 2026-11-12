import { describe, expect, it } from 'vitest';
import type { Game, SeasonData } from './schema';
import { applyGameUpdate, applyUpdates, sameGame } from './updates';

const game = (over: Partial<Game> = {}): Game => ({
  id: 'g1',
  gameType: 'regular',
  period: { index: 10, label: 'Week 10' },
  scheduledAt: '2026-11-12T20:15:00-05:00',
  status: 'scheduled',
  home: 'NYG',
  away: 'WAS',
  neutralSite: false,
  sourceIds: { nflverse: 'g1', espn: '401' },
  ...over,
});

describe('applyGameUpdate', () => {
  it('takes status, score and live clock from the update', () => {
    const live = applyGameUpdate(game(), {
      status: 'in_progress',
      scheduledAt: '2026-11-13T01:15:00.000Z',
      score: { home: 7, away: 3 },
      live: { period: 'Q2', clock: '4:12' },
    });
    expect(live).toMatchObject({
      status: 'in_progress',
      score: { home: 7, away: 3 },
      live: { period: 'Q2' },
    });
    // Same instant, different spelling: the baseline's string stays.
    expect(live.scheduledAt).toBe('2026-11-12T20:15:00-05:00');

    const final = applyGameUpdate(live, {
      status: 'final',
      scheduledAt: '2026-11-13T01:15:00.000Z',
      score: { home: 24, away: 20 },
      outcome: 'overtime',
    });
    expect(final).toMatchObject({
      status: 'final',
      outcome: 'overtime',
      score: { home: 24, away: 20 },
    });
    expect(final.live).toBeUndefined();
  });

  it('never takes a final back, and drops scores from games not yet played', () => {
    const final = game({ status: 'final', score: { home: 1, away: 0 }, outcome: 'regulation' });
    expect(applyGameUpdate(final, { status: 'scheduled', scheduledAt: final.scheduledAt })).toBe(
      final,
    );
    const moved = applyGameUpdate(game(), {
      status: 'postponed',
      scheduledAt: '2026-11-14T18:00:00.000Z',
      score: { home: 0, away: 0 },
    });
    expect(moved.score).toBeUndefined();
    expect(moved.scheduledAt).toBe('2026-11-14T18:00:00.000Z');
  });
});

describe('applyUpdates', () => {
  const season: SeasonData = {
    schemaVersion: 1,
    league: 'nfl',
    season: '2026',
    generatedAt: '2026-11-12T00:00:00Z',
    sources: [],
    teams: [],
    games: [game(), game({ id: 'g2', sourceIds: { nflverse: 'g2' } })],
  };

  it('matches by source ID and leaves the season alone when nothing applies', () => {
    expect(applyUpdates(season, 'espn', {})).toBe(season);
    const next = applyUpdates(season, 'espn', {
      '401': {
        status: 'final',
        scheduledAt: season.games[0]!.scheduledAt,
        score: { home: 2, away: 1 },
      },
    });
    expect(next.games[0]!.status).toBe('final');
    expect(next.games[1]).toBe(season.games[1]);
    expect(sameGame(next.games[0]!, season.games[0]!)).toBe(false);
    expect(
      sameGame(season.games[0]!, { ...season.games[0]!, scheduledAt: '2026-11-13T01:15:00Z' }),
    ).toBe(true);
  });
});
