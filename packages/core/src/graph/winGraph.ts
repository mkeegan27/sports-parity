import type { Game, GameType } from '../schema';
import { MAX_NODES, bit } from './bitset';

/** One win: `winner` beat `loser` in `gameId`. `simulated` marks a scenario override. */
export interface WinEdge {
  winner: number;
  loser: number;
  gameId: string;
  simulated: boolean;
}

/** Directed "who beat whom" graph over a fixed team list. Node index = position in `teams`. */
export interface WinGraph {
  teams: readonly string[];
  /** out[u]: set of teams u beat. */
  out: Uint32Array;
  /** inn[v]: set of teams that beat v. */
  inn: Uint32Array;
  edges: WinEdge[];
  /** Per-team record over the counted games. */
  records: { wins: number; losses: number; ties: number }[];
}

export interface WinGraphOptions {
  /** Which game types count (e.g. regular season only). */
  gameTypes: readonly GameType[];
  /** Only count games with period.index <= this (inclusive). Omit for all. */
  throughPeriod?: number;
  /**
   * Scenario overrides: gameId -> winning franchiseId. Applies to any game, played or not,
   * and replaces the real result. This is the seam for what-ifs and counterfactuals.
   */
  overrides?: ReadonlyMap<string, string>;
}

export function buildWinGraph(
  teams: readonly string[],
  games: readonly Game[],
  opts: WinGraphOptions,
): WinGraph {
  if (teams.length > MAX_NODES) throw new RangeError(`at most ${MAX_NODES} teams supported`);
  const index = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const out = new Uint32Array(n);
  const inn = new Uint32Array(n);
  const edges: WinEdge[] = [];
  const records = teams.map(() => ({ wins: 0, losses: 0, ties: 0 }));
  const types = new Set(opts.gameTypes);

  for (const g of games) {
    if (!types.has(g.gameType)) continue;
    if (opts.throughPeriod !== undefined && g.period.index > opts.throughPeriod) continue;
    if (g.status === 'cancelled') continue;
    const h = index.get(g.home);
    const a = index.get(g.away);
    if (h === undefined || a === undefined) continue;

    const override = opts.overrides?.get(g.id);
    let winner: number | undefined;
    let loser: number | undefined;
    let simulated = false;
    if (override !== undefined) {
      if (override === g.home) [winner, loser] = [h, a];
      else if (override === g.away) [winner, loser] = [a, h];
      else continue;
      simulated = true;
    } else {
      if (g.status !== 'final' || !g.score) continue;
      if (g.score.home === g.score.away) {
        records[h]!.ties++;
        records[a]!.ties++;
        continue; // a tie creates no win edge
      }
      [winner, loser] = g.score.home > g.score.away ? [h, a] : [a, h];
    }
    out[winner] = (out[winner]! | bit(loser)) >>> 0;
    inn[loser] = (inn[loser]! | bit(winner)) >>> 0;
    records[winner]!.wins++;
    records[loser]!.losses++;
    edges.push({ winner, loser, gameId: g.id, simulated });
  }
  return { teams, out, inn, edges, records };
}
