import { z } from 'zod';

/**
 * Normalized, league-agnostic data model. Every adapter's output must pass these schemas.
 * Bump SCHEMA_VERSION on any breaking change so stale data files are rejected, not misread.
 */
export const SCHEMA_VERSION = 1;

const isoDateTime = z.iso.datetime({ offset: true });
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const GameTypeSchema = z.enum(['preseason', 'regular', 'postseason']);
export type GameType = z.infer<typeof GameTypeSchema>;

export const GameStatusSchema = z.enum([
  'scheduled',
  'in_progress',
  'final',
  'postponed',
  'cancelled',
]);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const OutcomeDetailSchema = z.enum(['regulation', 'overtime', 'shootout']);
export type OutcomeDetail = z.infer<typeof OutcomeDetailSchema>;

/** A team as it existed in one season. `franchiseId` is stable across relocations and renames. */
export const SeasonTeamSchema = z.object({
  franchiseId: z.string().min(1),
  abbr: z.string().min(1),
  name: z.string().min(1),
  nickname: z.string().min(1),
  colors: z.object({ primary: hexColor, secondary: hexColor }),
  /** Grouping path, outermost first, labelled by the league config (e.g. ["AFC", "AFC West"]). */
  groups: z.array(z.string()),
});
export type SeasonTeam = z.infer<typeof SeasonTeamSchema>;

/** A point on the league's timeline (NFL: a week). `index` orders periods within a season. */
export const PeriodSchema = z.object({
  index: z.number().int(),
  label: z.string().min(1),
});
export type Period = z.infer<typeof PeriodSchema>;

export const LiveStateSchema = z.object({
  period: z.string(),
  clock: z.string().optional(),
});

export const GameSchema = z
  .object({
    id: z.string().min(1),
    gameType: GameTypeSchema,
    period: PeriodSchema,
    scheduledAt: isoDateTime,
    status: GameStatusSchema,
    home: z.string().min(1),
    away: z.string().min(1),
    neutralSite: z.boolean(),
    /** Present for in-progress and final games. */
    score: z.object({ home: z.number().int().min(0), away: z.number().int().min(0) }).optional(),
    outcome: OutcomeDetailSchema.optional(),
    live: LiveStateSchema.optional(),
    /** IDs of this game in each source, keyed by source name (e.g. { nflverse: "...", espn: "..." }). */
    sourceIds: z.record(z.string(), z.string()),
  })
  .refine((g) => g.home !== g.away, { message: 'home and away must differ' })
  .refine((g) => g.status !== 'final' || g.score !== undefined, {
    message: 'final games need a score',
  });
export type Game = z.infer<typeof GameSchema>;

export const SeasonDataSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    league: z.string().min(1),
    /** Canonical season key used in URLs, e.g. "2026" or "2026-27". */
    season: z.string().min(1),
    generatedAt: isoDateTime,
    sources: z.array(z.object({ name: z.string(), url: z.url(), license: z.string().optional() })),
    teams: z.array(SeasonTeamSchema),
    games: z.array(GameSchema),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.teams.map((t) => t.franchiseId));
    if (ids.size !== s.teams.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate franchiseId' });
    const gameIds = new Set<string>();
    for (const g of s.games) {
      if (gameIds.has(g.id)) ctx.addIssue({ code: 'custom', message: `duplicate game id ${g.id}` });
      gameIds.add(g.id);
      for (const side of [g.home, g.away]) {
        if (!ids.has(side))
          ctx.addIssue({ code: 'custom', message: `game ${g.id} references unknown team ${side}` });
      }
    }
  });
export type SeasonData = z.infer<typeof SeasonDataSchema>;

/** Parse and validate unknown input (e.g. a fetched JSON file). Throws with readable issues. */
export function parseSeasonData(input: unknown): SeasonData {
  const result = SeasonDataSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid season data:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
