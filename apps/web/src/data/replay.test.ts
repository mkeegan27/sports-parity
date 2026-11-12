import type { Game } from '@sports-parity/core';
import { describe, expect, it } from 'vitest';
import { closedAtEstimate, withinReplayWindow } from './replay';

const game = { scheduledAt: '2026-11-17T01:15:00Z' } as Game;
const kickoff = Date.parse(game.scheduledAt);
const hour = 3_600_000;

describe('replay timing', () => {
  it('puts the close at the end of the closing game, never in the future', () => {
    expect(closedAtEstimate(game, kickoff + 10 * hour)).toBe(kickoff + 3.25 * hour);
    expect(closedAtEstimate(game, kickoff + hour)).toBe(kickoff + hour);
  });

  it('auto-plays for a week', () => {
    const closed = kickoff + 3.25 * hour;
    expect(withinReplayWindow(closed, closed + 6.9 * 24 * hour)).toBe(true);
    expect(withinReplayWindow(closed, closed + 7.1 * 24 * hour)).toBe(false);
  });
});
