import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './Scrubber.module.css';

interface Props {
  labels: string[];
  index: number;
  playing: boolean;
  onChange: (index: number) => void;
  onTogglePlay: () => void;
}

/**
 * Week scrubber: a native range input (keyboard and screen-reader friendly) plus play/step,
 * drawn as one block per week. The handle is exactly one block wide, which puts its center on
 * block i's center for value i (a range thumb's center runs from thumb/2 to width - thumb/2), so
 * the lit weeks and the handle always line up.
 */
export function Scrubber({ labels, index, playing, onChange, onTogglePlay }: Props) {
  const last = labels.length - 1;
  const weeks = Math.max(1, labels.length);
  const rangeRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={styles.bar} role="group" aria-label="Season timeline">
      <button
        type="button"
        className={styles.button}
        onClick={() => onChange(Math.max(0, index - 1))}
        disabled={index <= 0}
        aria-label="Previous week"
      >
        ‹
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.play}`}
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : 'Play the season'}
        aria-pressed={playing}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => onChange(Math.min(last, index + 1))}
        disabled={index >= last}
        aria-label="Next week"
      >
        ›
      </button>
      <input
        ref={rangeRef}
        className={styles.range}
        style={
          {
            '--weeks': weeks,
            '--block': `${width / weeks}px`,
            '--played': `${(index / weeks) * 100}%`,
          } as CSSProperties
        }
        type="range"
        min={0}
        max={Math.max(0, last)}
        step={1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Week"
        aria-valuetext={labels[index]}
      />
      <output className={styles.label} aria-live="polite">
        {labels[index] ?? '—'}
      </output>
    </div>
  );
}
