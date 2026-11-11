import { useEffect, useRef } from 'react';
import type { Theme } from '../theme/tokens';
import { RingRenderer, type RingData } from './RingRenderer';
import styles from './RingCanvas.module.css';

interface Props {
  data: RingData;
  theme: Theme;
  /** Text alternative for the drawing; the list view carries the full detail. */
  label: string;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function RingCanvas({ data, theme, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<RingRenderer | null>(null);
  const latest = useRef(data);

  useEffect(() => {
    latest.current = data;
    rendererRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new RingRenderer(theme, prefersReducedMotion());
    let cancelled = false;
    void renderer.init(host).then(() => {
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      renderer.setData(latest.current);
    });
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [theme]);

  return <div ref={hostRef} className={styles.host} role="img" aria-label={label} />;
}
