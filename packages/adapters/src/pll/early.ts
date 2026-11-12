import { SCHEMA_VERSION, type Game, type GameType, type SeasonData } from '@sports-parity/core';
import { parseCsv } from '../csv';
import { zonedToIso } from '../time';
import { groupWeekends, weekendLabel } from './weekends';
import { pllTeam } from './teams';

/**
 * The PLL's first three seasons (2019-2021), which ESPN doesn't carry. They're complete, so the
 * results live in a curated file in the repo (`data/pll/2019-2021.csv`, transcribed from the
 * Wikipedia season pages and checked against each season's published standings) rather than
 * being fetched. Game types are stated per row, from Wikipedia's own round labels: numbered weeks
 * are the regular season, playoff rounds postseason; 2020 was played entirely as the bubble
 * Championship Series (`tournament`). Exhibitions (the 2019 Draft Pick Game, All-Star games) are
 * left out.
 */
export interface PllEarlyGame {
  season: number;
  /** US Eastern date and 24-hour time. */
  date: string;
  time: string;
  /** Franchise IDs. Sites were neutral (a touring league); "home" is the second-listed team. */
  away: string;
  awayScore: number;
  home: string;
  homeScore: number;
  overtime: boolean;
  type: GameType;
}

const TYPES = new Set<GameType>(['regular', 'postseason', 'tournament']);

export function parsePllEarlyCsv(text: string): PllEarlyGame[] {
  return parseCsv(text).map((r, i) => {
    const type = r.type as GameType;
    if (!TYPES.has(type)) throw new Error(`pll early row ${i + 2}: unknown type ${r.type}`);
    for (const k of ['season', 'date', 'time', 'away', 'away_score', 'home', 'home_score']) {
      if (!r[k]) throw new Error(`pll early row ${i + 2}: missing ${k}`);
    }
    return {
      season: Number(r.season),
      date: r.date!,
      time: r.time!,
      away: r.away!,
      awayScore: Number(r.away_score),
      home: r.home!,
      homeScore: Number(r.home_score),
      overtime: r.overtime === '1',
      type,
    };
  });
}

export function buildPllEarlySeason(
  rows: readonly PllEarlyGame[],
  season: number,
  generatedAt: string,
): SeasonData {
  const games = rows
    .filter((r) => r.season === season)
    .map((r) => ({ ...r, at: zonedToIso(r.date, r.time, 'America/New_York') }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: Game[] = [];
  groupWeekends(games, (g) => g.at).forEach((w, i) => {
    const period = { index: i + 1, label: weekendLabel(w.first, w.last) };
    for (const g of w.games) {
      out.push({
        id: `pll_${g.date.replaceAll('-', '')}_${g.away}_${g.home}`,
        gameType: g.type,
        period,
        scheduledAt: g.at,
        status: 'final',
        home: g.home,
        away: g.away,
        neutralSite: true,
        score: { home: g.homeScore, away: g.awayScore },
        outcome: g.overtime ? 'overtime' : 'regulation',
        sourceIds: {},
      });
    }
  });
  const ids = [...new Set(games.flatMap((g) => [g.home, g.away]))].sort();
  const teams = ids.map((id) => {
    const team = pllTeam(id, season);
    if (!team) throw new Error(`pll ${season}: unknown franchise ${id}`);
    return team;
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    league: 'pll',
    season: String(season),
    generatedAt,
    sources: [
      {
        name: 'wikipedia',
        url: `https://en.wikipedia.org/wiki/${season}_Premier_Lacrosse_League_season`,
        license: 'CC-BY-SA-4.0',
      },
    ],
    teams,
    games: out,
  };
}
