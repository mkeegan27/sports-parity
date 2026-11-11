/**
 * Fetch NFL seasons from nflverse, validate them against the core schema, and write one
 * JSON file per season plus an index for the web app.
 *
 *   pnpm data:nfl                     # 2002 through the latest season, cached downloads
 *   pnpm data:nfl --from 1999 --refresh
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NflverseAdapter, defaultFetchText, type FetchText } from '@sports-parity/adapters';
import { parseSeasonData, SCHEMA_VERSION, type SeasonData } from '@sports-parity/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '2002' },
    to: { type: 'string' },
    out: { type: 'string', default: join(root, 'apps/web/public/data/nfl') },
    refresh: { type: 'boolean', default: false },
  },
});

const CACHE_DIR = join(root, 'data/cache');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Download with an on-disk cache so repeated runs don't hammer the source. */
const cachedFetch: FetchText = async (url) => {
  const file = join(CACHE_DIR, createHash('sha1').update(url).digest('hex').slice(0, 16));
  if (!values.refresh) {
    const info = await stat(file).catch(() => null);
    if (info && Date.now() - info.mtimeMs < CACHE_TTL_MS) return readFile(file, 'utf8');
  }
  const text = await defaultFetchText(url);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, text);
  return text;
};

const adapter = new NflverseAdapter(cachedFetch);
const from = Number(values.from);
// Seasons with no games yet (e.g. next year's before the schedule is out) are skipped below.
const to = values.to ? Number(values.to) : new Date().getFullYear();

await mkdir(values.out, { recursive: true });
const index: { season: string; games: number; completed: number }[] = [];
for (let season = from; season <= to; season++) {
  const [teams, games] = await Promise.all([
    adapter.fetchTeams(season),
    adapter.fetchSchedule(season),
  ]);
  if (games.length === 0) continue;
  const data: SeasonData = parseSeasonData({
    schemaVersion: SCHEMA_VERSION,
    league: 'nfl',
    season: String(season),
    generatedAt: new Date().toISOString(),
    sources: [adapter.source],
    teams,
    games,
  });
  await writeFile(join(values.out, `${season}.json`), JSON.stringify(data));
  const completed = games.filter((g) => g.status === 'final').length;
  index.push({ season: String(season), games: games.length, completed });
  console.log(`nfl ${season}: ${teams.length} teams, ${completed}/${games.length} games final`);
}
await writeFile(
  join(values.out, 'index.json'),
  JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    league: 'nfl',
    generatedAt: new Date().toISOString(),
    seasons: index,
  }),
);
console.log(`wrote ${index.length} seasons to ${values.out}`);
