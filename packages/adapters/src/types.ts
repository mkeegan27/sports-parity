import type { Game, SeasonTeam } from '@sports-parity/core';

/** Fetches text from a URL. Injected so adapters can be tested and responses cached. */
export type FetchText = (url: string) => Promise<string>;

export const defaultFetchText: FetchText = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.text();
};

export interface AdapterCapabilities {
  /** Can report in-progress games with live scores. */
  live: boolean;
  /** Seasons this source covers (inclusive). `to` omitted = current. */
  seasons: { from: number; to?: number };
}

/**
 * One data source for one league. Each method returns normalized records; a reconciler
 * (added with the second source) merges several adapters by mapping their game IDs.
 */
export interface SourceAdapter {
  readonly source: { name: string; url: string; license?: string };
  readonly league: string;
  readonly capabilities: AdapterCapabilities;
  fetchTeams(season: number): Promise<SeasonTeam[]>;
  fetchSchedule(season: number): Promise<Game[]>;
  /** Completed (and, where supported, in-progress) games, optionally only those changed since a time. */
  fetchResults(season: number, since?: Date): Promise<Game[]>;
  fetchLive?(): Promise<Game[]>;
}
