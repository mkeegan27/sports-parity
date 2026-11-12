import {
  espnScoreboardUrl,
  franchiseFromEspn,
  PLL_SCOREBOARD,
  pllDayUrl,
  pllFranchiseId,
} from '@sports-parity/adapters';

/** A league with live results: where its scoreboard is and how ESPN names its teams. */
export interface LiveLeague {
  id: string;
  /** One day's games (`YYYYMMDD`, US Eastern), or the current slate with no date. */
  scoreboard: (date?: string) => string;
  teamOf: (abbr: string) => string;
}

export const LIVE_LEAGUES: readonly LiveLeague[] = [
  { id: 'nfl', scoreboard: espnScoreboardUrl, teamOf: franchiseFromEspn },
  {
    id: 'pll',
    scoreboard: (date) => (date ? pllDayUrl(date) : PLL_SCOREBOARD),
    teamOf: pllFranchiseId,
  },
];
