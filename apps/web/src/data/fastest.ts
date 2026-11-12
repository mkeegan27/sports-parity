import {
  buildWinGraph,
  equallyFastWays,
  fastestPath,
  type FastestPath,
  type GameType,
  type NeededResult,
  type PendingGame,
  type SeasonData,
} from '@sports-parity/core';

/** The question the path worker answers for one season's data. */
export interface PathRequest {
  id: number;
  season: SeasonData;
  gameTypes: GameType[];
}

export type PathReply =
  | { id: number; kind: 'best'; path: FastestPath | null; ms: number }
  | { id: number; kind: 'ways'; ways: NeededResult[][]; complete: boolean; ms: number };

/** Most results the banner lists other ways for; beyond this it just gives the count. */
export const WAYS_UP_TO = 3;

/**
 * Played wins and still-open games for a season, in the shape the search takes. Games in
 * progress count as open: until the final, either team can win.
 */
export function pathInputs(season: SeasonData, gameTypes: readonly GameType[]) {
  const teams = season.teams.map((t) => t.franchiseId);
  const index = new Map(teams.map((t, i) => [t, i]));
  const types = new Set(gameTypes);
  const fixed = buildWinGraph(teams, season.games, { gameTypes }).out;
  const pending: PendingGame[] = [];
  for (const g of season.games) {
    if (!types.has(g.gameType) || g.status === 'final' || g.status === 'cancelled') continue;
    const home = index.get(g.home);
    const away = index.get(g.away);
    if (home === undefined || away === undefined) continue;
    pending.push({ gameId: g.id, home, away, periodIndex: g.period.index });
  }
  return { n: teams.length, fixed, pending };
}

/** Run the search, reporting the best path first and the other ways after. */
export function answer(req: PathRequest, post: (reply: PathReply) => void): void {
  const { n, fixed, pending } = pathInputs(req.season, req.gameTypes);
  const t0 = performance.now();
  const path = fastestPath(n, fixed, pending);
  const t1 = performance.now();
  post({ id: req.id, kind: 'best', path, ms: t1 - t0 });
  if (!path || path.needed.length === 0 || path.needed.length > WAYS_UP_TO) return;
  const { ways, complete } = equallyFastWays(n, fixed, pending, path);
  post({ id: req.id, kind: 'ways', ways, complete, ms: performance.now() - t1 });
}
