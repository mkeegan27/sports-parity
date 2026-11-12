import type { Game, NeededResult, SeasonTeam } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';
import { liveCall } from './PathBanner';

const team = (id: string, nickname: string): SeasonTeam => ({
  franchiseId: id,
  abbr: id,
  name: nickname,
  nickname,
  colors: { primary: '#000000', secondary: '#ffffff' },
  groups: [],
});
const teams = [team('LAC', 'Chargers'), team('BAL', 'Ravens')];
const need: NeededResult = { gameId: 'g', winner: 0, loser: 1, periodIndex: 10 };
const game = (over: Partial<Game>): Game => ({
  id: 'g',
  gameType: 'regular',
  period: { index: 10, label: 'Week 10' },
  scheduledAt: '2026-11-17T01:15:00Z',
  status: 'in_progress',
  home: 'BAL',
  away: 'LAC',
  neutralSite: false,
  sourceIds: {},
  ...over,
});
const night = new Date(2026, 10, 16, 21, 30).getTime();

describe('liveCall', () => {
  it('says what happens if the score holds, from the needed winner’s side', () => {
    const lead = game({ score: { home: 10, away: 17 }, live: { period: 'Q3', clock: '6:41' } });
    expect(liveCall(need, lead, teams, true, night)).toBe(
      'Chargers lead 17–10 in the 3rd. If it holds, the circle closes tonight.',
    );
    expect(liveCall(need, lead, teams, false, night)).toBe('Chargers lead 17–10 in the 3rd.');
    const trail = game({ score: { home: 21, away: 7 }, live: { period: 'Half' } });
    expect(liveCall(need, trail, teams, true, night)).toBe('Chargers trail 7–21 at halftime.');
    const tied = game({ score: { home: 3, away: 3 }, live: { period: 'End Q1' } });
    expect(liveCall(need, tied, teams, true, night)).toBe('Tied 3–3 after the 1st.');
  });

  it('stays quiet for games not in progress', () => {
    expect(liveCall(need, game({ status: 'scheduled' }), teams, true, night)).toBeNull();
    expect(liveCall(need, undefined, teams, true, night)).toBeNull();
  });
});
