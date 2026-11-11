import type { SeasonTeam, Snapshot } from '@sports-parity/core';
import { AdvancedBloomFilter } from 'pixi-filters';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { hexToNumber, readableTextOn, type Theme } from '../theme/tokens';
import { AngleSprings, primaryEdges, ringLayout, slotAngles, type RingLayout } from './scene';

interface NodeView {
  root: Container;
  halo: Graphics;
  disc: Graphics;
  record: Graphics;
  label: Text;
}

export interface RingData {
  /** Teams in graph-index order (snapshot indices refer to these). */
  teams: readonly SeasonTeam[];
  snapshot: Snapshot;
}

const TAU = Math.PI * 2;

/**
 * Draws the ring with Pixi (WebGL). It owns no app state: callers push data with `setData`
 * and time with `tick(dt)`. Driving time explicitly is what makes frame-exact export possible.
 */
export class RingRenderer {
  readonly app = new Application();
  /** Camera seam: zoom and pan will transform this container. */
  readonly world = new Container();
  private readonly chords = new Graphics();
  private readonly glow = new Container();
  private readonly rim = new Graphics();
  private readonly flow = new Graphics();
  private readonly nodeLayer = new Container();
  private nodes: NodeView[] = [];
  private springs = new AngleSprings(0);
  private layout: RingLayout = ringLayout(1, 1, 1);
  private data: RingData | null = null;
  private teamKey = '';
  private time = 0;
  private chordsDirty = true;
  private ready = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly theme: Theme,
    private readonly reducedMotion: boolean,
  ) {}

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

    this.glow.addChild(this.rim, this.flow);
    this.world.addChild(this.chords, this.glow, this.nodeLayer);
    this.app.stage.addChild(this.world);
    // Bloom over the whole screen, so its bounds never show as a box behind the ring.
    this.glow.filters = [
      new AdvancedBloomFilter({
        threshold: 0.15,
        bloomScale: 1.1,
        brightness: 1,
        blur: 8,
        quality: 5,
      }),
    ];
    this.glow.filterArea = this.app.screen;

    this.app.renderer.on('resize', () => this.relayout());
    // Pixi's resizeTo only listens to window resizes; layout changes resize the host too.
    this.resizeObserver = new ResizeObserver(() => this.app.resize());
    this.resizeObserver.observe(host);
    this.app.ticker.add((ticker) => this.tick(Math.min(ticker.deltaMS / 1000, 0.1)));
    this.ready = true;
    this.relayout();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    if (this.ready) this.app.destroy(true, { children: true });
    this.ready = false;
  }

  setData(data: RingData): void {
    const key = data.teams.map((t) => t.franchiseId).join();
    const newTeams = key !== this.teamKey;
    this.data = data;
    if (newTeams) {
      this.teamKey = key;
      this.buildNodes(data.teams);
    }
    this.springs.setTargets(
      slotAngles(data.snapshot, data.teams.length),
      newTeams || this.reducedMotion,
    );
    this.styleNodes();
    this.chordsDirty = true;
  }

  /** Advance the scene by dt seconds and redraw. */
  tick(dt: number): void {
    if (!this.ready || !this.data) return;
    this.time += dt;
    const moving = this.springs.step(dt);
    this.placeNodes();
    if (moving || this.chordsDirty) this.drawChords();
    this.chordsDirty = moving;
    this.drawRim();
  }

  private relayout(): void {
    if (!this.ready) return;
    const { width, height } = this.app.screen;
    this.layout = ringLayout(width, height, this.data?.teams.length ?? 32);
    this.styleNodes();
    this.chordsDirty = true;
  }

  private buildNodes(teams: readonly SeasonTeam[]): void {
    this.nodeLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.springs = new AngleSprings(teams.length);
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

  /** Per-team visuals that change with data or layout, not every frame. */
  private styleNodes(): void {
    if (!this.data) return;
    const { teams, snapshot } = this.data;
    const r = this.layout.nodeRadius;
    const unbeaten = new Set(snapshot.blockers.unbeaten);
    const winless = new Set(snapshot.blockers.winless);
    const muted = hexToNumber(this.theme.color.textMuted);
    teams.forEach((team, i) => {
      const view = this.nodes[i]!;
      const rec = snapshot.graph.records[i]!;
      const games = rec.wins + rec.losses + rec.ties;
      const pct = games === 0 ? 0 : (rec.wins + rec.ties / 2) / games;

      view.halo.clear();
      if (unbeaten.has(i) && games > 0) {
        view.halo
          .circle(0, 0, r + 7)
          .fill({ color: hexToNumber(this.theme.color.unbeaten), alpha: 0.35 });
      }
      view.disc
        .clear()
        .circle(0, 0, r)
        .fill({ color: hexToNumber(team.colors.primary) });
      view.record
        .clear()
        .circle(0, 0, r + 3)
        .stroke({ width: 2.5, color: muted, alpha: 0.25 });
      if (pct > 0) {
        view.record
          .moveTo(0, -(r + 3))
          .arc(0, 0, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * pct)
          .stroke({ width: 2.5, color: 0xffffff, alpha: 0.9 });
      }
      view.label.text = team.abbr;
      view.label.style.fontSize = Math.max(8, Math.round(r * (team.abbr.length > 2 ? 0.66 : 0.78)));
      view.label.style.fill = readableTextOn(team.colors.primary);
      view.root.alpha = winless.has(i) && games > 0 ? 0.45 : 1;
    });
  }

  private point(angle: number, radius = this.layout.radius) {
    return {
      x: this.layout.cx + Math.cos(angle) * radius,
      y: this.layout.cy + Math.sin(angle) * radius,
    };
  }

  private placeNodes(): void {
    this.nodes.forEach((view, i) => {
      const p = this.point(this.springs.angle[i]!);
      view.root.position.set(p.x, p.y);
    });
  }

  /** Faint chords for every win that isn't part of the ring. */
  private drawChords(): void {
    const { snapshot } = this.data!;
    const primary = new Set(primaryEdges(snapshot).map(([u, v]) => u * 64 + v));
    const { cx, cy, nodeRadius } = this.layout;
    const inner = this.layout.radius - nodeRadius - 2;
    this.chords.clear();
    for (const e of snapshot.graph.edges) {
      if (primary.has(e.winner * 64 + e.loser)) continue;
      const a = this.point(this.springs.angle[e.winner]!, inner);
      const b = this.point(this.springs.angle[e.loser]!, inner);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.chords
        .moveTo(a.x, a.y)
        .quadraticCurveTo(cx + (mx - cx) * 0.25, cy + (my - cy) * 0.25, b.x, b.y);
    }
    this.chords.stroke({ width: 1, color: hexToNumber(this.theme.color.chord), alpha: 0.13 });
  }

  /** Ring edges along the rim with arrowheads, plus particles flowing winner -> loser. */
  private drawRim(): void {
    const { snapshot } = this.data!;
    const { cx, cy, radius, nodeRadius } = this.layout;
    const color = hexToNumber(this.theme.color.ring);
    const pad = (nodeRadius + 5) / radius;
    const arrow = Math.max(5, nodeRadius * 0.55);
    this.rim.clear();
    this.flow.clear();
    for (const [u, v] of primaryEdges(snapshot)) {
      const a0 = this.springs.angle[u]!;
      let delta = this.springs.angle[v]! - a0;
      delta -= Math.round(delta / TAU) * TAU; // shortest way round
      const dir = Math.sign(delta) || 1;
      const span = Math.abs(delta) - 2 * pad;
      if (span <= 0.002) continue;
      const start = a0 + dir * pad;
      const end = start + dir * span;
      const s = this.point(start);
      this.rim
        .moveTo(s.x, s.y)
        .arc(cx, cy, radius, start, end, dir < 0)
        .stroke({ width: 2.5, color, alpha: 0.85 });
      // Arrowhead at the loser's end, pointing along the direction of travel.
      const tip = this.point(end);
      const tangent = end + (dir * Math.PI) / 2;
      const back = { x: tip.x - Math.cos(tangent) * arrow, y: tip.y - Math.sin(tangent) * arrow };
      const nx = Math.cos(end) * arrow * 0.55;
      const ny = Math.sin(end) * arrow * 0.55;
      this.rim
        .moveTo(tip.x, tip.y)
        .lineTo(back.x + nx, back.y + ny)
        .lineTo(back.x - nx, back.y - ny)
        .closePath()
        .fill({ color, alpha: 0.95 });

      if (!this.reducedMotion) {
        for (let k = 0; k < 2; k++) {
          const f = (this.time * 0.45 + k / 2) % 1;
          const p = this.point(start + dir * span * f);
          this.flow
            .circle(p.x, p.y, 1.8)
            .fill({ color: 0xffffff, alpha: Math.sin(f * Math.PI) * 0.9 });
        }
      }
    }
  }
}
