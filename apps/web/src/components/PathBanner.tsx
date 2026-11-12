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

const inPeriod = (period: string) => {
  if (period === 'Half') return 'at halftime';
  if (period.startsWith('End ')) return `after ${period.slice(4)}`;
  if (period === 'OT') return 'in overtime';
  return `in ${period}`;
};

/**
 * "If this holds" (round 11 #4): how a needed game in progress stands for the team the path
 * needs to win. Null if the game isn't in progress.
 */
export function liveCall(
  r: NeededResult,
  game: Game | undefined,
  teams: readonly SeasonTeam[],
  closesIfHolds: boolean,
  now: number,
): string | null {
  if (!game || game.status !== 'in_progress' || !game.score) return null;
  const winner = teams[r.winner]!;
  const mine = game.home === winner.franchiseId ? game.score.home : game.score.away;
  const theirs = game.home === winner.franchiseId ? game.score.away : game.score.home;
  const when = game.live ? ` ${inPeriod(game.live.period)}` : '';
  if (mine === theirs) return `Tied ${mine}–${theirs}${when}.`;
  if (mine < theirs) return `The ${winner.nickname} trail ${mine}–${theirs}${when}.`;
  const evening = new Date(now).getHours() >= 17;
  const tail = closesIfHolds
    ? ` If this holds, the circle closes ${evening ? 'tonight' : 'today'}.`
    : '';
  return `The ${winner.nickname} lead ${mine}–${theirs}${when}.${tail}`;
}

/** The fastest path to a circle, under the status banner. */
export function PathBanner({
  state,
  teams,
  games,
  periodLabel,
  latestPeriod,
  previewing,
  onPreview,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const { path, ways, complete } = state;
  if (!path || path.needed.length === 0) return null;
  const k = path.needed.length;
  const name = (r: NeededResult) => `${teams[r.winner]!.nickname} over ${teams[r.loser]!.nickname}`;
  const when =
    path.periodIndex <= latestPeriod + 1 ? 'this week' : `by ${periodLabel(path.periodIndex)}`;
  const others = ways ? ways.length - 1 : 0;

  const item = (r: NeededResult) => {
    const game = games.get(r.gameId);
    const live = liveCall(r, game, teams, k === 1, now);
    return (
      <li key={r.gameId} className={styles.result}>
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

  return (
    <div className={styles.path} aria-live="polite">
      <div className={styles.top}>
        <p className={styles.headline}>
          {k <= NAME_UP_TO ? (
            <>
              {k === 1 ? '1 result' : `${k} results`} from a circle{' '}
              <span className={styles.muted}>{when}</span>
            </>
          ) : (
            <>
              Earliest circle: {periodLabel(path.periodIndex)}{' '}
              <span className={styles.muted}>· {k} results needed</span>
            </>
          )}
        </p>
        <button type="button" className={styles.show} aria-pressed={previewing} onClick={onPreview}>
          {previewing ? 'Back to now' : 'Show me'}
        </button>
      </div>
      {k <= NAME_UP_TO ? (
        <ul className={styles.list}>{path.needed.map(item)}</ul>
      ) : (
        <details className={styles.more}>
          <summary>See the {k} results</summary>
          <ul className={styles.list}>{path.needed.map(item)}</ul>
        </details>
      )}
      {others > 0 && (
        <details className={styles.more}>
          <summary>
            or {others}
            {complete ? '' : '+'} other {others === 1 ? 'way' : 'ways'}
          </summary>
          <ul className={styles.ways}>
            {ways!.slice(1).map((w) => (
              <li key={w.map((r) => r.gameId + r.winner).join()}>{w.map(name).join(' + ')}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
