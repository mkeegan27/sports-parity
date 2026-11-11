import type { Game, GameType, SeasonTeam } from '@sports-parity/core';
import { parseCsv } from '../csv';
import { zonedToIso } from '../time';
import { defaultFetchText, type FetchText, type SourceAdapter } from '../types';

export const NFLVERSE_GAMES_URL =
  'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
export const NFLVERSE_TEAMS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv';

/**
 * Historical abbreviations -> stable franchise ID (the franchise's current abbreviation),
 * so relocations keep one identity across seasons.
 */
const FRANCHISE_OF: Record<string, string> = { OAK: 'LV', SD: 'LAC', STL: 'LA' };
export const nflFranchiseId = (abbr: string): string => FRANCHISE_OF[abbr] ?? abbr;

const GAME_TYPE: Record<string, GameType> = {
  REG: 'regular',
  WC: 'postseason',
  DIV: 'postseason',
  CON: 'postseason',
  SB: 'postseason',
};
const POSTSEASON_LABEL: Record<string, string> = {
  WC: 'Wild Card',
  DIV: 'Divisional',
  CON: 'Conference',
  SB: 'Championship',
};

/** Normalize "#a5acaf" / "#A5ACAF" to lowercase 6-digit hex; fall back for blanks. */
const hex = (value: string | undefined, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value ?? '') ? value!.toLowerCase() : fallback;

/** nflverse: free, open NFL data (schedules and results back to 1999). Updates within about a day. */
export class NflverseAdapter implements SourceAdapter {
  readonly source = { name: 'nflverse', url: 'https://github.com/nflverse', license: 'CC-BY-4.0' };
  readonly league = 'nfl';
  readonly capabilities = { live: false, seasons: { from: 1999 } };

  private gamesCsv?: Promise<Record<string, string>[]>;
  private teamsCsv?: Promise<Record<string, string>[]>;

  constructor(private readonly fetchText: FetchText = defaultFetchText) {}

  private games() {
    return (this.gamesCsv ??= this.fetchText(NFLVERSE_GAMES_URL).then(parseCsv));
  }

  private teamRows() {
    return (this.teamsCsv ??= this.fetchText(NFLVERSE_TEAMS_URL).then(parseCsv));
  }

  async fetchTeams(season: number): Promise<SeasonTeam[]> {
    const [games, teamRows] = await Promise.all([this.games(), this.teamRows()]);
    const abbrs = new Set(
      games.filter((r) => Number(r.season) === season).flatMap((r) => [r.home_team!, r.away_team!]),
    );
    const byAbbr = new Map(teamRows.map((r) => [r.team_abbr!, r]));
    return [...abbrs].sort().map((abbr) => {
      const row = byAbbr.get(abbr);
      if (!row) throw new Error(`nflverse: no team metadata for ${abbr}`);
      return {
        franchiseId: nflFranchiseId(abbr),
        abbr,
        name: row.team_name!,
        nickname: row.team_nick!,
        colors: {
          primary: hex(row.team_color, '#888888'),
          secondary: hex(row.team_color2, '#cccccc'),
        },
        // Note: current conference/division labels; pre-2002 alignment differs (corrections TODO).
        groups: [row.team_conf!, row.team_division!],
      };
    });
  }

  async fetchSchedule(season: number): Promise<Game[]> {
    const games = await this.games();
    return games.filter((r) => Number(r.season) === season).map(toGame);
  }

  async fetchResults(season: number): Promise<Game[]> {
    return (await this.fetchSchedule(season)).filter((g) => g.status === 'final');
  }
}

function toGame(r: Record<string, string>): Game {
  const type = r.game_type!;
  const gameType = GAME_TYPE[type];
  if (!gameType) throw new Error(`nflverse: unknown game_type ${type} in ${r.game_id}`);
  const week = Number(r.week);
  const final = r.home_score !== '' && r.away_score !== '';
  const sourceIds: Record<string, string> = { nflverse: r.game_id! };
  if (r.espn) sourceIds.espn = r.espn;
  return {
    id: r.game_id!,
    gameType,
    period: {
      index: week,
      label: type === 'REG' ? `Week ${week}` : (POSTSEASON_LABEL[type] ?? type),
    },
    scheduledAt: zonedToIso(r.gameday!, r.gametime || '13:00', 'America/New_York'),
    status: final ? 'final' : 'scheduled',
    home: nflFranchiseId(r.home_team!),
    away: nflFranchiseId(r.away_team!),
    neutralSite: r.location === 'Neutral',
    ...(final
      ? {
          score: { home: Number(r.home_score), away: Number(r.away_score) },
          outcome: r.overtime === '1' ? ('overtime' as const) : ('regulation' as const),
        }
      : {}),
    sourceIds,
  };
}
