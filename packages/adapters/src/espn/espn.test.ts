import type { Game, SeasonData } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';
import { espnEvent } from './fixtures';
import { espnDate, parseEspnScoreboard, reconcileEspn } from './index';

describe('parseEspnScoreboard', () => {
  it('maps ESPN states onto ours', () => {
    const games = parseEspnScoreboard({
      events: [
        espnEvent({ id: '1', home: ['NYG'], away: ['WSH'] }),
        espnEvent({
          id: '2',
          home: ['LAR', 14],
          away: ['SF', 10],
          name: 'STATUS_IN_PROGRESS',
          state: 'in',
          period: 3,
          clock: '8:01',
        }),
        espnEvent({
          id: '3',
          home: ['KC', 7],
          away: ['LV', 7],
          name: 'STATUS_HALFTIME',
          state: 'in',
          period: 2,
        }),
        espnEvent({
          id: '4',
          home: ['DAL', 27],
          away: ['PHI', 24],
          name: 'STATUS_FINAL',
          state: 'post',
          completed: true,
          period: 5,
        }),
        espnEvent({
          id: '5',
          home: ['MIA'],
          away: ['BUF'],
          name: 'STATUS_POSTPONED',
          state: 'post',
        }),
        espnEvent({
          id: '6',
          home: ['SEA', 3],
          away: ['ARI', 0],
          name: 'STATUS_SUSPENDED',
          state: 'post',
        }),
      ],
    });
    expect(games.map((g) => g.update.status)).toEqual([
      'scheduled',
      'in_progress',
      'in_progress',
      'final',
      'postponed',
    ]);
    // ESPN's abbreviations become nflverse franchise IDs; times gain seconds.
    expect(games[0]).toMatchObject({
      home: 'NYG',
      away: 'WAS',
      update: { scheduledAt: '2026-11-13T01:15:00.000Z' },
    });
    expect(games[1]).toMatchObject({
      home: 'LA',
      update: { score: { home: 14, away: 10 }, live: { period: 'Q3', clock: '8:01' } },
    });
    expect(games[2]!.update.live?.period).toBe('Half');
    expect(games[3]!.update.outcome).toBe('overtime');
  });

  it('throws on a payload of the wrong shape', () => {
    expect(() => parseEspnScoreboard({})).toThrow(/events/);
    expect(() => parseEspnScoreboard({ events: [{ id: '1', competitions: [{}] }] })).toThrow();
  });
});

describe('espnDate', () => {
  it('uses the US Eastern calendar day', () => {
    // 01:15 UTC on the 13th is 20:15 Eastern on the 12th.
    expect(espnDate(new Date('2026-11-13T01:15:00Z'))).toBe('20261112');
    expect(espnDate(new Date('2026-11-13T05:30:00Z'))).toBe('20261113');
  });
});

describe('reconcileEspn', () => {
  const game = (
    id: string,
    espn: string,
    home: string,
    away: string,
    over: Partial<Game> = {},
  ): Game => ({
    id,
    gameType: 'regular',
    period: { index: 10, label: 'Week 10' },
    scheduledAt: '2026-11-12T20:15:00-05:00',
    status: 'scheduled',
    home,
    away,
    neutralSite: false,
    sourceIds: { nflverse: id, espn },
    ...over,
  });
  const season = {
    games: [
      game('a', '1', 'NYG', 'WAS'),
      game('b', '2', 'DET', 'NE', { neutralSite: true }),
      game('c', '3', 'KC', 'LV', {
        status: 'final',
        score: { home: 30, away: 3 },
        outcome: 'regulation',
      }),
    ],
  } as SeasonData;

  it('updates matched games, flips swapped sides, and rejects mismatches', () => {
    const r = reconcileEspn(
      season,
      parseEspnScoreboard({
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
          // ESPN lists the neutral-site game the other way round.
          espnEvent({
            id: '2',
            home: ['NE', 21],
            away: ['DET', 10],
            name: 'STATUS_FINAL',
            state: 'post',
            completed: true,
            period: 4,
          }),
          // Already final with the same score: kept, not changed.
          espnEvent({
            id: '3',
            home: ['KC', 30],
            away: ['LV', 3],
            name: 'STATUS_FINAL',
            state: 'post',
            completed: true,
            period: 4,
          }),
          espnEvent({ id: '9', home: ['GB'], away: ['CHI'] }),
          espnEvent({ id: '1', home: ['NYJ'], away: ['WSH'] }),
        ],
      }),
    );
    expect(r.changed.map((g) => [g.id, g.score])).toEqual([
      ['a', { home: 17, away: 20 }],
      ['b', { home: 10, away: 21 }],
    ]);
    expect(Object.keys(r.updates).sort()).toEqual(['1', '2', '3']);
    expect(r.updates['1']!.status).toBe('final');
    expect(r.rejected.map((x) => x.espnId)).toEqual(['9', '1']);
  });
});
