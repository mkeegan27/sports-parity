import type { SeasonTeam, Snapshot } from '@sports-parity/core';
import styles from './CircleList.module.css';

interface Props {
  teams: readonly SeasonTeam[];
  snapshot: Snapshot;
}

const record = (s: Snapshot, i: number) => {
  const r = s.graph.records[i]!;
  return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
};

/** The ring as text: who beat whom, in order. Also the accessible equivalent of the drawing. */
export function CircleList({ teams, snapshot }: Props) {
  const { order, status } = snapshot;
  const placed = new Set(order);
  const outside = teams.map((_, i) => i).filter((i) => !placed.has(i));
  const nextOf = (pos: number) =>
    pos + 1 < order.length ? order[pos + 1] : status === 'circle' ? order[0] : undefined;

  return (
    <details className={styles.details}>
      <summary>
        {status === 'circle' ? 'The circle, team by team' : 'Longest chain, team by team'}
      </summary>
      <ol className={styles.list}>
        {order.map((team, pos) => {
          const next = nextOf(pos);
          return (
            <li key={teams[team]!.franchiseId}>
              <span className={styles.team}>
                {teams[team]!.name}{' '}
                <span className={styles.record}>({record(snapshot, team)})</span>
              </span>
              {next !== undefined && <span className={styles.beat}> beat {teams[next]!.name}</span>}
            </li>
          );
        })}
      </ol>
      {outside.length > 0 && (
        <p className={styles.outside}>
          Not in the chain yet: {outside.map((i) => teams[i]!.name).join(', ')}.
        </p>
      )}
    </details>
  );
}
