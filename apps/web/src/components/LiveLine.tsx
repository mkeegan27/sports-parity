import { useEffect, useState } from 'react';
import type { Latest } from '../data/useLatest';
import styles from './LiveLine.module.css';

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function ago(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * How fresh the scores are (round 10 #4): a pulsing dot while games are on, and when the feed
 * was last checked, so a stalled feed shows.
 */
export function LiveLine({
  latest,
  className,
}: {
  latest: Latest;
  className?: string | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!latest.checkedAt) return null;
  const live = latest.inProgress;
  return (
    <p className={`${styles.line} ${className ?? ''}`}>
      {live > 0 && (
        <span className={styles.live}>
          <span className={styles.dot} aria-hidden="true" />
          {live} live
        </span>
      )}
      <time dateTime={latest.checkedAt}>Updated {ago(latest.checkedAt, now)}</time>
    </p>
  );
}
