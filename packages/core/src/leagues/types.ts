import type { GameType } from '../schema';

/** Static, per-league configuration. Everything league-specific lives here or in adapters. */
export interface LeagueConfig {
  id: string;
  name: string;
  /** How the timeline scrubber steps through a season. */
  timelineUnit: 'week' | 'day';
  /** Labels for SeasonTeam.groups, outermost first. */
  groupLabels: string[];
  /** Whether games can end tied (a tie creates no win edge). */
  tiesPossible: boolean;
  /** Game types counted toward the circle by default. A setting, not a hard-coded rule. */
  defaultGameTypes: GameType[];
  /** Upper bound on teams; graph code supports at most 32. */
  maxTeams: number;
}
