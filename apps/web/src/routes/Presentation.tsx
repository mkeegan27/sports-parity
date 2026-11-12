import { useCallback, useEffect, useState } from 'react';
import styles from './Presentation.module.css';

const IDLE_HIDE_MS = 2500;

export interface Presentation {
  on: boolean;
  /** Controls show on any pointer or key activity and hide again when idle. */
  controlsVisible: boolean;
  enter: () => void;
  exit: () => void;
}

/**
 * Presentation mode (round 9): the ring alone, framed for vertical screen recording. The page
 * hides its chrome (via `data-presenting`), the browser goes full screen where it can, and a
 * small control bar shows on activity and hides when idle or while the closing moment plays.
 */
export function usePresentation(momentActive: boolean): Presentation {
  const [on, setOn] = useState(false);
  const [awake, setAwake] = useState(true);

  const enter = useCallback(() => {
    setOn(true);
    setAwake(true);
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const exit = useCallback(() => {
    setOn(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!on) return;
    let timer = window.setTimeout(() => setAwake(false), IDLE_HIDE_MS);
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), IDLE_HIDE_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc first skips a playing moment (the stage handles that), then leaves the mode.
      if (e.key === 'Escape' && !momentActive && !document.querySelector('dialog[open]')) exit();
      else wake();
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [on, momentActive, exit]);

  return { on, controlsVisible: on && awake && !momentActive, enter, exit };
}

interface ControlsProps {
  presentation: Presentation;
  leagueName: string;
  season: string;
  week: string;
  headline: string;
  playing: boolean;
  momentActive: boolean;
  canReplay: boolean;
  onPlaySeason: () => void;
  onPause: () => void;
  onReplay: () => void;
}

/** The titles a recording needs for context, and the auto-hiding control bar. */
export function PresentationControls({
  presentation,
  leagueName,
  season,
  week,
  headline,
  playing,
  canReplay,
  onPlaySeason,
  onPause,
  onReplay,
}: ControlsProps) {
  return (
    <>
      <div className={styles.titles}>
        <span className={styles.kicker}>
          {leagueName} · {season}
        </span>
        <span className={styles.week}>{week}</span>
        <span className={styles.headline}>{headline}</span>
      </div>
      <div
        className={styles.bar}
        data-visible={presentation.controlsVisible || undefined}
        inert={!presentation.controlsVisible}
      >
        {playing ? (
          <button type="button" onClick={onPause}>
            <span aria-hidden="true">❚❚</span> Pause
          </button>
        ) : (
          <button type="button" onClick={onPlaySeason}>
            <span aria-hidden="true">▶</span> Play season
          </button>
        )}
        {canReplay && (
          <button type="button" onClick={onReplay}>
            <span aria-hidden="true">↻</span> Replay closing
          </button>
        )}
        <button type="button" onClick={presentation.exit} aria-label="Exit presentation mode">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </>
  );
}
