/**
 * Convert a wall-clock date and time in an IANA time zone to an ISO 8601 string with the
 * correct UTC offset for that date (e.g. "2026-11-16T20:15:00-05:00").
 */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  const [hh = '00', mm = '00'] = time.split(':');
  const asUtc = Date.parse(`${date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00Z`);
  if (Number.isNaN(asUtc)) throw new Error(`bad date/time: ${date} ${time}`);
  // Offset of the zone at (approximately) that instant, in minutes.
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return Math.round((wall - ms) / 60000);
  };
  const offset = offsetAt(asUtc - offsetAt(asUtc) * 60000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00${off}`;
}
