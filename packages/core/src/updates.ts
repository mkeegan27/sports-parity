import type { Game, GameStatus, OutcomeDetail, SeasonData } from './schema';

/**
 * What a live source may change on a game the season file already has: its status, kickoff
 * time, score and live clock. Teams, IDs and periods stay as the baseline source has them.
 */
export interface GameUpdate {
  status: GameStatus;
  scheduledAt: string;
  score?: { home: number; away: number };
  outcome?: OutcomeDetail;
  live?: { period: string; clock?: string };
}

/** Updates from one source, keyed by that source's game ID (`game.sourceIds[source]`). */
export type GameUpdates = Record<string, GameUpdate>;

/**
 * The game with an update applied. A final result is never taken back to an earlier status
 * (sources occasionally flicker), and a kickoff time naming the same instant keeps the
 * baseline's spelling, so re-reporting it isn't a change.
 */
export function applyGameUpdate(game: Game, update: GameUpdate): Game {
  if (game.status === 'final' && update.status !== 'final') return game;
  const sameInstant = Date.parse(game.scheduledAt) === Date.parse(update.scheduledAt);
  const next: Game = {
    id: game.id,
    gameType: game.gameType,
    period: game.period,
    scheduledAt: sameInstant ? game.scheduledAt : update.scheduledAt,
    status: update.status,
    home: game.home,
    away: game.away,
    neutralSite: game.neutralSite,
    sourceIds: game.sourceIds,
  };
  if ((update.status === 'in_progress' || update.status === 'final') && update.score) {
    next.score = update.score;
  }
  if (update.status === 'final' && update.outcome) next.outcome = update.outcome;
  if (update.status === 'in_progress' && update.live) next.live = update.live;
  return next;
}

/** True when two games carry the same facts (key order aside). */
export function sameGame(a: Game, b: Game): boolean {
  return (
    a.status === b.status &&
    Date.parse(a.scheduledAt) === Date.parse(b.scheduledAt) &&
    a.score?.home === b.score?.home &&
    a.score?.away === b.score?.away &&
    a.outcome === b.outcome &&
    a.live?.period === b.live?.period &&
    a.live?.clock === b.live?.clock
  );
}

/** The season with every update from `source` applied. Updates for unknown games are ignored. */
export function applyUpdates(season: SeasonData, source: string, updates: GameUpdates): SeasonData {
  let touched = false;
  const games = season.games.map((g) => {
    const id = g.sourceIds[source];
    const update = id === undefined ? undefined : updates[id];
    if (!update) return g;
    touched = true;
    return applyGameUpdate(g, update);
  });
  return touched ? { ...season, games } : season;
}
