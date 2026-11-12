import type { SeasonTeam } from '@sports-parity/core';

/**
 * PLL franchises by era. Clubs were tour-based "Lacrosse Clubs" through 2023 and took cities in
 * 2024; ESPN shows today's names for every season (and none at all for some 2022 teams), so
 * names and colors come from here. The Chrome became the Denver Outlaws in 2024: one franchise.
 */
interface Era {
  from: number;
  abbr: string;
  name: string;
  nickname: string;
  primary: string;
  secondary: string;
}

const FRANCHISES: Record<string, Era[]> = {
  ARC: [
    {
      from: 2019,
      abbr: 'ARC',
      name: 'Archers Lacrosse Club',
      nickname: 'Archers',
      primary: '#072442',
      secondary: '#ff5216',
    },
    {
      from: 2024,
      abbr: 'ARC',
      name: 'Utah Archers',
      nickname: 'Archers',
      primary: '#072442',
      secondary: '#ff5216',
    },
  ],
  ATL: [
    {
      from: 2019,
      abbr: 'ATL',
      name: 'Atlas Lacrosse Club',
      nickname: 'Atlas',
      primary: '#011e41',
      secondary: '#00b1ff',
    },
    {
      from: 2024,
      abbr: 'ATL',
      name: 'New York Atlas',
      nickname: 'Atlas',
      primary: '#011e41',
      secondary: '#00b1ff',
    },
  ],
  CAN: [
    {
      from: 2021,
      abbr: 'CAN',
      name: 'Cannons Lacrosse Club',
      nickname: 'Cannons',
      primary: '#011e41',
      secondary: '#c62030',
    },
    {
      from: 2024,
      abbr: 'CAN',
      name: 'Boston Cannons',
      nickname: 'Cannons',
      primary: '#011e41',
      secondary: '#c62030',
    },
  ],
  CHA: [
    {
      from: 2019,
      abbr: 'CHA',
      name: 'Chaos Lacrosse Club',
      nickname: 'Chaos',
      primary: '#ff0000',
      secondary: '#000000',
    },
    {
      from: 2024,
      abbr: 'CHA',
      name: 'Carolina Chaos',
      nickname: 'Chaos',
      primary: '#ff0000',
      secondary: '#000000',
    },
  ],
  OUT: [
    {
      from: 2019,
      abbr: 'CHR',
      name: 'Chrome Lacrosse Club',
      nickname: 'Chrome',
      primary: '#4b5563',
      secondary: '#c0c0c0',
    },
    {
      from: 2024,
      abbr: 'OUT',
      name: 'Denver Outlaws',
      nickname: 'Outlaws',
      primary: '#ff4d00',
      secondary: '#b3b3b3',
    },
  ],
  RED: [
    {
      from: 2019,
      abbr: 'RED',
      name: 'Redwoods Lacrosse Club',
      nickname: 'Redwoods',
      primary: '#004b37',
      secondary: '#ffce00',
    },
    {
      from: 2024,
      abbr: 'RED',
      name: 'California Redwoods',
      nickname: 'Redwoods',
      primary: '#004b37',
      secondary: '#ffce00',
    },
  ],
  WAT: [
    {
      from: 2020,
      abbr: 'WAT',
      name: 'Waterdogs Lacrosse Club',
      nickname: 'Waterdogs',
      primary: '#000000',
      secondary: '#6c20c4',
    },
    {
      from: 2024,
      abbr: 'WAT',
      name: 'Philadelphia Waterdogs',
      nickname: 'Waterdogs',
      primary: '#000000',
      secondary: '#6c20c4',
    },
  ],
  WHP: [
    {
      from: 2019,
      abbr: 'WHP',
      name: 'Whipsnakes Lacrosse Club',
      nickname: 'Whipsnakes',
      primary: '#ff0000',
      secondary: '#000000',
    },
    {
      from: 2024,
      abbr: 'WHP',
      name: 'Maryland Whipsnakes',
      nickname: 'Whipsnakes',
      primary: '#ff0000',
      secondary: '#000000',
    },
  ],
};

/** A franchise as it was in a season, or null if we don't know it. */
export function pllTeam(franchiseId: string, season: number): SeasonTeam | null {
  const eras = FRANCHISES[franchiseId];
  const era = eras?.filter((e) => e.from <= season).at(-1);
  if (!era) return null;
  return {
    franchiseId,
    abbr: era.abbr,
    name: era.name,
    nickname: era.nickname,
    colors: { primary: era.primary, secondary: era.secondary },
    groups: [],
  };
}

/** Wikipedia's club names ("Archers") to franchise IDs. */
export const PLL_FRANCHISE_BY_NICKNAME: Record<string, string> = {
  Archers: 'ARC',
  Atlas: 'ATL',
  Cannons: 'CAN',
  Chaos: 'CHA',
  Chrome: 'OUT',
  Redwoods: 'RED',
  Waterdogs: 'WAT',
  Whipsnakes: 'WHP',
};
