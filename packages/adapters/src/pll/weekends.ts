/** Weekend grouping and labels, shared by the ESPN and curated PLL seasons. */

const WEEKEND_GAP_DAYS = 3;
/** Longest span still treated as one weekend (Thursday to Monday). */
const MAX_WEEKEND_DAYS = 4;
const DAY_MS = 86_400_000;

const EASTERN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** The US Eastern calendar day as a UTC-midnight Date, for day arithmetic and labels. */
function easternDay(iso: string): Date {
  const parts = Object.fromEntries(
    EASTERN.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
/** "Jun 4–5", "Aug 31–Sep 1", or "Sep 3" for a one-day weekend. */
export function weekendLabel(first: Date, last: Date): string {
  const m1 = MONTH.format(first);
  const m2 = MONTH.format(last);
  const d1 = first.getUTCDate();
  const d2 = last.getUTCDate();
  if (first.getTime() === last.getTime()) return `${m1} ${d1}`;
  return m1 === m2 ? `${m1} ${d1}–${d2}` : `${m1} ${d1}–${m2} ${d2}`;
}

/** Games grouped into weekends: a new one starts after a gap of more than 3 days (US Eastern). */
export function groupWeekends<T>(items: readonly T[], at: (item: T) => string) {
  type Group = { games: T[]; first: Date; last: Date };
  const groups: Group[] = [];
  for (const g of items) {
    const day = easternDay(at(g));
    const current = groups.at(-1);
    if (current && (day.getTime() - current.last.getTime()) / DAY_MS <= WEEKEND_GAP_DAYS) {
      current.games.push(g);
      current.last = day;
    } else {
      groups.push({ games: [g], first: day, last: day });
    }
  }
  // A run of games longer than a weekend (the 2020 bubble, a week-long Championship Series)
  // steps by day instead, so it doesn't collapse into one step.
  return groups.flatMap((w) => {
    if ((w.last.getTime() - w.first.getTime()) / DAY_MS <= MAX_WEEKEND_DAYS) return [w];
    const days: Group[] = [];
    for (const g of w.games) {
      const day = easternDay(at(g));
      const current = days.at(-1);
      if (current && current.first.getTime() === day.getTime()) current.games.push(g);
      else days.push({ games: [g], first: day, last: day });
    }
    return days;
  });
}
