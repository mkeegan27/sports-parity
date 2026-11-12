import { describe, expect, it } from 'vitest';
import { ago } from '../components/LiveLine';
import { pollDelay, type Latest } from './useLatest';

const latest = (over: Partial<Latest> = {}): Latest => ({
  league: 'nfl',
  season: '2026',
  checkedAt: '2026-11-12T18:00:00Z',
  changedAt: null,
  inProgress: 0,
  nextKickoff: '2026-11-13T01:15:00Z',
  ...over,
});

describe('pollDelay', () => {
  const now = Date.parse('2026-11-12T18:00:00Z');
  it('polls every minute while games are on or about to start', () => {
    expect(pollDelay(latest({ inProgress: 2 }), now)).toBe(60_000);
    expect(pollDelay(latest({ nextKickoff: '2026-11-12T18:10:00Z' }), now)).toBe(60_000);
  });
  it('polls every five minutes otherwise', () => {
    expect(pollDelay(latest(), now)).toBe(300_000);
    expect(pollDelay(latest({ nextKickoff: null }), now)).toBe(300_000);
    expect(pollDelay(null, now)).toBe(300_000);
  });
});

describe('ago', () => {
  const at = '2026-11-12T18:00:00Z';
  const plus = (ms: number) => Date.parse(at) + ms;
  it('reads naturally', () => {
    expect(ago(at, plus(30_000))).toBe('just now');
    expect(ago(at, plus(4 * 60_000))).toBe('4 min ago');
    expect(ago(at, plus(2 * 3_600_000))).toBe('2 h ago');
    expect(ago(at, plus(3 * 86_400_000))).toBe('3 days ago');
  });
});
