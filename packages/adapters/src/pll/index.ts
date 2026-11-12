import {
  SCHEMA_VERSION,
  type Game,
  type GameType,
  type SeasonData,
  type SeasonTeam,
} from '@sports-parity/core';
import { parseEspnScoreboard } from '../espn';
import { pllTeam } from './teams';
import { groupWeekends, weekendLabel } from './weekends';

export { groupWeekends, weekendLabel } from './weekends';

export { pllTeam, PLL_FRANCHISE_BY_NICKNAME } from './teams';
export { buildPllEarlySeason, parsePllEarlyCsv, type PllEarlyGame } from './early';

/**
 * PLL seasons from ESPN's scoreboard (2022 onward; earlier seasons aren't there). ESPN labels
 * every game "regular season", so the season's shape decides instead:
 *
 * - Franchises are the teams with a real schedule (5+ games). All-Star sides (EAST, WEST, IZZY,
 *   ...) play one or two games and are dropped, along with their games.
 * - Games are grouped into weekends: a new period starts after a gap of more than 3 days.
 * - Weekends before May are the Championship Series (`tournament`).
 * - Once a season has ended in a single-game final (August or later), its last three weekends
 *   are the playoffs: quarterfinals, semifinals, final. Every season 2022-2026 has that shape.
 */
export const PLL_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/scoreboard';
export const pllSeasonUrl = (season: number) => `${PLL_SCOREBOARD}?dates=${season}&limit=500`;
/** Today's games, by US Eastern day (`YYYYMMDD`). */
export const pllDayUrl = (date: string) => `${PLL_SCOREBOARD}?dates=${date}`;

/** Relocations keep one identity: the Chrome (2022-23) became the Denver Outlaws (2024). */
const FRANCHISE_OF: Record<string, string> = { CHR: 'OUT' };
export const pllFranchiseId = (abbr: string) => FRANCHISE_OF[abbr] ?? abbr;

const MIN_GAMES = 5;
const PLAYOFF_WEEKENDS = 3;
const STALE_MS = 7 * 86_400_000;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Team names and colors as ESPN gives them, by franchise. */
function teamInfo(json: unknown): Map<string, Omit<SeasonTeam, 'groups'>> {
  const out = new Map<string, Omit<SeasonTeam, 'groups'>>();
  const events = isObj(json) && Array.isArray(json.events) ? json.events : [];
  const hex = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : fallback;
  for (const e of events) {
    const comp = isObj(e) && Array.isArray(e.competitions) ? e.competitions[0] : undefined;
    const competitors = isObj(comp) && Array.isArray(comp.competitors) ? comp.competitors : [];
    for (const c of competitors) {
      const t = isObj(c) && isObj(c.team) ? c.team : undefined;
      if (!t || typeof t.abbreviation !== 'string') continue;
      // Later events overwrite earlier ones, so a relocated franchise takes its latest name.
      out.set(pllFranchiseId(t.abbreviation), {
        franchiseId: pllFranchiseId(t.abbreviation),
        abbr: t.abbreviation,
        name: typeof t.displayName === 'string' ? t.displayName : t.abbreviation,
        nickname: typeof t.name === 'string' ? t.name : t.abbreviation,
        colors: { primary: hex(t.color, '#888888'), secondary: hex(t.alternateColor, '#cccccc') },
      });
    }
  }
  return out;
}

/** Build one PLL season from ESPN's season scoreboard payload. */
export function buildPllSeason(json: unknown, season: number, generatedAt: string): SeasonData {
  const all = parseEspnScoreboard(json, pllFranchiseId);
  const count = new Map<string, number>();
  for (const g of all) for (const t of [g.home, g.away]) count.set(t, (count.get(t) ?? 0) + 1);
  const franchises = new Set([...count].filter(([, n]) => n >= MIN_GAMES).map(([t]) => t));
  const games = all
    .filter((g) => franchises.has(g.home) && franchises.has(g.away))
    .sort((a, b) => Date.parse(a.update.scheduledAt) - Date.parse(b.update.scheduledAt));

  const weekends = groupWeekends(games, (g) => g.update.scheduledAt);

  const types: GameType[] = weekends.map((w) =>
    w.first.getUTCMonth() < 4 ? 'tournament' : 'regular',
  );
  const final = weekends.at(-1);
  if (final && final.games.length === 1 && final.first.getUTCMonth() >= 7) {
    let marked = 0;
    for (let i = weekends.length - 1; i >= 0 && marked < PLAYOFF_WEEKENDS; i--) {
      if (types[i] !== 'regular') break;
      types[i] = 'postseason';
      marked++;
    }
  }

  const out: Game[] = [];
  weekends.forEach((w, i) => {
    const period = { index: i + 1, label: weekendLabel(w.first, w.last) };
    for (const g of w.games) {
      const u = g.update;
      const game: Game = {
        id: `pll_${g.espnId}`,
        gameType: types[i]!,
        period,
        scheduledAt: u.scheduledAt,
        // ESPN leaves some games "scheduled" long after their date (five 2024 Championship
        // Series games never got results). A week on, they're treated as not played.
        status:
          u.status === 'scheduled' && Date.parse(generatedAt) - Date.parse(u.scheduledAt) > STALE_MS
            ? 'cancelled'
            : u.status,
        home: g.home,
        away: g.away,
        neutralSite: false,
        sourceIds: { espn: g.espnId },
      };
      if (u.score && (u.status === 'final' || u.status === 'in_progress')) game.score = u.score;
      if (u.status === 'final' && u.outcome) game.outcome = u.outcome;
      if (u.status === 'in_progress' && u.live) game.live = u.live;
      out.push(game);
    }
  });

  // Names and colors from the curated table (ESPN's are today's names, or missing); ESPN's only
  // for a franchise we don't know yet.
  const info = teamInfo(json);
  const teams: SeasonTeam[] = [...franchises].sort().map(
    (id) =>
      pllTeam(id, season) ?? {
        ...(info.get(id) ?? {
          franchiseId: id,
          abbr: id,
          name: id,
          nickname: id,
          colors: { primary: '#888888', secondary: '#cccccc' },
        }),
        groups: [],
      },
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    league: 'pll',
    season: String(season),
    generatedAt,
    sources: [{ name: 'espn', url: 'https://www.espn.com/pll/' }],
    teams,
    games: out,
  };
}
