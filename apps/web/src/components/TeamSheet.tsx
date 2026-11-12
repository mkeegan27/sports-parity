import type { Game, GameType, SeasonTeam } from '@sports-parity/core';
import { useEffect, useRef } from 'react';
import styles from './TeamSheet.module.css';

interface Props {
  team: SeasonTeam;
  record: string;
  teams: readonly SeasonTeam[];
  games: readonly Game[];
  gameTypes: readonly GameType[];
  /** Only games up to and including this period are shown. */
  throughPeriod: number;
  onClose: () => void;
}

/** A team's results so far, as a bottom sheet on phones and a dialog on desktop. */
export function TeamSheet({
  team,
  record,
  teams,
  games,
  gameTypes,
  throughPeriod,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const byId = new Map(teams.map((t) => [t.franchiseId, t]));
  const results = games
    .filter(
      (g) =>
        (g.home === team.franchiseId || g.away === team.franchiseId) &&
        gameTypes.includes(g.gameType) &&
        g.period.index <= throughPeriod &&
        g.status === 'final' &&
        g.score,
    )
    .sort((a, b) => a.period.index - b.period.index);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby="team-sheet-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <span className={styles.swatch} style={{ background: team.colors.primary }} />
          <h2 id="team-sheet-title" className={styles.title}>
            {team.name} <span className={styles.record}>{record}</span>
          </h2>
          <form method="dialog">
            <button type="submit" className={styles.close} aria-label="Close">
              ✕
            </button>
          </form>
        </header>
        <ol className={styles.results}>
          {results.map((g) => {
            const home = g.home === team.franchiseId;
            const opponent = byId.get(home ? g.away : g.home);
            const [us, them] = home
              ? [g.score!.home, g.score!.away]
              : [g.score!.away, g.score!.home];
            const outcome = us > them ? 'W' : us < them ? 'L' : 'T';
            return (
              <li key={g.id} className={styles.row} data-outcome={outcome}>
                <span className={styles.period}>{g.period.label}</span>
                <span className={styles.outcome}>{outcome}</span>
                <span className={styles.score}>
                  {us}–{them}
                </span>
                <span>
                  {home ? 'vs' : '@'} {opponent?.name ?? '—'}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </dialog>
  );
}
