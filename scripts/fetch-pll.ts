/**
 * Build PLL seasons: 2019-2021 from the curated results file in the repo (data/pll), 2022 onward
 * from ESPN, classified as in adapters/pll. Each is validated against the core schema and written
 * as one JSON file per season, plus an index for the web app.
 *
 *   pnpm data:pll
 *   pnpm data:pll --from 2023 --refresh
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildPllEarlySeason,
  buildPllSeason,
  defaultFetchText,
  parsePllEarlyCsv,
  pllSeasonUrl,
} from '@sports-parity/adapters';
import { parseSeasonData, SCHEMA_VERSION } from '@sports-parity/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '2019' },
    to: { type: 'string' },
    out: { type: 'string', default: join(root, 'apps/web/public/data/pll') },
    refresh: { type: 'boolean', default: false },
  },
});

const CACHE_DIR = join(root, 'data/cache');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cachedFetch = async (url: string) => {
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

/** ESPN's PLL coverage starts here; earlier seasons come from the curated file. */
const ESPN_FROM = 2022;
const early = parsePllEarlyCsv(await readFile(join(root, 'data/pll/2019-2021.csv'), 'utf8'));

const from = Number(values.from);
const to = values.to ? Number(values.to) : new Date().getFullYear();
await mkdir(values.out, { recursive: true });
const index: { season: string; games: number; completed: number }[] = [];
for (let season = from; season <= to; season++) {
  const now = new Date().toISOString();
  const data = parseSeasonData(
    season < ESPN_FROM
      ? buildPllEarlySeason(early, season, now)
      : buildPllSeason(JSON.parse(await cachedFetch(pllSeasonUrl(season))), season, now),
  );
  if (data.games.length === 0) continue;
  await writeFile(join(values.out, `${season}.json`), JSON.stringify(data));
  const completed = data.games.filter((g) => g.status === 'final').length;
  index.push({ season: String(season), games: data.games.length, completed });
  const byType = Object.entries(
    data.games.reduce<Record<string, number>>(
      (n, g) => ({ ...n, [g.gameType]: (n[g.gameType] ?? 0) + 1 }),
      {},
    ),
  )
    .map(([t, n]) => `${n} ${t}`)
    .join(', ');
  console.log(
    `pll ${season}: ${data.teams.length} teams, ${completed}/${data.games.length} final (${byType})`,
  );
}
await writeFile(
  join(values.out, 'index.json'),
  JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    league: 'pll',
    generatedAt: new Date().toISOString(),
    seasons: index,
  }),
);
console.log(`wrote ${index.length} seasons to ${values.out}`);
