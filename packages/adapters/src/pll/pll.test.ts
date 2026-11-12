import { parseSeasonData } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';
import { espnEvent } from '../espn/fixtures';
import { buildPllSeason, weekendLabel } from './index';

const final = (id: string, date: string, home: string, away: string, hs = 10, as = 8) =>
  espnEvent({
    id,
    date,
    home: [home, hs],
    away: [away, as],
    name: 'STATUS_FINAL',
    state: 'post',
    completed: true,
    period: 4,
  });

const TEAMS = ['ARC', 'ATL', 'CAN', 'CHA', 'CHR', 'RED', 'WAT', 'WHP'];

/** A small season: a Championship Series, five regular weekends, an All-Star game, playoffs. */
function season() {
  const events = [];
  let id = 1;
  // Championship Series in February (franchise teams).
  events.push(final(String(id++), '2023-02-14T22:00Z', 'ATL', 'WHP'));
  // Five regular weekends: everyone plays once each weekend (4 games), Fri-Sat.
  for (const [day1, day2] of [
    ['2023-06-02', '2023-06-03'],
    ['2023-06-09', '2023-06-10'],
    ['2023-06-16', '2023-06-17'],
    ['2023-06-23', '2023-06-24'],
    ['2023-06-30', '2023-07-01'],
  ]) {
    for (let g = 0; g < 4; g++) {
      events.push(
        final(String(id++), `${g < 2 ? day1 : day2}T23:00Z`, TEAMS[2 * g]!, TEAMS[2 * g + 1]!),
      );
    }
  }
  // All-Star game: non-franchise sides.
  events.push(final(String(id++), '2023-07-08T23:00Z', 'EAST', 'WEST'));
  // A game ESPN never finalized.
  events.push(
    espnEvent({ id: String(id++), date: '2023-07-15T23:00Z', home: ['RED'], away: ['WAT'] }),
  );
  // Playoffs: 3, 2, then a single-game final.
  events.push(final(String(id++), '2023-09-02T20:00Z', 'ARC', 'ATL'));
  events.push(final(String(id++), '2023-09-02T23:00Z', 'CAN', 'CHA'));
  events.push(final(String(id++), '2023-09-03T20:00Z', 'CHR', 'RED'));
  events.push(final(String(id++), '2023-09-10T20:00Z', 'ARC', 'CAN'));
  events.push(final(String(id++), '2023-09-10T23:00Z', 'CHR', 'WAT'));
  events.push(final(String(id), '2023-09-24T20:00Z', 'ARC', 'CHR'));
  return buildPllSeason({ events }, 2023, '2023-11-01T00:00:00Z');
}

describe('buildPllSeason', () => {
  const s = season();

  it('keeps the franchises and drops All-Star sides', () => {
    expect(s.teams.map((t) => t.franchiseId)).toEqual([
      'ARC',
      'ATL',
      'CAN',
      'CHA',
      'OUT',
      'RED',
      'WAT',
      'WHP',
    ]);
    expect(s.games.some((g) => g.home === 'EAST' || g.away === 'WEST')).toBe(false);
    expect(() => parseSeasonData(s)).not.toThrow();
  });

  it('groups games into weekends and classifies them', () => {
    const periods = [
      ...new Map(s.games.map((g) => [g.period.index, [g.period.label, g.gameType]])).values(),
    ];
    expect(periods).toEqual([
      ['Feb 14', 'tournament'],
      ['Jun 2–3', 'regular'],
      ['Jun 9–10', 'regular'],
      ['Jun 16–17', 'regular'],
      ['Jun 23–24', 'regular'],
      ['Jun 30–Jul 1', 'regular'],
      ['Jul 15', 'regular'],
      ['Sep 2–3', 'postseason'],
      ['Sep 10', 'postseason'],
      ['Sep 24', 'postseason'],
    ]);
  });

  it('treats a game left "scheduled" long after its date as not played', () => {
    expect(s.games.find((g) => g.period.label === 'Jul 15')?.status).toBe('cancelled');
  });

  it('leaves the playoffs unmarked until the season has its single-game final', () => {
    const before = buildPllSeason(
      {
        events: [
          final('1', '2023-06-02T23:00Z', 'ARC', 'ATL'),
          final('2', '2023-06-09T23:00Z', 'ARC', 'ATL'),
        ],
      },
      2023,
      '2023-06-10T00:00:00Z',
    );
    // Too few games for franchises: nothing is kept, and nothing is called a playoff.
    expect(before.games.every((g) => g.gameType !== 'postseason')).toBe(true);
  });
});

describe('weekendLabel', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it('reads like a schedule', () => {
    expect(weekendLabel(d('2025-06-06'), d('2025-06-07'))).toBe('Jun 6–7');
    expect(weekendLabel(d('2025-08-31'), d('2025-09-01'))).toBe('Aug 31–Sep 1');
    expect(weekendLabel(d('2025-09-14'), d('2025-09-14'))).toBe('Sep 14');
  });
});
