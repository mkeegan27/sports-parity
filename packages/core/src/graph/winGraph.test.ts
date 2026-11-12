import { describe, expect, it } from 'vitest';
import type { Game } from '../schema';
import { buildWinGraph } from './winGraph';

const game = (
  id: string,
  home: string,
  away: string,
  score: [number, number] | null,
  week = 1,
  extra: Partial<Game> = {},
): Game => ({
  id,
  gameType: 'regular',
  period: { index: week, label: `Week ${week}` },
  scheduledAt: '2026-09-10T20:20:00-04:00',
  status: score ? 'final' : 'scheduled',
  home,
  away,
  neutralSite: false,
  ...(score ? { score: { home: score[0], away: score[1] } } : {}),
  sourceIds: {},
  ...extra,
});

const teams = ['A', 'B', 'C'];
const beat = (g: ReturnType<typeof buildWinGraph>, w: string, l: string) =>
  ((g.out[teams.indexOf(w)]! >>> teams.indexOf(l)) & 1) === 1;

describe('buildWinGraph', () => {
  it('adds an edge from winner to loser and tracks records', () => {
    const g = buildWinGraph(teams, [game('1', 'A', 'B', [24, 17]), game('2', 'C', 'A', [10, 13])], {
      gameTypes: ['regular'],
    });
    expect(beat(g, 'A', 'B')).toBe(true);
    expect(beat(g, 'A', 'C')).toBe(true);
    expect(beat(g, 'B', 'A')).toBe(false);
    expect(g.records[0]).toEqual({ wins: 2, losses: 0, ties: 0 });
  });

  it('creates no edge for a tie but records it', () => {
    const g = buildWinGraph(teams, [game('1', 'A', 'B', [20, 20])], { gameTypes: ['regular'] });
    expect(g.edges).toHaveLength(0);
    expect(g.records[0]!.ties).toBe(1);
  });

  it('keeps both directions for a split season series', () => {
    const g = buildWinGraph(teams, [game('1', 'A', 'B', [1, 0]), game('2', 'B', 'A', [1, 0], 9)], {
      gameTypes: ['regular'],
    });
    expect(beat(g, 'A', 'B') && beat(g, 'B', 'A')).toBe(true);
  });

  it('filters by game type, period and status', () => {
    const games = [
      game('1', 'A', 'B', [1, 0], 1, { gameType: 'postseason' }),
      game('2', 'B', 'C', [1, 0], 5),
      game('3', 'C', 'A', [1, 0], 2, { status: 'cancelled' }),
      game('4', 'C', 'B', null, 3),
    ];
    const g = buildWinGraph(teams, games, { gameTypes: ['regular'], throughPeriod: 4 });
    expect(g.edges).toHaveLength(0);
    expect(
      buildWinGraph(teams, games, { gameTypes: ['regular', 'postseason'] }).edges,
    ).toHaveLength(2);
  });

  it('applies scenario overrides to played and unplayed games', () => {
    const games = [game('1', 'A', 'B', [24, 17]), game('2', 'B', 'C', null, 2)];
    const g = buildWinGraph(teams, games, {
      gameTypes: ['regular'],
      overrides: new Map([
        ['1', 'B'],
        ['2', 'C'],
      ]),
    });
    expect(beat(g, 'B', 'A')).toBe(true);
    expect(beat(g, 'A', 'B')).toBe(false);
    expect(beat(g, 'C', 'B')).toBe(true);
    expect(g.edges.every((e) => e.simulated)).toBe(true);
  });
});
