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

/**
 * The fastest path to a circle. As a banner (phones) it sits under the status card and folds
 * long lists away; as a panel (the desktop side column) it has room to show everything.
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
  const name = (r: NeededResult) => `${teams[r.winner]!.nickname} beat ${teams[r.loser]!.nickname}`;
  const thisWeek = path.periodIndex <= latestPeriod + 1;
  // Only what the list doesn't already say: when, if not this week, and how many, if unlisted.
  const note =
    k > NAME_UP_TO
      ? `${k} results needed`
      : thisWeek
        ? null
        : `by ${periodLabel(path.periodIndex)}`;
  const others = ways ? ways.length - 1 : 0;
  const othersLabel = `${others}${complete ? '' : '+'} other ${others === 1 ? 'way' : 'ways'}`;

  const item = (r: NeededResult) => {
    const game = games.get(r.gameId);
    const live = liveCall(r, game, teams, k === 1);
    return (
      <li key={r.gameId} className={styles.result}>
        {panel && (
          <span
            className={styles.chip}
            style={{ background: teams[r.winner]!.colors.primary }}
            aria-hidden="true"
          />
        )}
        <span className={styles.name}>{name(r)}</span>
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

  const headline =
    k <= NAME_UP_TO
      ? `${COUNT[k]} game${k === 1 ? '' : 's'} away`
      : `Earliest: ${periodLabel(path.periodIndex)}`;
  const show = (
    <button type="button" className={styles.show} aria-pressed={previewing} onClick={onPreview}>
      {previewing ? 'Back to now' : 'Preview'}
    </button>
  );
  const results = <ul className={styles.list}>{path.needed.map(item)}</ul>;
  const otherList = ways && others > 0 && (
    <ul className={styles.ways}>
      {ways.slice(1).map((w) => (
        <li key={w.map((r) => r.gameId + r.winner).join()}>{w.map(name).join(', ')}</li>
      ))}
    </ul>
  );

  if (panel) {
    return (
      <section className={styles.panel} aria-live="polite" aria-label={headline}>
        <p className={styles.panelHeadline}>
          {headline}
          {note && <span className={styles.muted}> · {note}</span>}
        </p>
        {results}
        {show}
        {otherList && (
          <>
            <p className={styles.subhead}>Or</p>
            {otherList}
          </>
        )}
      </section>
    );
  }

  return (
    <div className={styles.path} aria-live="polite">
      <div className={styles.top}>
        <p className={styles.headline}>
          {headline}
          {note && <span className={styles.muted}> · {note}</span>}
        </p>
        {show}
      </div>
      {k <= NAME_UP_TO ? (
        results
      ) : (
        <details className={styles.more}>
          <summary>Show all</summary>
          {results}
        </details>
      )}
      {otherList && (
        <details className={styles.more}>
          <summary>{othersLabel}</summary>
          {otherList}
        </details>
      )}
    </div>
  );
}
