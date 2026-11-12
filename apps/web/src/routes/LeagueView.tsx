import {
  analyzeSeason,
  closingGame,
  NFL,
  PLL,
  type GameType,
  type LeagueConfig,
  type SeasonData,
  type Snapshot,
} from '@sports-parity/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ago, LiveLine } from '../components/LiveLine';
import { PathBanner } from '../components/PathBanner';
import { Scrubber } from '../components/Scrubber';
import { TeamSheet } from '../components/TeamSheet';
import { describeStatus } from '../data/status';
import { closedAtEstimate, hasSeen, markSeen, withinReplayWindow } from '../data/replay';
import { useLatest } from '../data/useLatest';
import { useMedia } from '../data/useMedia';
import { usePath } from '../data/usePath';
import { useSeason, useSeasonIndex } from '../data/useSeason';
import { RingStage } from '../ring/RingStage';
import { PresentationControls, usePresentation } from './Presentation';
import { darkTheme } from '../theme/tokens';
import styles from './LeagueView.module.css';

const LEAGUES: Record<string, LeagueConfig> = { nfl: NFL, pll: PLL };
/** Playback holds each week this long after its teams settle, so the ring reads for a beat. */
const PLAY_HOLD_MS = 1000;
/** How long the replay holds the week before the close before stepping in. */
const REPLAY_STEP_MS = 1200;

/** "Week 9" <-> "week-9": URL segments are slugs of the league's own period labels. */
export const periodSlug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName));

export function LeagueView() {
  const params = useParams();
  const league = LEAGUES[params.league ?? ''];
  // Optional game types switched on with the page toggles (round 14 #2), kept in the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const included = searchParams.get('include') ?? '';
  const gameTypes = useMemo<GameType[]>(() => {
    const base = (league ?? NFL).defaultGameTypes;
    const allowed = new Set((league?.optionalGameTypes ?? []).map((o) => o.type));
    const extra = included.split(',').filter((t): t is GameType => allowed.has(t as GameType));
    return [...base, ...extra];
  }, [league, included]);
  const search = included ? `?include=${included}` : '';
  const index = useSeasonIndex(league?.id ?? 'nfl');
  const navigate = useNavigate();
  const season = params.season ?? (index.state === 'ready' ? index.value[0]?.season : undefined);
  const latest = useLatest(league?.id ?? 'nfl');
  const liveSeason = latest !== null && latest.season === season;
  const loaded = useSeason(
    league ?? NFL,
    season,
    liveSeason ? (latest.changedAt ?? undefined) : undefined,
    gameTypes,
  );
  const [playing, setPlaying] = useState(false);
  /** Team whose results sheet is open, by franchise (stable across weeks and seasons). */
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  /** Bumped to play the closing moment; playback holds while it runs. */
  const [celebrate, setCelebrate] = useState(0);
  const [momentActive, setMomentActive] = useState(false);
  /** Showing the circle the fastest path would form (round 11 #3). */
  const [previewing, setPreviewing] = useState(false);
  const presentation = usePresentation(momentActive);
  /** Wide screens have a side column; the path lives there instead of in the banner. */
  const wide = useMedia('(min-width: 900px)');

  const ready = loaded.state === 'ready' ? loaded.value : null;
  const periods = useMemo(() => ready?.analysis.periods ?? [], [ready]);
  const gamesById = useMemo(
    () => new Map((ready?.data.games ?? []).map((g) => [g.id, g])),
    [ready],
  );
  const fromUrl = periods.findIndex((p) => periodSlug(p.periodLabel) === params.week);
  const current = fromUrl >= 0 ? fromUrl : periods.length - 1;
  const lastIndex = periods.length - 1;

  // Live results (round 10 #3). When new data arrives for this season, a viewer on the latest
  // week moves with it (to a new week, if one appeared), and sees the closing moment if the new
  // result closed the circle; a viewer on an older week gets a "New results" pill instead.
  // Compared during render against the last data seen, not in an effect.
  const [seen, setSeen] = useState<{
    data: SeasonData;
    season: string;
    lastSlug: string;
    closed: boolean;
    finals: number;
  } | null>(null);
  const [newResults, setNewResults] = useState(false);
  const [follow, setFollow] = useState<{ slug: string } | null>(null);
  if (ready && season && ready.data !== seen?.data) {
    const lastSlug = periodSlug(periods[lastIndex]?.periodLabel ?? '');
    const closed = ready.analysis.closedAt !== null;
    const finals = ready.data.games.filter((g) => g.status === 'final').length;
    // A refetch that brings no new final (the first versioned load, or a live score) only
    // updates what's drawn.
    if (seen?.season === season && finals > seen.finals) {
      const wasOnLatest = !params.week || params.week === seen.lastSlug;
      if (wasOnLatest) {
        if (params.week && lastSlug !== seen.lastSlug) setFollow({ slug: lastSlug });
        if (closed && !seen.closed) setCelebrate((c) => c + 1);
      } else setNewResults(true);
    }
    setSeen({ data: ready.data, season, lastSlug, closed, finals });
  }
  useEffect(() => {
    if (follow && league && season) {
      void navigate(`/${league.id}/${season}/${follow.slug}${search}`, { replace: true });
    }
  }, [follow, league, season, navigate, search]);

  // The closing moment plays when stepping (or playing) forward one week into the closing
  // week, not when scrubbing backward or jumping around.
  const closedAt = ready?.analysis.closedAt ?? null;
  const closeIndex = closedAt
    ? periods.findIndex((p) => p.periodIndex === closedAt.periodIndex)
    : -1;
  const seasonClosing = useMemo(() => {
    const p = periods[closeIndex];
    return p ? closingGame(p.graph, p.order, gamesById) : null;
  }, [periods, closeIndex, gamesById]);
  const newestSeason = index.state === 'ready' && index.value[0]?.season === season;

  // Closed while you were away (round 12): on a first visit within a week of the close, show the
  // week before, step into the closing week, and play the moment with "N h ago" in the caption.
  // Decided once per season during render, so the first frame is already the week before.
  const [mountedAt] = useState(() => Date.now());
  const [replay, setReplay] = useState<{
    season: string;
    from: number;
    to: number;
    ago: string;
    stepped: boolean;
  } | null>(null);
  const [replayChecked, setReplayChecked] = useState<string | null>(null);
  if (ready && league && season && index.state === 'ready' && replayChecked !== season) {
    setReplayChecked(season);
    const game = seasonClosing ? gamesById.get(seasonClosing.gameId) : undefined;
    const onLatest =
      !params.week || params.week === periodSlug(periods[lastIndex]?.periodLabel ?? '');
    if (
      newestSeason &&
      onLatest &&
      closeIndex > 0 &&
      game &&
      !hasSeen(league.id, season, game.id)
    ) {
      const at = closedAtEstimate(game, mountedAt);
      if (withinReplayWindow(at, mountedAt)) {
        const when = ago(new Date(at).toISOString(), mountedAt);
        setReplay({ season, from: closeIndex - 1, to: closeIndex, ago: when, stepped: false });
      }
    }
  }
  const replaying = replay?.season === season ? replay : null;
  const shown = replaying ? (replaying.stepped ? replaying.to : replaying.from) : current;
  useEffect(() => {
    if (!replaying || replaying.stepped) return;
    const timer = window.setTimeout(() => {
      setReplay((r) => (r ? { ...r, stepped: true } : r));
      setCelebrate((c) => c + 1);
    }, REPLAY_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [replaying]);
  // Any moment that plays counts as seen; one that ends finishes a replay.
  const onMomentChange = useCallback(
    (active: boolean) => {
      setMomentActive(active);
      if (active && league && season && seasonClosing) {
        markSeen(league.id, season, seasonClosing.gameId);
      }
      if (!active) setReplay((r) => (r?.stepped ? null : r));
    },
    [league, season, seasonClosing],
  );
  const goTo = useCallback(
    (i: number, replace = true) => {
      const p = periods[i];
      if (!p || !league || !season) return;
      if (i === current + 1 && p.periodIndex === closedAt?.periodIndex) setCelebrate((c) => c + 1);
      if (i === periods.length - 1) setNewResults(false);
      setPreviewing(false);
      setReplay(null);
      void navigate(`/${league.id}/${season}/${periodSlug(p.periodLabel)}${search}`, { replace });
    },
    [periods, league, season, navigate, current, closedAt, search],
  );

  // Playback steps forward once the week's teams have settled plus a short hold, waits while
  // the closing moment plays, and stops by itself at the last week.
  const atEnd = current >= lastIndex;
  const isPlaying = playing && !atEnd;
  const [settled, setSettled] = useState<Snapshot | null>(null);
  const settledHere = settled !== null && settled === periods[current];
  useEffect(() => {
    if (!isPlaying || momentActive || !settledHere) return;
    const timer = window.setTimeout(() => goTo(current + 1), PLAY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, momentActive, settledHere, current, goTo]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    if (atEnd) goTo(0); // replay from the start
    setPlaying(true);
  }, [isPlaying, atEnd, goTo]);

  // Space: play/pause. Left/right: step a week. Ignored while a control has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') setPreviewing(false);
      else if (e.key === 'ArrowLeft') goTo(Math.max(0, current - 1));
      else if (e.key === 'ArrowRight') goTo(Math.min(periods.length - 1, current + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, goTo, current, periods.length]);

  const playSeason = useCallback(() => {
    goTo(0);
    setPlaying(true);
  }, [goTo]);

  const snapshot = periods[shown];
  const closing = useMemo(
    () =>
      snapshot?.status === 'circle' ? closingGame(snapshot.graph, snapshot.order, gamesById) : null,
    [snapshot, gamesById],
  );

  // The fastest path to a circle (round 11): only for the newest season, before it closes, and
  // shown on its latest week.
  const pathState = usePath(
    newestSeason && ready && !ready.analysis.closedAt ? ready.data : null,
    gameTypes,
  );
  const shownPath =
    pathState?.path && pathState.path.needed.length > 0 && current === lastIndex ? pathState : null;
  const preview = useMemo(() => {
    if (!previewing || !shownPath?.path || !ready) return null;
    const overrides = new Map(
      shownPath.path.needed.map((r) => [r.gameId, ready.data.teams[r.winner]!.franchiseId]),
    );
    const scenario = analyzeSeason(ready.data, { gameTypes, overrides });
    const last = scenario.periods.at(-1);
    return last ? { snapshot: last, reference: scenario.reference } : null;
  }, [previewing, shownPath, ready, gameTypes]);
  const marked = useMemo(
    () =>
      shownPath?.path
        ? [...new Set(shownPath.path.needed.flatMap((r) => [r.winner, r.loser]))]
        : [],
    [shownPath],
  );
  const periodLabels = useMemo(() => {
    const labels = new Map<number, string>();
    for (const g of ready?.data.games ?? []) labels.set(g.period.index, g.period.label);
    return labels;
  }, [ready]);

  if (!league) return <Navigate to="/nfl" replace />;

  const pathView = (variant: 'banner' | 'panel') =>
    shownPath && ready ? (
      <PathBanner
        variant={variant}
        state={shownPath}
        teams={ready.data.teams}
        games={gamesById}
        periodLabel={(p) => periodLabels.get(p) ?? `Period ${p}`}
        latestPeriod={periods[lastIndex]?.periodIndex ?? 0}
        previewing={preview !== null}
        onPreview={() => setPreviewing((v) => !v)}
      />
    ) : null;

  const status =
    ready && snapshot ? describeStatus(snapshot, ready.data.teams, ready.analysis.closedAt) : null;
  const openIndex =
    ready && openTeam ? ready.data.teams.findIndex((t) => t.franchiseId === openTeam) : -1;
  const openRecord = (() => {
    const r = snapshot?.graph.records[openIndex];
    if (!r) return '';
    return r.ties ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`;
  })();

  return (
    <div className={styles.page} data-presenting={presentation.on || undefined}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            <span className={styles.titleMark} aria-hidden="true" />
            Circle of Parity
          </h1>
          <button
            type="button"
            className={styles.present}
            onClick={presentation.enter}
            aria-label="Presentation mode"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {index.state === 'ready' && (
            <div className={styles.bug}>
              <label className={styles.leaguePicker}>
                <span className={styles.visuallyHidden}>League</span>
                <select
                  value={league.id}
                  onChange={(e) => {
                    setPlaying(false);
                    void navigate(`/${e.target.value}`);
                  }}
                >
                  {Object.values(LEAGUES).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.seasonPicker}>
                <span className={styles.visuallyHidden}>Season</span>
                <select
                  value={season}
                  onChange={(e) => {
                    setPlaying(false);
                    void navigate(`/${league.id}/${e.target.value}${search}`);
                  }}
                >
                  {index.value.map((s) => (
                    <option key={s.season} value={s.season}>
                      {s.season}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        {status ? (
          <>
            <section className={styles.banner} data-tone={status.tone} aria-live="polite">
              <p className={styles.headline}>{status.headline}</p>
              <p className={styles.detail}>{status.detail}</p>
              {liveSeason && <LiveLine latest={latest} className={styles.fresh} />}
            </section>
            {league.optionalGameTypes && (
              <div className={styles.toggles} role="group" aria-label="Also count">
                {league.optionalGameTypes.map((o) => {
                  const on = gameTypes.includes(o.type);
                  return (
                    <button
                      key={o.type}
                      type="button"
                      className={styles.toggle}
                      aria-pressed={on}
                      onClick={() => {
                        const next = (league.optionalGameTypes ?? [])
                          .map((x) => x.type)
                          .filter((t) => (t === o.type ? !on : gameTypes.includes(t)));
                        setPlaying(false);
                        setSearchParams(next.length ? { include: next.join(',') } : {}, {
                          replace: true,
                        });
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
            {!wide && pathView('banner')}
          </>
        ) : (
          <p className={styles.detail}>
            {loaded.state === 'error' || index.state === 'error'
              ? 'Could not load season data.'
              : 'Loading…'}
          </p>
        )}
      </header>

      <main className={styles.main}>
        <div className={styles.ring}>
          {ready && snapshot && (
            <RingStage
              teams={ready.data.teams}
              snapshot={preview?.snapshot ?? snapshot}
              reference={preview?.reference ?? ready.analysis.reference}
              games={gamesById}
              theme={darkTheme}
              label={status ? `${status.headline}. ${status.detail}` : 'Ring of teams'}
              selected={openIndex >= 0 ? openIndex : null}
              marked={marked}
              onOpenTeam={(i) => setOpenTeam(ready.data.teams[i]?.franchiseId ?? null)}
              closing={preview ? null : closing}
              celebrate={celebrate}
              closedAgo={replaying?.stepped ? replaying.ago : null}
              bare={presentation.on}
              onMomentChange={onMomentChange}
              onSettle={setSettled}
            />
          )}
        </div>
        {wide && shownPath && <aside className={styles.side}>{pathView('panel')}</aside>}
      </main>

      {ready && snapshot && openIndex >= 0 && (
        <TeamSheet
          key={openTeam}
          team={ready.data.teams[openIndex]!}
          record={openRecord}
          teams={ready.data.teams}
          games={ready.data.games}
          gameTypes={gameTypes}
          throughPeriod={snapshot.periodIndex}
          onClose={() => setOpenTeam(null)}
        />
      )}

      {presentation.on && snapshot && (
        <PresentationControls
          presentation={presentation}
          season={season ?? ''}
          leagueName={league.name}
          week={snapshot.periodLabel}
          headline={status?.headline ?? ''}
          playing={isPlaying}
          momentActive={momentActive}
          canReplay={closing !== null}
          onPlaySeason={playSeason}
          onPause={() => setPlaying(false)}
          onReplay={() => setCelebrate((c) => c + 1)}
        />
      )}

      {periods.length > 0 && (
        <footer className={styles.footer}>
          {newResults && !atEnd && (
            <button
              type="button"
              className={styles.newResults}
              onClick={() => goTo(lastIndex, false)}
            >
              New results <span aria-hidden="true">→</span> {periods[lastIndex]?.periodLabel}
            </button>
          )}
          <Scrubber
            labels={periods.map((p) => p.periodLabel)}
            index={shown}
            playing={isPlaying}
            onChange={(i) => {
              setPlaying(false);
              goTo(i);
            }}
            onTogglePlay={togglePlay}
          />
        </footer>
      )}
    </div>
  );
}
