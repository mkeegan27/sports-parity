/**
 * Design tokens: the single source of truth for both CSS (as custom properties) and the
 * WebGL renderer. Themes are token sets, so light, dark or broadcast styles are swaps.
 */
export interface Theme {
  name: string;
  color: {
    bg: string;
    surface: string;
    surfaceRaised: string;
    border: string;
    text: string;
    textMuted: string;
    /** The signal color: what matters now (the path, the current week, primary actions). */
    accent: string;
    /** Text on the accent color. */
    accentInk: string;
    /** Games in progress. */
    live: string;
    /** Primary circle edges and flow. */
    ring: string;
    /** Non-primary "who beat whom" chords. */
    chord: string;
    /** A selected team's wins and losses. */
    win: string;
    loss: string;
    /** Teams nobody has beaten yet. */
    unbeaten: string;
    focus: string;
  };
  /** display: headlines (an editorial serif); body: interface and labels; mono: data. */
  font: { display: string; body: string; mono: string };
}

/**
 * "Prime Time" (style round, direction A): broadcast graphics with an editorial serif. Ink
 * ground, square panels, an amber signal color, live red, and a pale blue rim that glows.
 */
export const darkTheme: Theme = {
  name: 'dark',
  color: {
    bg: '#07090f',
    surface: '#10141f',
    surfaceRaised: '#171c2a',
    border: '#262d3f',
    text: '#f4f5f7',
    textMuted: '#9aa3b5',
    accent: '#ffb020',
    accentInk: '#07090f',
    live: '#ff3b30',
    ring: '#9fd0ff',
    chord: '#8899bb',
    win: '#9fd0ff',
    loss: '#ff6b5e',
    unbeaten: '#ffd166',
    focus: '#ffb020',
  },
  font: {
    display: '"DM Serif Display", Georgia, serif',
    body: 'Barlow, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
};

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Write a theme's tokens to CSS custom properties (e.g. --color-text-muted). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [group, values] of Object.entries(theme)) {
    if (typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values as Record<string, string>)) {
      root.style.setProperty(`--${group}-${kebab(key)}`, value);
    }
  }
  root.dataset.theme = theme.name;
}

/** "#rrggbb" -> 0xrrggbb for the renderer. */
export const hexToNumber = (hex: string): number => Number.parseInt(hex.slice(1), 16);

/** Black or white text, whichever contrasts more with a background color (WCAG luminance). */
export function readableTextOn(hex: string): '#000000' | '#ffffff' {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
