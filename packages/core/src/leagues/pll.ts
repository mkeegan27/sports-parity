import type { LeagueConfig } from './types';

/** Premier Lacrosse League: 8 teams, a summer season played in weekend clusters. */
export const PLL: LeagueConfig = {
  id: 'pll',
  name: 'Premier Lacrosse League',
  timelineUnit: 'week',
  groupLabels: [],
  tiesPossible: false,
  defaultGameTypes: ['regular'],
  optionalGameTypes: [
    { type: 'postseason', label: 'Playoffs' },
    { type: 'tournament', label: 'Championship Series' },
  ],
  maxTeams: 8,
};
