/**
 * Band scanner picture (CLK MOD → SCAN, band axis): per band column the level the scanner gives the band on
 * top of its fader (L, and R beside it while R DLY or R INV make them differ), the OFFSET line and the floor
 * OFFSET − DEPTH, the band of the last step lit. Values come from the worklet's meter frames. Locked bands
 * are shaded; the lock row sits along the foot, and a click into a column locks or frees that band too.
 */
import { NUM_BANDS, formatValue } from '../../../shared/params';
import type { EngineAPI } from '../../../core/types';
import { LockRow, toggleLock } from '../../components/lockRow';
import { h } from '../../dom';
import { colCenter, colLeft } from '../../shell/bandAxis';
import type { TabContext } from '../../shell/tabs';
import { drawBandGrid, monoFont } from '../../viz/draw';
import { VizCanvas } from '../../viz/vizCanvas';
import { effective, picNote } from '../lfo/sourceTab';

const DB_TOP = 12;
const DB_BOT = -54;
const GRID_DB = [12, 0, -12, -24, -36, -48];
const PT = 8;
const FOOT = 22; // lock row + air
const BAR_W = 34;
const CLICK_PX = 4;
const STEP_GLOW_MS = 160;

export class ScanViz {
  readonly el: HTMLElement;
  readonly viz: VizCanvas;
  private shown = new Float32Array(NUM_BANDS * 2);
  private lastStep = -1;
  private glow = new Float32Array(NUM_BANDS);
  private press: { pointerId: number; x: number; y: number } | null = null;

  constructor(
    private engine: EngineAPI,
    tab: TabContext,
  ) {
    const p = engine.params;
    this.el = h('div', { class: 'scan-pic' });
    tab.viz.append(this.el);
    this.viz = new VizCanvas(this.el, tab, (dt) => this.frame(dt), {
      label: 'Band scanner: the level it gives every band on top of its fader, and the band of the last step. Click a band to lock it',
      cls: 'scan-viz',
    });
    this.el.append(new LockRow(p, 'scan', 'scanner').el);
    p.subscribeAll((id) => {
      if (id.startsWith('scan.')) this.viz.dirty = true;
    });
    engine.onStateChange(() => (this.viz.dirty = true));

    const cv = this.viz.canvas;
    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (this.viz.w / r.width), y: (e.clientY - r.top) * (this.viz.h / r.height) };
    };
    cv.style.cursor = 'pointer';
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.press = { pointerId: e.pointerId, ...local(e) };
    });
    cv.addEventListener('pointermove', (e) => {
      const q = this.press;
      if (!q || e.pointerId !== q.pointerId) return;
      const { x, y } = local(e);
      if (Math.hypot(x - q.x, y - q.y) > CLICK_PX) this.press = null;
    });
    cv.addEventListener('pointerup', (e) => {
      const q = this.press;
      this.press = null;
      if (!q || e.pointerId !== q.pointerId) return;
      toggleLock(p, 'scan', Math.max(0, Math.min(NUM_BANDS - 1, Math.floor((q.x / this.viz.w) * NUM_BANDS))));
    });
    cv.addEventListener('pointercancel', () => (this.press = null));
  }

  private yOf(db: number): number {
    const H = this.viz.h - FOOT;
    const d = Math.max(DB_BOT, Math.min(DB_TOP, db));
    return PT + ((DB_TOP - d) / (DB_TOP - DB_BOT)) * (H - PT);
  }

  private frame(dt: number): void {
    const { engine } = this;
    const running = engine.state === 'running';
    const on = engine.params.get('scan.on') >= 0.5;
    const f = running && on ? engine.meters.latest() : null;
    let moved = false;
    for (let i = 0; i < this.shown.length; i++) {
      const v = f?.scanDb?.[i] ?? 0;
      if (v !== this.shown[i]) {
        this.shown[i] = v;
        moved = true;
      }
    }
    const step = f?.scanPos?.[0] ?? -1;
    if (step !== this.lastStep) {
      this.lastStep = step;
      if (step >= 0) this.glow[step] = STEP_GLOW_MS;
      moved = true;
    }
    for (let b = 0; b < NUM_BANDS; b++) {
      if (this.glow[b] > 0) {
        this.glow[b] = Math.max(0, this.glow[b] - dt);
        moved = true;
      }
    }
    if (!moved && !this.viz.dirty) return;
    this.draw(running, on);
    this.viz.dirty = false;
  }

  private draw(running: boolean, on: boolean): void {
    const { viz, engine } = this;
    const p = engine.params;
    const g = viz.begin();
    const { w, h: H, pal } = viz;
    const pb = H - FOOT;
    drawBandGrid(g, w, pb, pal, { labels: false });
    // level grid
    g.save();
    g.strokeStyle = pal.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (const db of GRID_DB) {
      const y = Math.round(this.yOf(db)) + 0.5;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
    g.font = monoFont(pal, 9);
    g.fillStyle = pal.text4;
    g.textAlign = 'right';
    for (const db of GRID_DB) {
      // above its line, the top one below it (it would be cut off)
      const y = this.yOf(db);
      const above = y > 12;
      g.textBaseline = above ? 'bottom' : 'top';
      g.fillText(`${db > 0 ? '+' : ''}${db}`, w - 5, above ? y - 2 : y + 2);
    }
    g.restore();

    const off = effective(engine, 'scan.offset');
    const depth = effective(engine, 'scan.depth');
    const stereo = p.get('scan.rdly') >= 0.5 || p.get('scan.rinv') >= 0.5;
    const locked = (b: number) => p.get(`scan.lock${b}`) >= 0.5;

    // OFFSET (u = 1) and the floor OFFSET − DEPTH (u = 0)
    g.save();
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    for (const [db, label] of [
      [off, `OFFSET ${formatValue(p.spec('scan.offset'), off)}`],
      [off - depth, `FLOOR ${formatValue(p.spec('scan.offset'), off - depth)}`],
    ] as const) {
      const y = Math.round(this.yOf(db)) + 0.5;
      g.strokeStyle = pal.text3;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      g.font = monoFont(pal, 9, 600);
      g.fillStyle = pal.text3;
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      g.fillText(label, 6, y - 2);
    }
    g.restore();

    g.save();
    if (!on) g.globalAlpha = 0.35;
    const y0 = this.yOf(0);
    for (let b = 0; b < NUM_BANDS; b++) {
      const x0 = Math.round(colLeft(b, w)) + 1;
      if (locked(b)) {
        g.fillStyle = pal.panel2;
        g.globalAlpha = (on ? 1 : 0.35) * 0.55;
        g.fillRect(x0, 0, Math.round(colLeft(b + 1, w)) - x0, pb);
        g.globalAlpha = on ? 1 : 0.35;
        g.font = monoFont(pal, 9, 600);
        g.fillStyle = pal.text3;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('LOCKED', colCenter(b, w), pb / 2);
        continue;
      }
      const cx = colCenter(b, w);
      const glow = this.glow[b] / STEP_GLOW_MS;
      const bars = stereo ? [0, 1] : [0];
      const bw = stereo ? BAR_W / 2 - 1 : BAR_W;
      bars.forEach((ch, k) => {
        const db = this.shown[b * 2 + ch];
        const x = Math.round(cx - BAR_W / 2 + k * (bw + 2));
        const y = this.yOf(db);
        // from the 0 dB line (the bare fader) to the level the scanner sets
        const top = Math.min(y, y0);
        const hgt = Math.max(1, Math.abs(y - y0));
        g.fillStyle = ch ? pal.text3 : pal.accentSoft;
        g.fillRect(x, top, bw, hgt);
        g.fillStyle = ch ? pal.text2 : pal.accent;
        g.fillRect(x, Math.round(y) - 1, bw, 2);
      });
      // the step: a lit dot above the column
      g.beginPath();
      g.arc(cx, 5, 3, 0, Math.PI * 2);
      g.fillStyle = glow > 0 ? pal.accent : pal.grid;
      g.globalAlpha = (on ? 1 : 0.35) * (0.35 + 0.65 * glow);
      g.fill();
      g.globalAlpha = on ? 1 : 0.35;
    }
    g.restore();

    if (!on) picNote(g, monoFont(pal, 13, 700), pal.text3, 'SCAN OFF', w / 2, pb / 2);
    else if (!running) picNote(g, monoFont(pal, 11, 600), pal.text3, 'AUDIO OFF', w / 2, pb / 2);
    if (stereo && on) {
      g.save();
      g.font = monoFont(pal, 9, 600);
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillStyle = pal.accent;
      g.fillText('L', 6, 4);
      g.fillStyle = pal.text2;
      g.fillText('R', 16, 4);
      g.restore();
    }
  }
}
