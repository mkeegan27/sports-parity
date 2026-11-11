import { bits } from './graph/bitset';
import {
  findHamiltonianCycle,
  findHamiltonianPath,
  findLongestPath,
  type SearchOptions,
} from './graph/hamiltonian';
import { stronglyConnectedComponents } from './graph/scc';
import { buildWinGraph, type WinGraph, type WinGraphOptions } from './graph/winGraph';
import type { GameType, SeasonData } from './schema';

/** Where the league stands at one point in the season. Team references are node indices. */
export interface Snapshot {
  /** 'circle': every team in one loop. 'chain': every team in one line, ends not joined yet.
   *  'partial': the longest line found doesn't cover every team. */
  status: 'circle' | 'chain' | 'partial';
  /** Ring order: order[i] beat order[i + 1]. For a circle, the last team also beat the first. */
  order: number[];
  /** False if a search hit its budget, so `order` may not be optimal (never seen on NFL data). */
  exact: boolean;
  /** Teams nobody has beaten yet (no incoming edge) and teams that haven't beaten anyone. */
  blockers: { unbeaten: number[]; winless: number[] };
  /** Strongly connected components as team bitmasks. One component is necessary for a circle. */
  components: number[];
  graph: WinGraph;
}

/** The cheap parts of a snapshot: blockers and components. */
export function summarizeGraph(
  graph: WinGraph,
): Pick<Snapshot, 'blockers' | 'components' | 'graph'> {
  const { out, inn } = graph;
  const blockers = { unbeaten: [] as number[], winless: [] as number[] };
  for (let v = 0; v < out.length; v++) {
    if (inn[v] === 0) blockers.unbeaten.push(v);
    if (out[v] === 0) blockers.winless.push(v);
  }
  return { blockers, components: stronglyConnectedComponents(out), graph };
}

export function analyzeGraph(graph: WinGraph, search: SearchOptions = {}): Snapshot {
  const { out, inn } = graph;
  const base = summarizeGraph(graph);

  const cycle = findHamiltonianCycle(out, inn, search);
  if (cycle.kind === 'found') return { ...base, status: 'circle', order: cycle.order, exact: true };
  const path = findHamiltonianPath(out, inn, search);
  if (path.kind === 'found') {
    return { ...base, status: 'chain', order: path.order, exact: cycle.kind === 'none' };
  }
  const longest = findLongestPath(out, search);
  return {
    ...base,
    status: 'partial',
    order: longest.order,
    exact: longest.exact && cycle.kind === 'none' && path.kind === 'none',
  };
}

/** True if `order` is a valid circle (every team once, each beat the next, last beat first). */
export function isValidCircle(graph: WinGraph, order: readonly number[]): boolean {
  const n = graph.out.length;
  if (order.length !== n || new Set(order).size !== n) return false;
  return order.every((u, i) => ((graph.out[u]! >>> order[(i + 1) % n]!) & 1) === 1);
}

export interface PeriodSnapshot extends Snapshot {
  periodIndex: number;
  periodLabel: string;
}

export interface SeasonAnalysis {
  teams: readonly string[];
  periods: PeriodSnapshot[];
  /** First period in which a circle existed, if any. */
  closedAt: { periodIndex: number; periodLabel: string } | null;
}

export interface SeasonAnalysisOptions extends Omit<WinGraphOptions, 'throughPeriod'> {
  search?: SearchOptions;
}

/**
 * Snapshot every period that has at least one completed counted game. Once a circle forms,
 * it is frozen as the canonical circle for later periods (wins never disappear mid-season),
 * so the hero visual stays stable. If later data invalidates it, a fresh circle is searched.
 */
export function analyzeSeason(season: SeasonData, opts: SeasonAnalysisOptions): SeasonAnalysis {
  const teams = season.teams.map((t) => t.franchiseId);
  const types = new Set<GameType>(opts.gameTypes);
  const periodLabels = new Map<number, string>();
  for (const g of season.games) {
    const counted = g.status === 'final' || opts.overrides?.has(g.id);
    if (types.has(g.gameType) && counted) periodLabels.set(g.period.index, g.period.label);
  }
  const periodIndexes = [...periodLabels.keys()].sort((a, b) => a - b);

  const periods: PeriodSnapshot[] = [];
  let canonical: number[] | null = null;
  let closedAt: SeasonAnalysis['closedAt'] = null;
  for (const periodIndex of periodIndexes) {
    const graph = buildWinGraph(teams, season.games, { ...opts, throughPeriod: periodIndex });
    const periodLabel = periodLabels.get(periodIndex)!;
    let snapshot: Snapshot;
    if (canonical && isValidCircle(graph, canonical)) {
      snapshot = { ...summarizeGraph(graph), status: 'circle', order: canonical, exact: true };
    } else {
      snapshot = analyzeGraph(graph, opts.search);
    }
    if (snapshot.status === 'circle') {
      canonical = snapshot.order;
      closedAt ??= { periodIndex, periodLabel };
    }
    periods.push({ ...snapshot, periodIndex, periodLabel });
  }
  return { teams, periods, closedAt };
}

/** Teams (by index) in the component, for display. */
export const componentMembers = bits;
