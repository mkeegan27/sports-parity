import type { SeasonTeam, Snapshot } from '@sports-parity/core';
import { AdvancedBloomFilter } from 'pixi-filters';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { hexToNumber, readableTextOn, type Theme } from '../theme/tokens';
import { ClosingMoment, type MomentFrame } from './moment';
import {
  blendLayout,
  MARKER_MOTION,
  ReelCamera,
  RingBodies,
  reelLayout,
  ringLayout,
  slotAngle,
  slotAngles,
  smoothstep,
  type RingLayout,
  type RingModel,
} from './scene';

interface NodeView {
  root: Container;
  halo: Graphics;
  disc: Graphics;
  record: Graphics;
  label: Text;
}

interface NodeStyle {
  color: number;
  pct: number;
  unbeaten: boolean;
  alpha: number;
}

export interface RingData {
  /** Teams in graph-index order (snapshot indices refer to these). */
  teams: readonly SeasonTeam[];
  snapshot: Snapshot;
  model: RingModel;
}

/** Screen positions after each frame, for the DOM overlay. Arrays are reused between frames. */
export interface FrameInfo {
  z: number;
  layout: RingLayout;
  teamX: Float32Array;
  teamY: Float32Array;
  /** 1 when a team is in its slot, falling toward 0 while it travels. */
  teamSettled: Float32Array;
  /** Indexed like model.breaks. */
  breakX: Float32Array;
  breakY: Float32Array;
  /** Midpoint of each rim edge, indexed like model.edges. */
  edgeX: Float32Array;
  edgeY: Float32Array;
  /** Rim edges fade in once both teams have arrived. */
  edgeAlpha: Float32Array;
  /** The closing moment, in screen coordinates (the push-in moves the drawing). */
  moment: {
    active: boolean;
    caption: number;
    headline: number;
    /** Midpoint of the closing link. */
    captionX: number;
    captionY: number;
    /** Center of the ring. */
    centerX: number;
    centerY: number;
  };
}

/** Bloom settings at rest; the closing moment raises them briefly. */
const BLOOM = { scale: 1.1, brightness: 1 };

const TAU = Math.PI * 2;
/** Space kept under the circle for the "Follow the chain" button. */
export const CIRCLE_BOTTOM_INSET = 64;
/** Labels are rasterized at this node radius and scaled, so zooming never re-renders text. */
const LABEL_BASE_RADIUS = 26;
/** Where wins leave and losses arrive on a node, in radians either side of facing inward. */
const PORT_ANGLE = 0.75;
const CHORD_SAMPLES = 14;
/** Mini-map position and size (screen space, top left). */
export const MINIMAP = { x: 40, y: 40, r: 19 };

const wrapPi = (a: number) => a - Math.round(a / TAU) * TAU;

/**
 * Draws the ring with Pixi (WebGL). It owns no app state: callers push data with `setData`,
 * steer the camera, and advance time with `tick(dt)`. Driving time explicitly is what makes
 * frame-exact export possible.
 */
export class RingRenderer {
  readonly app = new Application();
  readonly camera: ReelCamera;
  /** Called after every frame with screen positions for the overlay. */
  onFrame: ((frame: FrameInfo) => void) | null = null;

  private readonly world = new Container();
  private readonly chords = new Graphics();
  private readonly glow = new Container();
  private readonly rim = new Graphics();
  private readonly flow = new Graphics();
  /** The closing moment's pulse and team flashes. */
  private readonly flash = new Graphics();
  private bloom: AdvancedBloomFilter | null = null;
  private readonly moment: ClosingMoment;
  private momentFrame: MomentFrame = new ClosingMoment().update(0, true);
  /** The closing link as [winner, loser], and its index in model.edges (-1 if none). */
  private closing: [number, number] | null = null;
  private closingEdge = -1;
  private readonly nodeLayer = new Container();
  private readonly minimap = new Graphics();
  private nodes: NodeView[] = [];
  private styles: NodeStyle[] = [];
  private bodies = new RingBodies(0);
  private markers = new RingBodies(0, MARKER_MOTION);
  private angles = new Float64Array(0);
  private data: RingData | null = null;
  private teamKey = '';
  private selected: number | null = null;
  /** Teams in the results a path needs (round 11 #3), ringed in the accent color. */
  private marked = new Set<number>();
  /** Rim links that exist only in a scenario (keys winner * 64 + loser): drawn dashed. */
  private simulatedRim = new Set<number>();
  private time = 0;
  private drawnRadius = -1;
  private chordsDirty = true;
  private ready = false;
  private resizeObserver: ResizeObserver | null = null;
  private frame: FrameInfo = {
    z: 0,
    layout: ringLayout(1, 1, 1),
    teamX: new Float32Array(0),
    teamY: new Float32Array(0),
    teamSettled: new Float32Array(0),
    breakX: new Float32Array(0),
    breakY: new Float32Array(0),
    edgeX: new Float32Array(0),
    edgeY: new Float32Array(0),
    edgeAlpha: new Float32Array(0),
    moment: {
      active: false,
      caption: 0,
      headline: 0,
      captionX: 0,
      captionY: 0,
      centerX: 0,
      centerY: 0,
    },
  };

  constructor(
    private readonly theme: Theme,
    private readonly reducedMotion: boolean,
  ) {
    this.camera = new ReelCamera(1, reducedMotion);
    this.moment = new ClosingMoment(reducedMotion);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      antialias: true,
      background: this.theme.color.bg,
      resolution: Math.min(window.devicePixelRatio || 1, 3),
      autoDensity: true,
      preserveDrawingBuffer: true,
    });
    this.app.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.app.canvas);

    this.glow.addChild(this.rim, this.flow, this.flash);
    this.world.addChild(this.chords, this.glow, this.nodeLayer);
    this.app.stage.addChild(this.world, this.minimap);
    // Bloom over the whole screen, so its bounds never show as a box behind the ring.
    this.bloom = new AdvancedBloomFilter({
      threshold: 0.15,
      bloomScale: BLOOM.scale,
      brightness: BLOOM.brightness,
      blur: 8,
      quality: 5,
    });
    this.glow.filters = [this.bloom];
    this.glow.filterArea = this.app.screen;

    this.app.renderer.on('resize', () => {
      this.chordsDirty = true;
    });
    // Pixi's resizeTo only listens to window resizes; layout changes resize the host too.
    this.resizeObserver = new ResizeObserver(() => this.app.resize());
    this.resizeObserver.observe(host);
    this.app.ticker.add((ticker) => this.tick(Math.min(ticker.deltaMS / 1000, 0.1)));
    this.ready = true;
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    if (this.ready) this.app.destroy(true, { children: true });
    this.ready = false;
  }

  setData(data: RingData): void {
    const key = data.teams.map((t) => t.franchiseId).join();
    const newTeams = key !== this.teamKey;
    const oldModel = this.data?.model;
    this.data = data;
    if (newTeams) {
      this.teamKey = key;
      this.buildNodes(data.teams);
    }
    // Keep the focused team in place while the slots change under it: whatever the camera
    // rotation changes by, the bodies absorb, so nothing jumps.
    const rotationBefore = this.camera.rotation();
    if (oldModel && !newTeams) this.camera.remap(oldModel, data.model);
    else this.camera.slotCount = data.model.slots.length;
    const absorb = rotationBefore - this.camera.rotation();
    const { model } = data;
    const step = this.camera.stepAngle;
    if (!newTeams) this.bodies.shift(absorb);
    this.bodies.setTargets(slotAngles(model), step, newTeams || this.reducedMotion);
    // Break markers glide too. They have no identity across weeks beyond their index, so a
    // change in how many there are just places them.
    const breakTargets = Float64Array.from(model.breaks, (_, b) =>
      slotAngle(model.slotOfBreak[b]!, model.slots.length),
    );
    const sameBreaks = this.markers.count === breakTargets.length && !newTeams;
    if (sameBreaks) this.markers.shift(absorb);
    else this.markers = new RingBodies(breakTargets.length, MARKER_MOTION);
    this.markers.setTargets(breakTargets, step, !sameBreaks || this.reducedMotion);
    this.styleNodes();
    this.findClosingEdge();
    const real = new Set<number>();
    const simulated = new Set<number>();
    for (const e of data.snapshot.graph.edges) {
      (e.simulated ? simulated : real).add(e.winner * 64 + e.loser);
    }
    this.simulatedRim = new Set([...simulated].filter((k) => !real.has(k)));
    this.chordsDirty = true;
  }

  /** Ring these teams (or none). */
  setMarked(teams: readonly number[]): void {
    const next = new Set(teams);
    if (next.size === this.marked.size && [...next].every((t) => this.marked.has(t))) return;
    this.marked = next;
    this.drawnRadius = -1;
  }

  /** Play the closing moment for the link `winner` -> `loser` (the game that closed the circle). */
  playClosing(winner: number, loser: number): void {
    this.closing = [winner, loser];
    this.findClosingEdge();
    if (this.closingEdge < 0) return;
    if (this.camera.z > 0) this.camera.exit();
    this.moment.start();
  }

  /** Jump to the end of the closing moment. */
  skipMoment(): void {
    this.moment.skip();
  }

  get momentActive(): boolean {
    return this.moment.active;
  }

  private findClosingEdge(): void {
    const edges = this.data?.model.edges ?? [];
    const c = this.closing;
    this.closingEdge = c ? edges.findIndex(([u, v]) => u === c[0] && v === c[1]) : -1;
    // A week without that link (scrubbed away mid-moment) ends the moment.
    if (this.closingEdge < 0) this.moment.skip();
  }

  /** Highlight a team's wins and losses (or clear with null). */
  setSelected(team: number | null): void {
    this.selected = team;
    this.chordsDirty = true;
  }

  /** Slot spacing in the reel, in pixels: converts drags to scroll distance. */
  reelSpacing(): number {
    const { width, height } = this.app.screen;
    const slots = this.camera.slotCount;
    return (reelLayout(width, height, slots).radius * TAU) / Math.max(slots, 1);
  }

  /** The team drawn under a point, if any. */
  teamAt(x: number, y: number): number | null {
    const { teamX, teamY, layout } = this.frame;
    let best: number | null = null;
    let bestD = (layout.nodeRadius + 10) ** 2;
    for (let i = 0; i < teamX.length; i++) {
      const d = (teamX[i]! - x) ** 2 + (teamY[i]! - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** The slot nearest the direction of a point from the ring's center. */
  slotToward(x: number, y: number): number {
    const { cx, cy } = this.frame.layout;
    const n = Math.max(this.camera.slotCount, 1);
    const angle = Math.atan2(y - cy, x - cx) - this.camera.rotation();
    const k = Math.round(((angle + Math.PI / 2) / TAU) * n);
    return ((k % n) + n) % n;
  }

  private layoutFor(z: number): RingLayout {
    const { width, height } = this.app.screen;
    const slots = Math.max(this.camera.slotCount, 1);
    const circle = ringLayout(width, height, slots, CIRCLE_BOTTOM_INSET);
    if (z <= 0) return circle;
    return blendLayout(circle, reelLayout(width, height, slots), z);
  }

  /** Advance the scene by dt seconds and redraw. */
  tick(dt: number): void {
    if (!this.ready || !this.data) return;
    this.time += dt;
    const cameraMoving = this.camera.update(dt);
    const layout = this.layoutFor(this.camera.z);
    this.frame.layout = layout;
    this.frame.z = this.camera.z;
    // Collisions are measured in node radii, so they hold at every zoom.
    const slotWidth = (layout.radius * this.camera.stepAngle) / layout.nodeRadius;
    const bodiesMoving = this.bodies.step(dt, slotWidth);
    const markersMoving = this.markers.step(dt);

    const rotation = this.camera.rotation();
    for (let i = 0; i < this.angles.length; i++) this.angles[i] = this.bodies.angle[i]! + rotation;

    if (Math.abs(layout.nodeRadius - this.drawnRadius) > 0.05) this.drawNodes(layout.nodeRadius);
    this.placeNodes(layout);
    this.placeMarkers(layout, rotation);
    let settled = true;
    for (let i = 0; i < this.bodies.count; i++) {
      if (this.bodies.remaining(i) > 0.05) settled = false;
    }
    const mf = this.moment.update(dt, settled);
    // Redraw the chords once more when the moment ends (or is skipped): they were quieted.
    if (this.momentFrame.active && !mf.active) this.chordsDirty = true;
    this.momentFrame = mf;
    this.pushIn(layout, mf.push);
    if (this.bloom) {
      this.bloom.bloomScale = BLOOM.scale + 1.8 * mf.bloom;
      this.bloom.brightness = BLOOM.brightness + 0.4 * mf.bloom;
    }
    const moving = cameraMoving || bodiesMoving || markersMoving || mf.active;
    if (moving || this.chordsDirty) this.drawChords(layout);
    this.chordsDirty = false;
    this.drawRim(layout);
    this.drawLap(layout, mf.lap);
    this.drawMinimap(layout);
    this.describeMoment(layout, mf);
    this.onFrame?.(this.frame);
  }

  private buildNodes(teams: readonly SeasonTeam[]): void {
    this.nodeLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.bodies = new RingBodies(teams.length);
    this.angles = new Float64Array(teams.length);
    this.frame.teamX = new Float32Array(teams.length);
    this.frame.teamY = new Float32Array(teams.length);
    this.frame.teamSettled = new Float32Array(teams.length);
    this.nodes = teams.map(() => {
      const root = new Container();
      const halo = new Graphics();
      const disc = new Graphics();
      const record = new Graphics();
      const label = new Text({
        text: '',
        style: { fontFamily: this.theme.font.body, fontWeight: '700', fill: 0xffffff },
      });
      label.anchor.set(0.5);
      root.addChild(halo, disc, record, label);
      this.nodeLayer.addChild(root);
      return { root, halo, disc, record, label };
    });
  }

  /** Per-team visuals that change with data, not every frame. */
  private styleNodes(): void {
    if (!this.data) return;
    const { teams, snapshot, model } = this.data;
    const unbeaten = new Set(snapshot.blockers.unbeaten);
    const winless = new Set(snapshot.blockers.winless);
    this.styles = teams.map((team, i) => {
      const rec = snapshot.graph.records[i]!;
      const games = rec.wins + rec.losses + rec.ties;
      const view = this.nodes[i]!;
      view.label.text = team.abbr;
      view.label.style.fontSize = Math.round(
        LABEL_BASE_RADIUS * (team.abbr.length > 2 ? 0.66 : 0.78),
      );
      view.label.style.fill = readableTextOn(team.colors.primary);
      return {
        color: hexToNumber(team.colors.primary),
        pct: games === 0 ? 0 : (rec.wins + rec.ties / 2) / games,
        unbeaten: unbeaten.has(i) && games > 0,
        alpha: winless.has(i) && games > 0 ? 0.45 : 1,
      };
    });
    this.frame.breakX = new Float32Array(model.breaks.length);
    this.frame.breakY = new Float32Array(model.breaks.length);
    this.frame.edgeX = new Float32Array(model.edges.length);
    this.frame.edgeY = new Float32Array(model.edges.length);
    this.frame.edgeAlpha = new Float32Array(model.edges.length);
    this.drawnRadius = -1;
  }

  /** Node shapes at radius r. Only redrawn while the zoom changes the radius. */
  private drawNodes(r: number): void {
    this.drawnRadius = r;
    const muted = hexToNumber(this.theme.color.textMuted);
    const gold = hexToNumber(this.theme.color.unbeaten);
    const accent = hexToNumber(this.theme.color.accent);
    const ringWidth = Math.max(2.5, r * 0.11);
    this.nodes.forEach((view, i) => {
      const style = this.styles[i];
      if (!style) return;
      view.halo.clear();
      if (style.unbeaten) view.halo.circle(0, 0, r + 7).fill({ color: gold, alpha: 0.35 });
      if (this.marked.has(i)) {
        view.halo.circle(0, 0, r + ringWidth + 3).stroke({ width: 1.5, color: accent, alpha: 0.9 });
      }
      view.disc.clear().circle(0, 0, r).fill({ color: style.color });
      const rr = r + ringWidth / 2 + 1.5;
      view.record.clear().circle(0, 0, rr).stroke({ width: ringWidth, color: muted, alpha: 0.25 });
      if (style.pct > 0) {
        view.record
          .moveTo(0, -rr)
          .arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + TAU * style.pct)
          .stroke({ width: ringWidth, color: 0xffffff, alpha: 0.9 });
      }
      view.label.scale.set(r / LABEL_BASE_RADIUS);
      view.root.alpha = style.alpha;
    });
  }

  private placeNodes(layout: RingLayout): void {
    const { cx, cy, radius, nodeRadius } = layout;
    const { teamX, teamY, teamSettled } = this.frame;
    this.nodes.forEach((view, i) => {
      const a = this.angles[i]!;
      // Travelling teams ride a lane just inside or outside the rim.
      const rr = Math.max(nodeRadius, radius + this.bodies.lift[i]! * nodeRadius);
      teamX[i] = cx + Math.cos(a) * rr;
      teamY[i] = cy + Math.sin(a) * rr;
      teamSettled[i] = 1 - smoothstep(0.05, 0.5, this.bodies.remaining(i));
      view.root.position.set(teamX[i]!, teamY[i]!);
    });
  }

  /** Break slots and rim-edge midpoints, for the overlay's cards and labels. */
  private placeMarkers(layout: RingLayout, rotation: number): void {
    const { model } = this.data!;
    const { cx, cy, radius } = layout;
    const slots = model.slots.length;
    model.breaks.forEach((_, b) => {
      const a = (this.markers.angle[b] ?? slotAngle(model.slotOfBreak[b]!, slots)) + rotation;
      this.frame.breakX[b] = cx + Math.cos(a) * radius;
      this.frame.breakY[b] = cy + Math.sin(a) * radius;
    });
    model.edges.forEach(([u, v], e) => {
      const a0 = this.angles[u]!;
      const a = a0 + wrapPi(this.angles[v]! - a0) / 2;
      this.frame.edgeX[e] = cx + Math.cos(a) * radius;
      this.frame.edgeY[e] = cy + Math.sin(a) * radius;
      this.frame.edgeAlpha[e] = Math.min(this.frame.teamSettled[u]!, this.frame.teamSettled[v]!);
    });
  }

  /**
   * Faint chords for every win that isn't on the rim. Tapered (wide at the winner) and split by
   * side, so each team shows one clump of wins and one of losses.
   */
  private drawChords(layout: RingLayout): void {
    const { snapshot, model } = this.data!;
    const { cx, cy, nodeRadius: r, width, height } = layout;
    const { teamX, teamY } = this.frame;
    const onRim = new Set(model.edges.map(([u, v]) => u * 64 + v));
    const seen = new Set<number>();
    const sel = this.selected;
    const z = this.camera.z;
    const wide = Math.max(1.8, r * 0.2);
    const narrow = 0.35;
    const pad = Math.max(width, height) * 0.3;
    const offscreen = (i: number) =>
      teamY[i]! < -pad || teamY[i]! > height + pad || teamX[i]! < -pad || teamX[i]! > width + pad;

    const groups = { rest: [] as number[][], wins: [] as number[][], losses: [] as number[][] };
    for (const e of snapshot.graph.edges) {
      const key = e.winner * 64 + e.loser;
      if (onRim.has(key) || seen.has(key)) continue;
      seen.add(key);
      const u = e.winner;
      const v = e.loser;
      if (z > 0.5 && offscreen(u) && offscreen(v)) continue;
      // Facing inward, the clockwise side is toward the next team in ring order (below, in the
      // reel), matching "beat the team after me". Wins leave there; losses arrive opposite.
      const a = this.port(u, -PORT_ANGLE, r);
      const b = this.port(v, PORT_ANGLE, r);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const c = { x: cx + (mx - cx) * 0.25, y: cy + (my - cy) * 0.25 };
      const poly = taperedCurve(a, c, b, wide, narrow);
      if (sel === u) groups.wins.push(poly);
      else if (sel === v) groups.losses.push(poly);
      else groups.rest.push(poly);
    }

    this.chords.clear();
    const fill = (polys: number[][], color: string, alpha: number) => {
      if (polys.length === 0) return;
      for (const p of polys) this.chords.poly(p, true);
      this.chords.fill({ color: hexToNumber(color), alpha });
    };
    // The push-in quiets the chords so the closing link stands out.
    const quiet = 1 - 0.75 * this.momentFrame.push;
    fill(groups.rest, this.theme.color.chord, (sel === null ? 0.2 : 0.07) * quiet);
    fill(groups.wins, this.theme.color.win, 0.8);
    fill(groups.losses, this.theme.color.loss, 0.8);
  }

  /** A point on a node's edge, `side` radians from facing the ring's center (+ is screen clockwise). */
  private port(team: number, side: number, r: number) {
    const a = this.angles[team]! + Math.PI + side;
    return {
      x: this.frame.teamX[team]! + Math.cos(a) * (r + 2),
      y: this.frame.teamY[team]! + Math.sin(a) * (r + 2),
    };
  }

  /** Ring edges along the rim with arrowheads, plus particles flowing winner -> loser. */
  private drawRim(layout: RingLayout): void {
    const { model } = this.data!;
    const { cx, cy, radius, nodeRadius } = layout;
    const color = hexToNumber(this.theme.color.ring);
    const accent = hexToNumber(this.theme.color.accent);
    const pad = (nodeRadius + 2.5) / radius;
    const arrow = Math.min(11, Math.max(5, nodeRadius * 0.45));
    const width = Math.max(2.5, nodeRadius * 0.12);
    const dot = Math.max(1.8, nodeRadius * 0.1);
    const point = (a: number) => ({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    this.rim.clear();
    this.flow.clear();
    const mf = this.momentFrame;
    model.edges.forEach(([u, v], e) => {
      // During the moment the closing link waits, then draws in from the winner.
      const closing = mf.active && e === this.closingEdge;
      const drawn = closing ? mf.draw : 1;
      const alpha = closing ? (drawn > 0 ? 1 : 0) : this.frame.edgeAlpha[e]!;
      if (alpha < 0.01) return;
      const a0 = this.angles[u]!;
      const delta = wrapPi(this.angles[v]! - a0); // shortest way round
      const dir = Math.sign(delta) || 1;
      const span = Math.abs(delta) - 2 * pad;
      if (span <= 0.002) return;
      const start = a0 + dir * pad;
      const end = start + dir * span * drawn;
      // A would-be link (a scenario's result, not a real one) is dashed and carries no flow.
      const wouldBe = this.simulatedRim.has(u * 64 + v);
      if (wouldBe) {
        const dash = (width * 3) / radius;
        for (let a = 0; a < span * drawn; a += dash * 2) {
          const from = start + dir * a;
          const to = start + dir * Math.min(a + dash, span * drawn);
          const p = point(from);
          this.rim.moveTo(p.x, p.y).arc(cx, cy, radius, from, to, dir < 0);
        }
        this.rim.stroke({ width, color: accent, alpha: alpha });
      } else {
        const s = point(start);
        this.rim
          .moveTo(s.x, s.y)
          .arc(cx, cy, radius, start, end, dir < 0)
          .stroke({ width, color, alpha: 0.85 * alpha });
      }
      // Arrowhead at the loser's end, pointing along the direction of travel.
      const tip = point(end);
      const tangent = end + (dir * Math.PI) / 2;
      const back = { x: tip.x - Math.cos(tangent) * arrow, y: tip.y - Math.sin(tangent) * arrow };
      const nx = Math.cos(end) * arrow * 0.55;
      const ny = Math.sin(end) * arrow * 0.55;
      this.rim
        .moveTo(tip.x, tip.y)
        .lineTo(back.x + nx, back.y + ny)
        .lineTo(back.x - nx, back.y - ny)
        .closePath()
        .fill({ color: wouldBe ? accent : color, alpha: 0.95 * alpha });

      if (!this.reducedMotion && drawn >= 1 && !wouldBe) {
        for (let k = 0; k < 2; k++) {
          const f = (this.time * 0.45 + k / 2) % 1;
          const p = point(start + dir * span * f);
          this.flow
            .circle(p.x, p.y, dot)
            .fill({ color: 0xffffff, alpha: Math.sin(f * Math.PI) * 0.9 * alpha });
        }
      }
    });
  }

  /** Scale the drawing about the closing link's midpoint, bringing it toward the middle. */
  private pushIn(layout: RingLayout, push: number): void {
    const c = this.closing;
    if (push <= 0 || !c || this.closingEdge < 0) {
      this.world.scale.set(1);
      this.world.position.set(0, 0);
      return;
    }
    const { cx, cy, radius, nodeRadius, width, height } = layout;
    const a0 = this.bodies.angle[c[0]]!;
    const mid = a0 + wrapPi(this.bodies.angle[c[1]]! - a0) / 2 + this.camera.rotation();
    const fx = cx + Math.cos(mid) * radius;
    const fy = cy + Math.sin(mid) * radius;
    // Zoom until the link and its two teams span about 40% of the screen.
    const linkLength = radius * this.camera.stepAngle + 4 * nodeRadius;
    const full = Math.min(3.5, Math.max(1.2, (Math.min(width, height) * 0.4) / linkLength));
    const scale = 1 + (full - 1) * push;
    // Frame the link a little off center, away from the ring's middle, which leaves the inner
    // side (where the caption goes) clear.
    const ix = Math.cos(mid + Math.PI);
    const iy = Math.sin(mid + Math.PI);
    const tx = width / 2 - ix * width * 0.2;
    const ty = height * 0.45 - iy * height * 0.12;
    const sx = fx + (tx - fx) * push;
    const sy = fy + (ty - fy) * push;
    this.world.scale.set(scale);
    this.world.position.set(sx - fx * scale, sy - fy * scale);
  }

  /** The pulse's lap round the ring, from the closing link's winner, lighting each team. */
  private drawLap(layout: RingLayout, lap: number): void {
    const g = this.flash.clear();
    const c = this.closing;
    if (lap < 0 || !c) return;
    const { cx, cy, radius, nodeRadius: r } = layout;
    const start = this.angles[c[0]]!;
    const head = start + TAU * lap;
    // A comet: a bright head with a fading tail behind it along the rim.
    const tail = 0.45;
    for (let k = 12; k >= 0; k--) {
      const a = head - (tail * k) / 12;
      if (a < start) continue;
      const f = 1 - k / 12;
      g.circle(
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        Math.max(2, r * 0.32) * (0.4 + 0.6 * f),
      ).fill({
        color: 0xffffff,
        alpha: 0.15 + 0.85 * f * f,
      });
    }
    // Each team flashes as the pulse reaches it (the first team again as the lap completes).
    const flashAt = (x: number) => (x >= 0 ? Math.exp(-x * 14) : 0);
    const { teamX, teamY } = this.frame;
    for (let i = 0; i < this.angles.length; i++) {
      const d = ((((this.angles[i]! - start) % TAU) + TAU) % TAU) / TAU;
      const f = Math.max(flashAt(lap - d), flashAt(lap - d - 1));
      if (f < 0.02) continue;
      g.circle(teamX[i]!, teamY[i]!, r + 4 + 3 * f).stroke({
        width: 2.5,
        color: 0xffffff,
        alpha: f,
      });
    }
  }

  /** Screen positions for the moment's words, for the overlay. */
  private describeMoment(layout: RingLayout, mf: MomentFrame): void {
    const m = this.frame.moment;
    const scale = this.world.scale.x;
    const { x: ox, y: oy } = this.world.position;
    m.active = mf.active;
    m.caption = mf.caption;
    m.headline = mf.headline;
    m.centerX = ox + layout.cx * scale;
    m.centerY = oy + layout.cy * scale;
    const e = this.closingEdge;
    if (e >= 0) {
      m.captionX = ox + this.frame.edgeX[e]! * scale;
      m.captionY = oy + this.frame.edgeY[e]! * scale;
    }
  }

  /** In the reel: a small circle showing which part of the ring is on screen. */
  private drawMinimap(layout: RingLayout): void {
    const g = this.minimap.clear();
    const z = this.camera.z;
    if (z < 0.01 || !this.data) return;
    const { model } = this.data;
    const { x, y, r } = MINIMAP;
    const n = Math.max(model.slots.length, 1);
    g.circle(x, y, r + 7)
      .fill({ color: hexToNumber(this.theme.color.surface), alpha: 0.92 * z })
      .stroke({ width: 1, color: hexToNumber(this.theme.color.border), alpha: z });
    g.circle(x, y, r).stroke({
      width: 1,
      color: hexToNumber(this.theme.color.ring),
      alpha: 0.3 * z,
    });
    for (let i = 0; i < model.teamCount; i++) {
      const a = slotAngle(model.slotOfTeam[i]!, n);
      g.circle(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.7).fill({
        color: this.styles[i]?.color ?? 0xffffff,
        alpha: z,
      });
    }
    // The visible window of the reel, centered on the scroll position.
    const reel = reelLayout(layout.width, layout.height, n);
    const half = Math.min(Math.PI, layout.height / 2 / reel.radius);
    const center = slotAngle(this.camera.pos, n);
    g.moveTo(x + Math.cos(center - half) * r, y + Math.sin(center - half) * r)
      .arc(x, y, r, center - half, center + half)
      .stroke({ width: 4, color: hexToNumber(this.theme.color.accent), alpha: 0.85 * z });
  }
}

/**
 * A quadratic curve a -> c -> b as a filled polygon whose width tapers from `w0` at a to `w1`
 * at b. Returned as a flat [x, y, ...] list.
 */
function taperedCurve(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  w0: number,
  w1: number,
): number[] {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i <= CHORD_SAMPLES; i++) {
    const t = i / CHORD_SAMPLES;
    const mt = 1 - t;
    const x = mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x;
    const y = mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y;
    // Derivative of the quadratic gives the tangent; its normal offsets the two sides.
    const dx = 2 * mt * (c.x - a.x) + 2 * t * (b.x - c.x);
    const dy = 2 * mt * (c.y - a.y) + 2 * t * (b.y - c.y);
    const len = Math.hypot(dx, dy) || 1;
    const half = (w0 + (w1 - w0) * t) / 2;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    left.push(x + nx, y + ny);
    right.push(x - nx, y - ny);
  }
  for (let i = right.length - 2; i >= 0; i -= 2) left.push(right[i]!, right[i + 1]!);
  return left;
}
