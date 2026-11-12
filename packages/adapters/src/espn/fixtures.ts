// Test helper: builds scoreboard events in ESPN's shape. Not part of the package's exports.

/** A scoreboard event in ESPN's shape, trimmed to the fields the parser reads. */
export function espnEvent(o: {
  id: string;
  date?: string;
  home: [string, number?];
  away: [string, number?];
  name?: string;
  state?: 'pre' | 'in' | 'post';
  completed?: boolean;
  period?: number;
  clock?: string;
}) {
  const status = {
    period: o.period ?? 0,
    displayClock: o.clock ?? '0:00',
    type: {
      name: o.name ?? 'STATUS_SCHEDULED',
      state: o.state ?? 'pre',
      completed: o.completed ?? false,
    },
  };
  const side = (homeAway: string, [abbr, score]: [string, number?]) => ({
    homeAway,
    score: String(score ?? 0),
    team: { abbreviation: abbr },
  });
  return {
    id: o.id,
    date: o.date ?? '2026-11-13T01:15Z',
    status,
    competitions: [
      {
        date: o.date ?? '2026-11-13T01:15Z',
        status,
        competitors: [side('home', o.home), side('away', o.away)],
      },
    ],
  };
}
