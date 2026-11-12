/**
 * Regression test over real NFL history. Needs generated data (`pnpm data:nfl --from 1999`);
 * skipped when it's missing. CI generates it before running tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSeason, isValidCircle, NFL, parseSeasonData } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web/public/data/nfl');
const load = (season: number) =>
  parseSeasonData(JSON.parse(readFileSync(join(dataDir, `${season}.json`), 'utf8')));
const analyses = new Map<number, ReturnType<typeof analyzeSeason>>();
const analyze = (season: number) => {
  if (!analyses.has(season))
    analyses.set(season, analyzeSeason(load(season), { gameTypes: NFL.defaultGameTypes }));
  return analyses.get(season)!;
};

/** Week the regular-season circle first closed (null = never). Cross-checked by the spike. */
const CLOSED_WEEK: Record<number, number | null> = {
  1999: 10,
  2000: 13,
  2001: 17,
  2002: 9,
  2003: 11,
  2004: 15,
  2005: 15,
  2006: 11,
  2007: null,
  2008: null,
  2009: 16,
  2010: 10,
  2011: 15,
  2012: 10,
  2013: 12,
  2014: 12,
  2015: 16,
  2016: 16,
  2017: null,
  2018: 9,
  2019: 13,
  2020: 15,
  2021: 13,
  2022: 10,
  2023: 8,
  2024: 11,
  2025: 8,
};

describe.skipIf(!existsSync(join(dataDir, '1999.json')))(
  'NFL history (1999–2025)',
  { timeout: 30_000 },
  () => {
    for (const [season, week] of Object.entries(CLOSED_WEEK)) {
      it(`${season}: circle ${week ? `closes in week ${week}` : 'never closes'}`, () => {
        const analysis = analyze(Number(season));
        expect(analysis.closedAt?.periodIndex ?? null).toBe(week);
        for (const p of analysis.periods) {
          expect(p.exact).toBe(true);
          expect(new Set(p.order).size).toBe(p.order.length);
          if (p.status === 'circle') expect(isValidCircle(p.graph, p.order)).toBe(true);
        }
        // Once closed, the canonical circle stays frozen for the rest of the season.
        const circles = analysis.periods
          .filter((p) => p.status === 'circle')
          .map((p) => p.order.join());
        expect(new Set(circles).size).toBeLessThanOrEqual(1);
      });
    }

    it('every season without an unbeaten or winless team formed a circle', () => {
      for (const season of Object.keys(CLOSED_WEEK).map(Number)) {
        const last = analyze(season).periods.at(-1)!;
        const blocked = last.blockers.unbeaten.length + last.blockers.winless.length > 0;
        expect(last.status === 'circle').toBe(!blocked);
      }
    });
  },
);
