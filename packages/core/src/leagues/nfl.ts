import type { LeagueConfig } from './types';

export const NFL: LeagueConfig = {
  id: 'nfl',
  name: 'Pro Football',
  timelineUnit: 'week',
  groupLabels: ['Conference', 'Division'],
  tiesPossible: true,
  defaultGameTypes: ['regular'],
  maxTeams: 32,
};
