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
  const name = (r: NeededResult) => `${teams[r.winner]!.nickname} over ${teams[r.loser]!.nickname}`;
  const when =
    path.periodIndex <= latestPeriod + 1 ? 'this week' : `by ${periodLabel(path.periodIndex)}`;
  const others = ways ? ways.length - 1 : 0;
  const othersLabel = `${others}${complete ? '' : '+'} other ${others === 1 ? 'way' : 'ways'}`;

  const item = (r: NeededResult) => {
    const game = games.get(r.gameId);
    const live = liveCall(r, game, teams, k === 1, now);
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
    k <= NAME_UP_TO ? (
      <>
        {k === 1 ? '1 result' : `${k} results`} from a circle{' '}
        <span className={styles.muted}>{when}</span>
      </>
    ) : (
      <>
        Earliest circle: {periodLabel(path.periodIndex)}{' '}
        <span className={styles.muted}>· {k} results needed</span>
      </>
    );
  const show = (
    <button type="button" className={styles.show} aria-pressed={previewing} onClick={onPreview}>
      {previewing ? 'Back to now' : panel ? 'Show me the circle' : 'Show me'}
    </button>
  );
  const results = <ul className={styles.list}>{path.needed.map(item)}</ul>;
  const otherList = ways && others > 0 && (
    <ul className={styles.ways}>
      {ways.slice(1).map((w) => (
        <li key={w.map((r) => r.gameId + r.winner).join()}>{w.map(name).join(' + ')}</li>
      ))}
    </ul>
  );

  if (panel) {
    return (
      <section className={styles.panel} aria-live="polite" aria-labelledby="path-title">
        <p className={styles.kicker} id="path-title">
          What closes it
        </p>
        <p className={styles.panelHeadline}>{headline}</p>
        {results}
        {show}
        {otherList && (
          <>
            <p className={styles.subhead}>Or {othersLabel}</p>
            {otherList}
          </>
        )}
      </section>
    );
  }

  return (
    <div className={styles.path} aria-live="polite">
      <div className={styles.top}>
        <p className={styles.headline}>{headline}</p>
        {show}
      </div>
      {k <= NAME_UP_TO ? (
        results
      ) : (
        <details className={styles.more}>
          <summary>See the {k} results</summary>
          {results}
        </details>
      )}
      {otherList && (
        <details className={styles.more}>
          <summary>or {othersLabel}</summary>
          {otherList}
        </details>
      )}
    </div>
  );
}
