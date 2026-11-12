import { describe, expect, it } from 'vitest';
import { closingGame } from './analysis';
import type { WinEdge } from './graph/winGraph';

const win = (winner: number, loser: number, gameId: string): WinEdge => ({
  winner,
  loser,
  gameId,
  simulated: false,
});

describe('closingGame', () => {
  const games = new Map([
    ['w1-a', { scheduledAt: '2025-09-07T17:00:00Z' }],
    ['w1-b', { scheduledAt: '2025-09-07T20:25:00Z' }],
    ['w2-a', { scheduledAt: '2025-09-14T17:00:00Z' }],
    ['w3-a', { scheduledAt: '2025-09-21T17:00:00Z' }],
    ['w4-a', { scheduledAt: '2025-09-28T17:00:00Z' }],
  ]);

  it('picks the link whose first win came last', () => {
    // Circle 0 -> 1 -> 2 -> 0. The 2 -> 0 link first appeared in week 2; 0 -> 1 had an earlier
    // win (week 1) and a later rematch (week 4) that must not count.
    const edges = [
      win(0, 1, 'w4-a'),
      win(0, 1, 'w1-a'),
      win(1, 2, 'w1-b'),
      win(2, 0, 'w2-a'),
      win(1, 0, 'w3-a'), // not a circle link
    ];
    expect(closingGame({ edges }, [0, 1, 2], games)).toEqual(win(2, 0, 'w2-a'));
    // The same circle read from another starting team gives the same answer.
    expect(closingGame({ edges }, [2, 0, 1], games)).toEqual(win(2, 0, 'w2-a'));
  });

  it('breaks kickoff ties by game id, and returns null when a link is missing', () => {
    const tied = new Map([
      ['b', { scheduledAt: '2025-09-07T17:00:00Z' }],
      ['a', { scheduledAt: '2025-09-07T17:00:00Z' }],
    ]);
    const edges = [win(0, 1, 'a'), win(1, 0, 'b')];
    expect(closingGame({ edges }, [0, 1], tied)?.gameId).toBe('b');
    expect(closingGame({ edges: [win(0, 1, 'a')] }, [0, 1], tied)).toBeNull();
  });
});
