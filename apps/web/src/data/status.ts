import type { SeasonAnalysis, SeasonTeam, Snapshot } from '@sports-parity/core';

export interface StatusText {
  headline: string;
  detail: string;
  tone: 'complete' | 'blocked' | 'progress';
}

const listNames = (names: string[]) => {
  if (names.length <= 2) return names.join(' and ');
  if (names.length <= 4) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
};

/** Plain-language status for the banner (and the ring's text alternative). */
export function describeStatus(
  snapshot: Snapshot,
  teams: readonly SeasonTeam[],
  closedAt: SeasonAnalysis['closedAt'],
): StatusText {
  const n = teams.length;
  if (snapshot.status === 'circle') {
    return {
      headline: 'The circle is complete',
      detail: `All ${n} teams form one loop where each beat the next${closedAt ? `. It closed in ${closedAt.periodLabel}` : ''}.`,
      tone: 'complete',
    };
  }
  const played = (i: number) => {
    const r = snapshot.graph.records[i]!;
    return r.wins + r.losses + r.ties > 0;
  };
  const unbeaten = snapshot.blockers.unbeaten.filter(played).map((i) => teams[i]!.nickname);
  const winless = snapshot.blockers.winless.filter(played).map((i) => teams[i]!.nickname);
  if (unbeaten.length + winless.length > 0) {
    const parts: string[] = [];
    // Team nicknames are plural ("Chargers"), so the verb is always plural.
    if (winless.length) parts.push(`The ${listNames(winless)} haven't won a game`);
    if (unbeaten.length) parts.push(`${parts.length ? 'the' : 'The'} ${listNames(unbeaten)} haven't lost`);
    return {
      headline: 'No circle possible yet',
      detail: `${parts.join(', and ')}. Every team needs at least one win and one loss.`,
      tone: 'blocked',
    };
  }
  if (snapshot.status === 'chain') {
    return {
      headline: 'Almost there',
      detail: `All ${n} teams fit in one chain, but no ordering loops back around yet.`,
      tone: 'progress',
    };
  }
  return {
    headline: 'No circle yet',
    detail: `The longest chain so far links ${snapshot.order.length} of ${n} teams.`,
    tone: 'progress',
  };
}
