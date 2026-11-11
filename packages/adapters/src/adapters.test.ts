import { parseSeasonData, SCHEMA_VERSION } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { NflverseAdapter, NFLVERSE_GAMES_URL } from './nflverse';
import { zonedToIso } from './time';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', c: 'say "hi"' },
      { a: '2', b: '', c: '' },
    ]);
  });
});

describe('zonedToIso', () => {
  it('uses daylight and standard offsets for US Eastern', () => {
    expect(zonedToIso('2026-09-10', '20:20', 'America/New_York')).toBe('2026-09-10T20:20:00-04:00');
    expect(zonedToIso('2026-11-16', '20:15', 'America/New_York')).toBe('2026-11-16T20:15:00-05:00');
  });
});

const GAMES = `game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location,overtime,espn
2015_01_PIT_NE,2015,REG,1,2015-09-10,20:30,PIT,21,NE,28,Home,0,400791493
2015_02_SD_CIN,2015,REG,2,2015-09-20,13:00,SD,19,CIN,24,Home,0,400791500
2015_03_STL_PIT,2015,REG,3,2015-09-27,13:00,STL,6,PIT,12,Home,1,
2015_20_NE_DEN,2015,CON,20,2016-01-24,15:05,NE,18,DEN,20,Home,0,
2015_21_X,2015,SB,21,2016-02-07,18:30,CIN,,NE,,Neutral,,
`;
const TEAMS = `team_abbr,team_name,team_nick,team_conf,team_division,team_color,team_color2
NE,New England Patriots,Patriots,AFC,AFC East,#002244,#c60c30
PIT,Pittsburgh Steelers,Steelers,AFC,AFC North,#FFB612,#101820
SD,San Diego Chargers,Chargers,AFC,AFC West,#0073cf,#ffb612
CIN,Cincinnati Bengals,Bengals,AFC,AFC North,#fb4f14,#000000
STL,St. Louis Rams,Rams,NFC,NFC West,#002244,#b3995d
DEN,Denver Broncos,Broncos,AFC,AFC West,#002244,#fb4f14
`;

describe('NflverseAdapter', () => {
  const adapter = new NflverseAdapter(async (url) => (url === NFLVERSE_GAMES_URL ? GAMES : TEAMS));

  it('maps relocated teams to stable franchise IDs and keeps season names', async () => {
    const teams = await adapter.fetchTeams(2015);
    const sd = teams.find((t) => t.abbr === 'SD');
    expect(sd).toMatchObject({
      franchiseId: 'LAC',
      name: 'San Diego Chargers',
      colors: { primary: '#0073cf' },
    });
    expect(teams.find((t) => t.abbr === 'PIT')!.colors.primary).toBe('#ffb612');
  });

  it('normalizes games, game types, labels and status', async () => {
    const games = await adapter.fetchSchedule(2015);
    expect(games[1]).toMatchObject({ away: 'LAC', status: 'final', score: { home: 24, away: 19 } });
    expect(games[2]).toMatchObject({
      away: 'LA',
      outcome: 'overtime',
      sourceIds: { nflverse: '2015_03_STL_PIT' },
    });
    expect(games[3]).toMatchObject({
      gameType: 'postseason',
      period: { index: 20, label: 'Conference' },
    });
    expect(games[4]).toMatchObject({ status: 'scheduled', neutralSite: true });
    expect(games[4]!.score).toBeUndefined();
    expect((await adapter.fetchResults(2015)).length).toBe(4);
  });

  it('produces output that passes the season schema', async () => {
    const [teams, games] = await Promise.all([
      adapter.fetchTeams(2015),
      adapter.fetchSchedule(2015),
    ]);
    expect(() =>
      parseSeasonData({
        schemaVersion: SCHEMA_VERSION,
        league: 'nfl',
        season: '2015',
        generatedAt: new Date().toISOString(),
        sources: [adapter.source],
        teams,
        games,
      }),
    ).not.toThrow();
  });
});
