import type { Game, NeededResult, SeasonTeam } from '@sports-parity/core';
import { useEffect, useState } from 'react';
import type { PathState } from '../data/usePath';
import styles from './PathBanner.module.css';

/** Name the needed games when this many or fewer are needed (round 11 #2). */
const NAME_UP_TO = 3;

interface Props {
  state: PathState;
  teams: readonly SeasonTeam[];
  games: ReadonlyMap<string, Game>;
  periodLabel: (periodIndex: number) => string;
  /** The period the season is up to; a path closing in the next one closes "this week". */
  latestPeriod: number;
  previewing: boolean;
  onPreview: () => void;
  /** 'banner' under the status card (phones), 'panel' in the side column (desktop). */
  variant?: 'banner' | 'panel';
}

const DAY = 86_400_000;

/** "Mon 8:15 PM" within the week, "Nov 30" further out. */
export function kickoff(iso: string, now: number): string {
  const at = Date.parse(iso);
  const near = at - now < 6 * DAY;
  return new Intl.DateTimeFormat(
    undefined,
    near
      ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric' },
  ).format(at);
}

const ORDINAL: Record<string, string> = { Q1: '1st', Q2: '2nd', Q3: '3rd', Q4: '4th' };
/** "in the 3rd", "at halftime", "after the 1st", "in overtime". */
const inPeriod = (period: string) => {
  if (period === 'Half') return 'at halftime';
  const end = period.startsWith('End ');
  const p = end ? period.slice(4) : period;
  const name = ORDINAL[p] ? `the ${ORDINAL[p]}` : p === 'OT' ? 'overtime' : p;
  return `${end ? 'after' : 'in'} ${name}`;
};

const COUNT = ['', 'One', 'Two', 'Three'];

/**
 * "If this holds" (round 11 #4): how a needed game in progress stands for the team the path
 * needs to win. Null if the game isn't in progress.
 */
export function liveCall(
  r: NeededResult,
  game: Game | undefined,
  teams: readonly SeasonTeam[],
  closesIfHolds: boolean,
): string | null {
  if (!game || game.status !== 'in_progress' || !game.score) return null;
  const winner = teams[r.winner]!;
  const mine = game.home === winner.franchiseId ? game.score.home : game.score.away;
  const theirs = game.home === winner.franchiseId ? game.score.away : game.score.home;
  const when = game.live ? ` ${inPeriod(game.live.period)}` : '';
  if (mine === theirs) return `Tied ${mine}–${theirs}${when}.`;
  if (mine < theirs) return `${winner.nickname} trail ${mine}–${theirs}${when}.`;
  const tail = closesIfHolds ? ' If it holds, the circle closes.' : '';
  return `${winner.nickname} lead ${mine}–${theirs}${when}.${tail}`;
}

/** "Chargers win at Ravens" / "Ravens win vs. Chargers": a need, never a result. */
export function needWords(r: NeededResult, game: Game | undefined, teams: readonly SeasonTeam[]) {
  const winner = teams[r.winner]!;
  const loser = teams[r.loser]!;
  const home = game?.home === winner.franchiseId;
  return `${winner.nickname} win ${home ? 'vs.' : 'at'} ${loser.nickname}`;
}

/**
 * The fastest path to a circle, as a broadcast score bug (style direction A). The panel (the
 * desktop side column) shows each needed game as a matchup, away @ home, with the team that
 * has to win picked out; the banner (phones) is one strip: "Needs: Chargers win at Ravens".
 */
export function PathBanner({
  state,
  teams,
  games,
  periodLabel,
  latestPeriod,
  previewing,
  onPreview,
  variant = 'banner',
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const { path, ways, complete } = state;
  if (!path || path.needed.length === 0) return null;
  const panel = variant === 'panel';
  const k = path.needed.length;
  const thisWeek = path.periodIndex <= latestPeriod + 1;
  // Only what the list doesn't already say: when, if not this week, and how many, if unlisted.
  const note =
    k > NAME_UP_TO
      ? `${k} results needed`
      : thisWeek
        ? null
        : `by ${periodLabel(path.periodIndex)}`;
  const headline =
    k <= NAME_UP_TO
      ? `${COUNT[k]} game${k === 1 ? '' : 's'} away`
      : `Earliest: ${periodLabel(path.periodIndex)}`;
  const others = ways ? ways.length - 1 : 0;
  const othersLabel = `${others}${complete ? '' : '+'} other ${others === 1 ? 'way' : 'ways'}`;
  const byTeam = new Map(teams.map((t, i) => [t.franchiseId, i]));
  const words = (r: NeededResult) => needWords(r, games.get(r.gameId), teams);

  const show = (
    <button type="button" className={styles.show} aria-pressed={previewing} onClick={onPreview}>
      {previewing ? 'Back to now' : 'Preview'}
    </button>
  );

  /** One side of a matchup; the side that has to win is picked out. */
  const side = (franchiseId: string, picked: boolean, end: boolean) => {
    const i = byTeam.get(franchiseId);
    const team = i === undefined ? undefined : teams[i];
    if (!team) return null;
    return (
      <span className={styles.side} data-picked={picked || undefined} data-end={end || undefined}>
        <span
          className={styles.disc}
          style={{ background: team.colors.primary }}
          aria-hidden="true"
        >
          {team.abbr}
        </span>
        <span className={styles.sideText}>
          <span className={styles.sideName}>{team.nickname}</span>
          {picked && <span className={styles.win}>Win</span>}
        </span>
      </span>
    );
  };

  const pick = (r: NeededResult) => {
    const game = games.get(r.gameId);
    const live = liveCall(r, game, teams, k === 1);
    const winner = teams[r.winner]!.franchiseId;
    return (
      <li key={r.gameId} className={styles.pick}>
        <span className={styles.visuallyHidden}>{words(r)}</span>
        {game && (
          <span className={styles.matchup} aria-hidden="true">
            {side(game.away, game.away === winner, false)}
            <span className={styles.at}>@</span>
            {side(game.home, game.home === winner, true)}
          </span>
        )}
        {game && (
          <span className={styles.when}>
            {live ? (
              <span className={styles.live}>
                <span className={styles.dot} aria-hidden="true" />
                Live
              </span>
            ) : (
              kickoff(game.scheduledAt, now)
            )}
          </span>
        )}
        {live && <span className={styles.call}>{live}</span>}
      </li>
    );
  };

  if (panel) {
    return (
      <section className={styles.panel} aria-live="polite" aria-label={headline}>
        <p className={styles.bugHead}>
          {headline}
          {note && <span className={styles.bugNote}>{note}</span>}
        </p>
        <div className={styles.body}>
          <p className={styles.label}>Needs</p>
          <ul className={styles.picks}>{path.needed.map(pick)}</ul>
          {show}
          {ways && others > 0 && (
            <>
              <p className={styles.label}>{othersLabel}</p>
              <ul className={styles.ways}>
                {ways.slice(1).map((w) => (
                  <li key={w.map((r) => r.gameId + r.winner).join()}>{w.map(words).join(', ')}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    );
  }

  // Phones: one strip under the status.
  const first = path.needed[0]!;
  const firstGame = games.get(first.gameId);
  const firstLive = liveCall(first, firstGame, teams, k === 1);
  return (
    <section className={styles.strip} aria-live="polite" aria-label={headline}>
      <p className={styles.stripHead}>{headline}</p>
      <p className={styles.stripText}>
        {k <= NAME_UP_TO ? (
          <>
            <span className={styles.needs}>Needs</span> {path.needed.map(words).join(', ')}
            {k === 1 && firstGame && !firstLive && (
              <span className={styles.stripWhen}> · {kickoff(firstGame.scheduledAt, now)}</span>
            )}
          </>
        ) : (
          note
        )}
        {firstLive && k === 1 && <span className={styles.stripCall}>{firstLive}</span>}
      </p>
      {show}
    </section>
  );
}
