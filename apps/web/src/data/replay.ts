import type { Game } from '@sports-parity/core';

/** Auto-play the closing moment on a first visit this soon after the close (round 12 #1). */
export const REPLAY_WINDOW_MS = 7 * 86_400_000;
/** The data has no final whistle time, so the close is put at kickoff plus a typical game. */
const GAME_LENGTH_MS = 3.25 * 3_600_000;

const key = (league: string, season: string) => `circle-seen:${league}:${season}`;

/** Whether this browser has seen the moment for this season's closing game. */
export function hasSeen(league: string, season: string, gameId: string): boolean {
  try {
    return localStorage.getItem(key(league, season)) === gameId;
  } catch {
    return false; // storage blocked: treat as unseen, and the replay simply plays again
  }
}

export function markSeen(league: string, season: string, gameId: string): void {
  try {
    localStorage.setItem(key(league, season), gameId);
  } catch {
    // Nothing to do without storage.
  }
}

/** About when the circle closed: the closing game's end, never later than now. */
export const closedAtEstimate = (game: Game, now: number) =>
  Math.min(now, Date.parse(game.scheduledAt) + GAME_LENGTH_MS);

export const withinReplayWindow = (closedAt: number, now: number) =>
  now - closedAt <= REPLAY_WINDOW_MS;
