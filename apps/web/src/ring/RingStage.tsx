import type { Game, SeasonTeam, Snapshot } from '@sports-parity/core';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Theme } from '../theme/tokens';
import { CIRCLE_BOTTOM_INSET, MINIMAP, RingRenderer, type FrameInfo } from './RingRenderer';
import { buildRingModel, REEL_CARD_GAP, reelCardWidth, type RingModel } from './scene';
import styles from './RingStage.module.css';

interface Props {
  teams: readonly SeasonTeam[];
  snapshot: Snapshot;
  games: ReadonlyMap<string, Game>;
  theme: Theme;
  /** Text alternative for the drawing in the circle view. */
  label: string;
  /** Team whose wins and losses are highlighted. */
  selected: number | null;
  onOpenTeam: (team: number) => void;
}

type View = 'circle' | 'reel';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Pinch distance ratio that zooms all the way between the circle and the reel. */
const PINCH_RANGE = Math.log(3);
const SWIPE_TO_DIVE_PX = 40;
const WHEEL_TO_DIVE = 50;
const TAP_SLOP_PX = 8;

const recordText = (s: Snapshot, i: number) => {
  const r = s.graph.records[i]!;
  return r.ties ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`;
};

/** Text for the overlay: cards, rim-edge game labels and break explanations. */
function useOverlayText(
  teams: readonly SeasonTeam[],
  snapshot: Snapshot,
  games: ReadonlyMap<string, Game>,
  model: RingModel,
) {
  return useMemo(() => {
    const { edges } = snapshot.graph;
    const cards = teams.map((team, i) => ({
      name: team.name,
      record: recordText(snapshot, i),
      wins: edges.filter((e) => e.winner === i).map((e) => teams[e.loser]!),
      losses: edges.filter((e) => e.loser === i).map((e) => teams[e.winner]!),
    }));
    const edgeText = model.edges.map(([u, v]) => {
      // The latest win of u over v.
      const edge = edges.findLast((e) => e.winner === u && e.loser === v);
      const game = edge ? games.get(edge.gameId) : undefined;
      const loser = teams[v]!.nickname;
      if (!game?.score) return `beat the ${loser}`;
      const home = game.home === teams[u]!.franchiseId;
      const [w, l] = home ? [game.score.home, game.score.away] : [game.score.away, game.score.home];
      return `beat the ${loser} ${w}–${l} · ${game.period.label}`;
    });
    const nextEdge = new Map(model.edges.map(([u], e) => [u, e]));
    const breakText = model.breaks.map((b) => {
      const after = teams[b.after]!.nickname;
      const before = teams[b.before]!.nickname;
      if (b.reason === 'winless') return `The ${after} haven't won a game yet`;
      if (b.reason === 'unbeaten') return `Nobody has beaten the ${before} yet`;
      return `No win from the ${after} over the ${before} yet`;
    });
    return { cards, edgeText, nextEdge, breakText };
  }, [teams, snapshot, games, model]);
}

/**
 * The ring and everything layered on it: the WebGL drawing, the DOM cards of the reel (which
 * are also the accessible version of the ring), the view controls and the gestures that move
 * between the full circle and the reel.
 */
export function RingStage({ teams, snapshot, games, theme, label, selected, onOpenTeam }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLOListElement>(null);
  const rendererRef = useRef<RingRenderer | null>(null);
  const teamEls = useRef<(HTMLLIElement | null)[]>([]);
  const breakEls = useRef<(HTMLLIElement | null)[]>([]);
  const edgeEls = useRef<(HTMLSpanElement | null)[]>([]);
  const [view, setView] = useState<View>('circle');
  const viewRef = useRef<View>('circle');
  const [drifting, setDrifting] = useState(false);

  const model = useMemo(() => buildRingModel(snapshot), [snapshot]);
  const text = useOverlayText(teams, snapshot, games, model);
  const latest = useRef({ teams, snapshot, model, selected });

  const syncDrift = useCallback(() => {
    setDrifting(rendererRef.current?.camera.drifting ?? false);
  }, []);

  /** Position the DOM overlay to match the frame just drawn. */
  const onFrame = useCallback((f: FrameInfo) => {
    const next: View = f.z > 0.5 ? 'reel' : 'circle';
    if (next !== viewRef.current) {
      viewRef.current = next;
      setView(next);
    }
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.opacity = String(clamp01((f.z - 0.55) / 0.35));
    if (f.z < 0.5) return;
    const cardWidth = reelCardWidth(f.layout.width);
    overlay.style.setProperty('--card-width', `${cardWidth}px`);
    const { width, height, nodeRadius: r } = f.layout;
    // Off-screen items stay in the accessibility tree and tab order (a focused card scrolls the
    // reel to itself), so they're parked transparent just inside the stage instead of hidden.
    const place = (el: HTMLElement | null | undefined, x: number, y: number, alpha = 1) => {
      if (!el) return;
      const onScreen = y > -80 && y < height + 80 && x > -cardWidth && x < width;
      const px = onScreen ? x : Math.min(Math.max(x, 0), width - cardWidth);
      const py = onScreen ? y : Math.min(Math.max(y, 40), height - 40);
      const opacity = onScreen ? alpha : 0;
      el.style.opacity = opacity >= 0.999 ? '' : opacity.toFixed(3);
      el.style.transform = `translate3d(${px}px, ${py}px, 0) translateY(-50%)`;
    };
    for (let i = 0; i < f.teamX.length; i++) {
      // Cards dim while their team travels, so passing cards don't pile up unreadably.
      const settled = f.teamSettled[i] ?? 1;
      place(teamEls.current[i], f.teamX[i]! + r + REEL_CARD_GAP, f.teamY[i]!, 0.3 + 0.7 * settled);
    }
    for (let b = 0; b < f.breakX.length; b++) {
      place(breakEls.current[b], f.breakX[b]! - r, f.breakY[b]!);
    }
    for (let e = 0; e < f.edgeX.length; e++) {
      place(edgeEls.current[e], f.edgeX[e]! + 12, f.edgeY[e]!, f.edgeAlpha[e] ?? 1);
    }
  }, []);

  // Create the renderer once per theme.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new RingRenderer(theme, prefersReducedMotion());
    let cancelled = false;
    void renderer.init(host).then(() => {
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      renderer.onFrame = onFrame;
      const { teams: t, snapshot: s, model: m, selected: sel } = latest.current;
      renderer.setData({ teams: t, snapshot: s, model: m });
      renderer.setSelected(sel);
    });
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [theme, onFrame]);

  useEffect(() => {
    latest.current = { ...latest.current, teams, snapshot, model };
    rendererRef.current?.setData({ teams, snapshot, model });
  }, [teams, snapshot, model]);

  useEffect(() => {
    latest.current = { ...latest.current, selected };
    rendererRef.current?.setSelected(selected);
  }, [selected]);

  const diveTo = useCallback(
    (team: number, drift: boolean) => {
      const r = rendererRef.current;
      const slot = latest.current.model.slotOfTeam[team];
      if (!r || slot === undefined) return;
      r.camera.dive(slot, drift);
      syncDrift();
    },
    [syncDrift],
  );

  /** The natural first step: start at the head of the main chain and let it drift. */
  const followChain = useCallback(() => {
    const head = latest.current.model.segments[0]?.[0];
    if (head !== undefined) diveTo(head, true);
  }, [diveTo]);

  const exitReel = useCallback(() => {
    rendererRef.current?.camera.exit();
    syncDrift();
  }, [syncDrift]);

  const toggleDrift = useCallback(() => {
    const cam = rendererRef.current?.camera;
    if (!cam) return;
    cam.setDrift(!cam.drifting);
    syncDrift();
  }, [syncDrift]);

  // Pointer gestures: drag scrolls the reel, a swipe up or a tap on a team dives in, and a
  // pinch zooms between the two views.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'pending' | 'drag' | 'pinch' = 'none';
    let start = { x: 0, y: 0 };
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dived = false;
    let pinchStart = { dist: 1, z: 0 };
    let wheelAccum = 0;
    let wheelPinchTimer = 0;

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = stage.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const inReel = () => (rendererRef.current?.camera.zTarget ?? 0) === 1;
    const pinchDistance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
    };
    const fromControl = (target: EventTarget | null) =>
      target instanceof Element && target.closest('button, a, input, select') !== null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = rendererRef.current;
      if (!r) return;
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        mode = 'pending';
        start = local(e);
        lastY = start.y;
        lastT = e.timeStamp;
        velocity = 0;
        dived = false;
      } else if (pointers.size === 2) {
        mode = 'pinch';
        const [a, b] = [...pointers.values()];
        if (r.camera.z < 0.02 && a && b) {
          // Zoom toward the part of the ring between the fingers.
          r.camera.dive(r.slotToward((a.x + b.x) / 2, (a.y + b.y) / 2), false);
          r.camera.z = 0;
        }
        pinchStart = { dist: pinchDistance(), z: r.camera.z };
        r.camera.pinch(pinchStart.z);
        for (const id of pointers.keys()) stage.setPointerCapture(id);
        syncDrift();
      }
    };

    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r || !pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (mode === 'pinch') {
        r.camera.pinch(pinchStart.z + Math.log(pinchDistance() / pinchStart.dist) / PINCH_RANGE);
        return;
      }
      if (mode === 'pending') {
        if (Math.hypot(p.x - start.x, p.y - start.y) < TAP_SLOP_PX) return;
        mode = 'drag';
        stage.setPointerCapture(e.pointerId);
        if (inReel()) {
          r.camera.grab();
          syncDrift();
        }
      }
      if (mode !== 'drag') return;
      if (inReel()) {
        const dy = p.y - lastY;
        const dt = Math.max(1, e.timeStamp - lastT) / 1000;
        const slots = -dy / r.reelSpacing(); // dragging up moves forward along the chain
        r.camera.drag(slots);
        velocity = 0.7 * velocity + 0.3 * (slots / dt);
      } else if (!dived && start.y - p.y > SWIPE_TO_DIVE_PX) {
        dived = true;
        followChain();
      }
      lastY = p.y;
      lastT = e.timeStamp;
    };

    const onUp = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r || !pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.delete(e.pointerId);
      if (mode === 'pinch') {
        if (pointers.size === 0) {
          r.camera.endPinch();
          mode = 'none';
          syncDrift();
        }
        return;
      }
      if (mode === 'drag' && inReel()) {
        // A finger that stopped before lifting shouldn't fling.
        const fresh = e.timeStamp - lastT < 80;
        r.camera.release(fresh ? velocity : 0);
      } else if (mode === 'pending' && !fromControl(e.target)) {
        const team = r.teamAt(p.x, p.y);
        if (team !== null) {
          if (inReel()) onOpenTeam(team);
          else diveTo(team, false);
        }
      }
      mode = 'none';
    };

    const onWheel = (e: WheelEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (e.ctrlKey) {
        // Trackpad pinch arrives as ctrl + wheel.
        if (r.camera.z < 0.02 && dy < 0) {
          const p = local(e);
          r.camera.dive(r.slotToward(p.x, p.y), false);
          r.camera.z = 0;
        }
        r.camera.pinch(r.camera.z - dy * 0.012);
        window.clearTimeout(wheelPinchTimer);
        wheelPinchTimer = window.setTimeout(() => {
          r.camera.endPinch();
          syncDrift();
        }, 160);
      } else if (inReel()) {
        r.camera.nudge(dy / r.reelSpacing());
      } else {
        wheelAccum = Math.max(0, wheelAccum + dy);
        if (wheelAccum > WHEEL_TO_DIVE) {
          wheelAccum = 0;
          followChain();
        }
      }
      syncDrift();
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.clearTimeout(wheelPinchTimer);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('wheel', onWheel);
    };
  }, [diveTo, followChain, onOpenTeam, syncDrift]);

  // Keys: ↓ dives in from the circle; in the reel ↑/↓ step along the chain and Esc zooms out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (document.querySelector('dialog[open]')) return;
      const r = rendererRef.current;
      if (!r) return;
      const reel = r.camera.zTarget === 1;
      if (e.key === 'Escape' && reel) exitReel();
      else if (e.key === 'ArrowDown' && !reel) followChain();
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && reel) {
        r.camera.stepBy(e.key === 'ArrowDown' ? 1 : -1);
        syncDrift();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitReel, followChain, syncDrift]);

  const focusSlot = (slot: number) => {
    rendererRef.current?.camera.goTo(slot);
    syncDrift();
  };

  const closed = model.closed;
  return (
    <div
      ref={stageRef}
      className={styles.stage}
      data-view={view}
      style={{ '--circle-inset': `${CIRCLE_BOTTOM_INSET}px` } as CSSProperties}
    >
      <div
        ref={hostRef}
        className={styles.host}
        role="img"
        aria-label={label}
        aria-hidden={view === 'reel'}
      />

      <ol
        ref={overlayRef}
        className={styles.overlay}
        aria-label={closed ? 'The circle, team by team' : 'The chains, team by team'}
        inert={view !== 'reel'}
      >
        {model.slots.map((slot) => {
          if (slot.kind === 'break') {
            const b = slot.index;
            return (
              <li
                key={`break-${b}`}
                ref={(el) => {
                  breakEls.current[b] = el;
                }}
                className={styles.break}
              >
                <span className={styles.breakTitle}>Chain breaks</span>
                <span>{text.breakText[b]}</span>
              </li>
            );
          }
          const i = slot.team;
          const card = text.cards[i]!;
          const e = text.nextEdge.get(i);
          return (
            <li
              key={teams[i]!.franchiseId}
              ref={(el) => {
                teamEls.current[i] = el;
              }}
              className={styles.card}
            >
              <button
                type="button"
                className={styles.cardButton}
                onClick={() => onOpenTeam(i)}
                onFocus={() => focusSlot(model.slotOfTeam[i]!)}
                aria-label={`${card.name}, ${card.record}.${e === undefined ? '' : ` Then ${text.edgeText[e]}.`} Show results.`}
              >
                <span className={styles.cardTop}>
                  <span className={styles.name}>{card.name}</span>
                  <span className={styles.record}>{card.record}</span>
                </span>
                <span className={styles.clumps} aria-hidden="true">
                  <Clump letter="W" teams={card.wins} />
                  <Clump letter="L" teams={card.losses} />
                </span>
              </button>
            </li>
          );
        })}
        {model.edges.map(([u, v], e) => (
          <li key={`edge-${teams[u]!.franchiseId}-${teams[v]!.franchiseId}`} aria-hidden="true">
            <span
              ref={(el) => {
                edgeEls.current[e] = el;
              }}
              className={styles.edge}
            >
              ↓ {text.edgeText[e]}
            </span>
          </li>
        ))}
      </ol>

      {view === 'circle' ? (
        <button type="button" className={styles.follow} onClick={followChain}>
          {closed ? 'Follow the circle' : 'Follow the chain'} <span aria-hidden="true">↓</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className={styles.minimap}
            style={{ left: MINIMAP.x - 26, top: MINIMAP.y - 26 }}
            onClick={exitReel}
            aria-label="Back to the full circle"
            title="Full circle (Esc)"
          />
          <button
            type="button"
            className={styles.drift}
            onClick={toggleDrift}
            aria-pressed={drifting}
          >
            {drifting ? (
              <>
                <span aria-hidden="true">❚❚</span> Pause
              </>
            ) : (
              <>
                <span aria-hidden="true">▶</span> Auto-scroll
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

function Clump({ letter, teams }: { letter: string; teams: readonly SeasonTeam[] }) {
  return (
    <span className={styles.clump}>
      <span className={styles.clumpLetter}>{letter}</span>
      {teams.map((t, k) => (
        <span key={k} className={styles.dot} style={{ background: t.colors.primary }} />
      ))}
    </span>
  );
}
