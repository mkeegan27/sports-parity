import {
  applyGameUpdate,
  GameSchema,
  sameGame,
  type Game,
  type GameUpdate,
  type GameUpdates,
  type SeasonData,
} from '@sports-parity/core';
import { nflFranchiseId } from '../nflverse';

/**
 * ESPN's public scoreboard JSON: unofficial, keyless, and fresh within seconds. Used for
 * current-season results on top of the nflverse baseline. Games are matched by the ESPN ID
 * nflverse already records, so team abbreviations are only a cross-check.
 */
export const ESPN_SOURCE = 'espn';
export const ESPN_NFL_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** One day's games (`YYYYMMDD`, US Eastern), or the current week's with no date. */
export const espnScoreboardUrl = (date?: string) =>
  date ? `${ESPN_NFL_SCOREBOARD}?dates=${date}` : ESPN_NFL_SCOREBOARD;

const EASTERN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** ESPN's `dates` parameter for the US Eastern calendar day containing `at`. */
export const espnDate = (at: Date): string => EASTERN_DAY.format(at).replaceAll('-', '');

/** ESPN abbreviations that differ from nflverse's. */
const FROM_ESPN: Record<string, string> = { WSH: 'WAS', LAR: 'LA' };
export const franchiseFromEspn = (abbr: string) => nflFranchiseId(FROM_ESPN[abbr] ?? abbr);

/** A game as ESPN reports it: its ID, the two teams (as franchise IDs) and the new facts. */
export interface EspnGame {
  espnId: string;
  home: string;
  away: string;
  update: GameUpdate;
}

type Json = Record<string, unknown>;
const obj = (v: unknown, what: string): Json => {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new Error(`espn: ${what} is not an object`);
  return v as Json;
};
const arr = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`espn: ${what} is not an array`);
  return v;
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`espn: ${what} is not a string`);
  return v;
};

const quarter = (period: number, statusName: string): string => {
  if (statusName === 'STATUS_HALFTIME') return 'Half';
  const label = period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `${period - 4}OT`;
  return statusName === 'STATUS_END_PERIOD' ? `End ${label}` : label;
};

/**
 * Parse a scoreboard payload. Checks only the fields it reads, by hand rather than with a
 * schema, to stay inside a free Worker's CPU budget. Throws if the shape is wrong; events in a
 * state we don't model (suspended, say) are skipped.
 */
export function parseEspnScoreboard(
  json: unknown,
  /** ESPN abbreviation -> our franchise ID; the NFL's by default. */
  teamOf: (abbr: string) => string = franchiseFromEspn,
): EspnGame[] {
  const out: EspnGame[] = [];
  for (const [i, raw] of arr(obj(json, 'payload').events, 'events').entries()) {
    const event = obj(raw, `events[${i}]`);
    const espnId = str(event.id, `events[${i}].id`);
    const comp = obj(
      arr(event.competitions, `event ${espnId} competitions`)[0],
      `event ${espnId} competition`,
    );
    const status = obj(comp.status ?? event.status, `event ${espnId} status`);
    const type = obj(status.type, `event ${espnId} status.type`);
    const name = str(type.name, `event ${espnId} status name`);
    const state = str(type.state, `event ${espnId} status state`);
    const period = typeof status.period === 'number' ? status.period : 0;

    const sides: Record<string, { team: string; score: number }> = {};
    for (const c of arr(comp.competitors, `event ${espnId} competitors`)) {
      const competitor = obj(c, `event ${espnId} competitor`);
      const side = str(competitor.homeAway, `event ${espnId} homeAway`);
      const abbr = str(
        obj(competitor.team, `event ${espnId} team`).abbreviation,
        `event ${espnId} abbreviation`,
      );
      const score = Number(competitor.score ?? 0);
      sides[side] = { team: teamOf(abbr), score: Number.isFinite(score) ? score : 0 };
    }
    const home = sides.home;
    const away = sides.away;
    if (!home || !away) throw new Error(`espn: event ${espnId} lacks a home or away team`);

    const scheduledAt = new Date(str(comp.date ?? event.date, `event ${espnId} date`));
    if (Number.isNaN(scheduledAt.getTime()))
      throw new Error(`espn: event ${espnId} has a bad date`);
    const base = { scheduledAt: scheduledAt.toISOString() };
    const score = { home: home.score, away: away.score };

    let update: GameUpdate;
    if (name === 'STATUS_POSTPONED') update = { ...base, status: 'postponed' };
    else if (name === 'STATUS_CANCELED' || name === 'STATUS_CANCELLED')
      update = { ...base, status: 'cancelled' };
    else if (state === 'pre') update = { ...base, status: 'scheduled' };
    else if (state === 'in') {
      const clock = typeof status.displayClock === 'string' ? status.displayClock : undefined;
      update = {
        ...base,
        status: 'in_progress',
        score,
        live: { period: quarter(period, name), ...(clock !== undefined ? { clock } : {}) },
      };
    } else if (state === 'post' && type.completed === true) {
      update = { ...base, status: 'final', score, outcome: period > 4 ? 'overtime' : 'regulation' };
    } else continue;

    out.push({ espnId, home: home.team, away: away.team, update });
  }
  return out;
}

/** The result of laying ESPN's games over a season. */
export interface Reconciled {
  /** Updates to keep, keyed by ESPN ID. */
  updates: GameUpdates;
  /** Games whose facts changed. */
  changed: Game[];
  /** ESPN games that couldn't be applied, with the reason. */
  rejected: { espnId: string; reason: string }[];
}

/**
 * Match ESPN's games to the season's by ESPN ID and turn them into updates. A game whose teams
 * don't match is rejected; one with home and away the other way round (a neutral-site game,
 * say) has its score flipped. Each changed game is validated against the schema on its own,
 * which costs far less than revalidating the whole season.
 */
export function reconcileEspn(season: SeasonData, games: readonly EspnGame[]): Reconciled {
  const byEspn = new Map<string, Game>();
  for (const g of season.games) {
    const id = g.sourceIds[ESPN_SOURCE];
    if (id) byEspn.set(id, g);
  }
  const result: Reconciled = { updates: {}, changed: [], rejected: [] };
  for (const e of games) {
    const game = byEspn.get(e.espnId);
    if (!game) {
      result.rejected.push({ espnId: e.espnId, reason: 'not in the season file' });
      continue;
    }
    let update = e.update;
    if (e.home === game.away && e.away === game.home) {
      if (update.score)
        update = { ...update, score: { home: update.score.away, away: update.score.home } };
    } else if (e.home !== game.home || e.away !== game.away) {
      result.rejected.push({
        espnId: e.espnId,
        reason: `teams ${e.away}@${e.home} don't match ${game.away}@${game.home}`,
      });
      continue;
    }
    const next = applyGameUpdate(game, update);
    const valid = GameSchema.safeParse(next);
    if (!valid.success) {
      result.rejected.push({
        espnId: e.espnId,
        reason: valid.error.issues[0]?.message ?? 'invalid',
      });
      continue;
    }
    result.updates[e.espnId] = update;
    if (!sameGame(game, next)) result.changed.push(next);
  }
  return result;
}
