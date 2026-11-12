import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSeasonData } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';
import { buildPllEarlySeason, parsePllEarlyCsv } from '@sports-parity/adapters';

const rows = parsePllEarlyCsv(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../data/pll/2019-2021.csv'), 'utf8'),
);

/**
 * Published standings (regular season, or group play for 2020), from the Wikipedia season
 * pages. A typo in the curated file shows up here as a record that doesn't match.
 */
const STANDINGS: Record<number, Record<string, [number, number]>> = {
  2019: { CHA: [7, 3], WHP: [6, 4], ARC: [5, 5], RED: [5, 5], ATL: [5, 5], OUT: [2, 8] },
  2020: {
    WHP: [4, 0],
    OUT: [3, 1],
    ARC: [3, 1],
    RED: [2, 2],
    WAT: [1, 3],
    ATL: [1, 3],
    CHA: [0, 4],
  },
  2021: {
    WAT: [6, 3],
    ATL: [6, 3],
    ARC: [5, 4],
    RED: [5, 4],
    WHP: [5, 4],
    CHA: [4, 5],
    CAN: [3, 6],
    OUT: [2, 7],
  },
};

describe('PLL 2019-2021', () => {
  for (const season of [2019, 2020, 2021]) {
    it(`${season} builds, validates and matches its standings`, () => {
      const data = parseSeasonData(buildPllEarlySeason(rows, season, '2026-11-12T00:00:00Z'));
      // 2020's group play is the first 14 games (each team played 4); the rest is its bracket.
      const counted = data.games.filter((g) => g.gameType === 'regular');
      const games = season === 2020 ? data.games.slice(0, 14) : counted;
      const record: Record<string, [number, number]> = {};
      for (const g of games) {
        const homeWon = g.score!.home > g.score!.away;
        const [w, l] = homeWon ? [g.home, g.away] : [g.away, g.home];
        (record[w] ??= [0, 0])[0]++;
        (record[l] ??= [0, 0])[1]++;
      }
      expect(record).toEqual(STANDINGS[season]);
    });
  }

  it('names teams for their era and keeps the 2019 final', () => {
    const s2019 = buildPllEarlySeason(rows, 2019, '2026-11-12T00:00:00Z');
    expect(s2019.teams.find((t) => t.franchiseId === 'OUT')?.name).toBe('Chrome Lacrosse Club');
    const final = s2019.games.at(-1)!;
    expect([final.away, final.score, final.outcome, final.gameType]).toEqual([
      'WHP',
      { home: 11, away: 12 },
      'overtime',
      'postseason',
    ]);
  });
});
