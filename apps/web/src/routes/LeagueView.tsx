import { NFL, type LeagueConfig } from '@sports-parity/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { CircleList } from '../components/CircleList';
import { Scrubber } from '../components/Scrubber';
import { describeStatus } from '../data/status';
import { useSeason, useSeasonIndex } from '../data/useSeason';
import { RingCanvas } from '../ring/RingCanvas';
import { darkTheme } from '../theme/tokens';
import styles from './LeagueView.module.css';

const LEAGUES: Record<string, LeagueConfig> = { nfl: NFL };
const PLAY_STEP_MS = 1100;

/** "Week 9" <-> "week-9": URL segments are slugs of the league's own period labels. */
export const periodSlug = (label: string) => label.toLowerCase().replace(/\s+/g, '-');

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName));

export function LeagueView() {
  const params = useParams();
  const league = LEAGUES[params.league ?? ''];
  const index = useSeasonIndex(league?.id ?? 'nfl');
  const navigate = useNavigate();
  const season = params.season ?? (index.state === 'ready' ? index.value[0]?.season : undefined);
  const loaded = useSeason(league ?? NFL, season);
  const [playing, setPlaying] = useState(false);

  const ready = loaded.state === 'ready' ? loaded.value : null;
  const periods = useMemo(() => ready?.analysis.periods ?? [], [ready]);
  const fromUrl = periods.findIndex((p) => periodSlug(p.periodLabel) === params.week);
  const current = fromUrl >= 0 ? fromUrl : periods.length - 1;

  const goTo = useCallback(
    (i: number, replace = true) => {
      const p = periods[i];
      if (!p || !league || !season) return;
      void navigate(`/${league.id}/${season}/${periodSlug(p.periodLabel)}`, { replace });
    },
    [periods, league, season, navigate],
  );

  // Playback steps forward on a timer and stops by itself at the last week.
  const atEnd = current >= periods.length - 1;
  const isPlaying = playing && !atEnd;
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setTimeout(() => goTo(current + 1), PLAY_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, current, goTo]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    if (atEnd) goTo(0); // replay from the start
    setPlaying(true);
  }, [isPlaying, atEnd, goTo]);

  // Space: play/pause. Left/right: step a week. Ignored while a control has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') goTo(Math.max(0, current - 1));
      else if (e.key === 'ArrowRight') goTo(Math.min(periods.length - 1, current + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, goTo, current, periods.length]);

  if (!league) return <Navigate to="/nfl" replace />;

  const snapshot = periods[current];
  const status =
    ready && snapshot ? describeStatus(snapshot, ready.data.teams, ready.analysis.closedAt) : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Circle of Parity</h1>
          {index.state === 'ready' && (
            <label className={styles.seasonPicker}>
              <span className={styles.visuallyHidden}>Season</span>
              <select
                value={season}
                onChange={(e) => {
                  setPlaying(false);
                  void navigate(`/${league.id}/${e.target.value}`);
                }}
              >
                {index.value.map((s) => (
                  <option key={s.season} value={s.season}>
                    {s.season}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {status ? (
          <section className={styles.banner} data-tone={status.tone} aria-live="polite">
            <p className={styles.headline}>{status.headline}</p>
            <p className={styles.detail}>{status.detail}</p>
          </section>
        ) : (
          <p className={styles.detail}>
            {loaded.state === 'error' || index.state === 'error'
              ? 'Could not load season data.'
              : 'Loading…'}
          </p>
        )}
      </header>

      <main className={styles.main}>
        <div className={styles.ring}>
          {ready && snapshot && (
            <RingCanvas
              data={{ teams: ready.data.teams, snapshot }}
              theme={darkTheme}
              label={status ? `${status.headline}. ${status.detail}` : 'Ring of teams'}
            />
          )}
        </div>
        {ready && snapshot && <CircleList teams={ready.data.teams} snapshot={snapshot} />}
      </main>

      {periods.length > 0 && (
        <footer className={styles.footer}>
          <Scrubber
            labels={periods.map((p) => p.periodLabel)}
            index={current}
            playing={isPlaying}
            onChange={(i) => {
              setPlaying(false);
              goTo(i);
            }}
            onTogglePlay={togglePlay}
          />
        </footer>
      )}
    </div>
  );
}
