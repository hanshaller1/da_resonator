/**
 * DYN EQ visualisation (band axis): per band column the current band level as a bar (with SRC IN / OUT
 * the level the analysis of that band measures; the part above the threshold lit), the gain change hanging from the top (reduction red, boost green),
 * the band's amount (bar strength + a small track at the foot) and the threshold as one line
 * across all bands, draggable up / down. The static transfer curve shows as a small inset while
 * threshold / ratio / range are being changed.
 */
import type { ParamStoreAPI } from '../../../core/types';
import { NUM_BANDS, fromNorm } from '../../../shared/params';
import { DYN_MODES, dynGainChange } from '../../../shared/paramdefs/modules';
import { colCenter } from '../../shell/bandAxis';
import type { TabContext } from '../../shell/tabs';
import { drawBandGrid, monoFont, type Palette } from '../../viz/draw';
import { VizCanvas } from '../../viz/vizCanvas';

const DB_TOP = 6; // level axis (dBFS)
const DB_BOT = -66;
const GRID_DB = [0, -12, -24, -36, -48, -60];
const PT = 4; // plot top / bottom inside the 240 px (the foot holds amount track + band labels)
const FOOT = 30;
const BAR_W = 30;
const HIT = 7; // threshold line grab distance (design px)
const FINE = 0.2;
const LEVEL_FALL = 36; // dB / s: display release of the band bars
const GR_FALL = 48; // dB / s: display release of the gain-change caps
const PEAK_HOLD = 1200; // ms
const INSET_MS = 1600; // transfer curve inset stays this long after the last change
const CURVE_IDS = ['dyn.threshold', 'dyn.ratio', 'dyn.range', 'dyn.mode'] as const;

/** effective (modulated) plain value, so the picture follows LFOs on threshold / ratio / range */
export function effective(p: ParamStoreAPI, id: string): number {
  return p.isModulated(id) ? fromNorm(p.spec(id), p.getEffectiveNorm(id)) : p.get(id);
}

/** static curve of the worklet (shared dynGainChange: CUT above T, BOOST below T down to the gate, BALANCE both) */
function outputDb(inDb: number, thr: number, ratio: number, range: number, mode: number): number {
  return inDb - dynGainChange(inDb - thr, 1 - 1 / ratio, range, mode);
}

const fmtDb = (db: number) => `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)}`;

export interface DynViz {
  viz: VizCanvas;
  /** largest current gain change (dB, + = reduction) and its band, for the status readout */
  peakGr(): { db: number; band: number };
}

export function buildDynViz(tab: TabContext): DynViz {
  const { engine } = tab;
  const p = engine.params;
  const level = new Float32Array(NUM_BANDS).fill(DB_BOT); // displayed band level (dB)
  const peak = new Float32Array(NUM_BANDS).fill(DB_BOT);
  const peakAge = new Float32Array(NUM_BANDS);
  const gr = new Float32Array(NUM_BANDS); // displayed gain change (dB, + = reduction)
  let shownKey = '';
  let insetUntil = 0;
  let now = 0;
  let drag: { pointerId: number; ly: number; acc: number; thr0: number } | null = null;
  let hover = false;

  const viz = new VizCanvas(tab.viz, tab, frame, {
    label: 'Band levels against the dynamics threshold, with the gain change of each band. Drag the threshold line up or down',
    cls: 'dyn-viz',
  });
  for (const id of CURVE_IDS) {
    p.subscribe(id, () => {
      insetUntil = now + INSET_MS;
      viz.dirty = true;
    });
  }
  p.subscribeAll((id) => {
    if (id.startsWith('dyn.') || /^band\d\.dyn$/.test(id)) viz.dirty = true;
  });
  engine.onStateChange(() => (viz.dirty = true));

  const plotB = () => viz.h - FOOT;
  const yOf = (db: number) => PT + ((DB_TOP - db) / (DB_TOP - DB_BOT)) * (plotB() - PT);
  const pxPerDb = () => (plotB() - PT) / (DB_TOP - DB_BOT);

  function frame(dt: number, t: number) {
    now = t;
    const running = engine.state === 'running';
    const on = p.get('dyn.on') >= 0.5;
    const f = engine.meters.latest();
    // IN / OUT: show what the analysis measures (the band bars would not match the threshold)
    const analysed = on && Math.round(p.get('dyn.source')) !== 0;
    let moving = false;
    for (let b = 0; b < NUM_BANDS; b++) {
      const lin = running && f ? (analysed ? f.dynLvl?.[b] : f.bands[b]) ?? 0 : 0;
      const db = Math.max(DB_BOT, 20 * Math.log10(Math.max(1e-6, lin)));
      level[b] = db >= level[b] ? db : Math.max(db, level[b] - (LEVEL_FALL * dt) / 1000);
      if (level[b] >= peak[b]) {
        peak[b] = level[b];
        peakAge[b] = 0;
      } else {
        peakAge[b] += dt;
        if (peakAge[b] > PEAK_HOLD) peak[b] = Math.max(level[b], peak[b] - (LEVEL_FALL * dt) / 1000);
      }
      const g = running && on && f ? f.dynGR?.[b] ?? 0 : 0;
      const prev = gr[b];
      if (Math.abs(g) >= Math.abs(prev) || Math.sign(g) !== Math.sign(prev)) gr[b] = g;
      else gr[b] = Math.sign(prev) * Math.max(Math.abs(g), Math.abs(prev) - (GR_FALL * dt) / 1000);
      if (level[b] > DB_BOT || peak[b] > DB_BOT || Math.abs(gr[b]) > 0.01) moving = true;
    }
    // modulated threshold / ratio / range only move through readouts
    const key = CURVE_IDS.map((id) => effective(p, id).toFixed(2)).join('|');
    if (key !== shownKey) {
      shownKey = key;
      viz.dirty = true;
    }
    const insetOn = drag !== null || hover || t < insetUntil + 300;
    if (!running && !moving && !viz.dirty && !insetOn) return;
    draw(running, on);
    viz.dirty = false;
  }

  function draw(running: boolean, on: boolean) {
    const g = viz.begin();
    const { w, h: H, pal } = viz;
    const pb = plotB();
    drawBandGrid(g, w, H, pal);
    // level grid
    g.save();
    g.lineWidth = 1;
    g.strokeStyle = pal.grid;
    g.beginPath();
    for (const db of GRID_DB) {
      const y = Math.round(yOf(db)) + 0.5;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
    g.font = monoFont(pal, 9);
    g.fillStyle = pal.text4;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    for (const db of GRID_DB) g.fillText(`${db}`, w - 5, yOf(db) - 2);
    g.restore();

    const thr = effective(p, 'dyn.threshold');
    const yThr = yOf(thr);
    g.save();
    if (!on) g.globalAlpha = 0.35;

    // above the threshold the dynamics act: a faint wash
    const wash = g.createLinearGradient(0, PT, 0, yThr);
    wash.addColorStop(0, 'transparent');
    wash.addColorStop(1, pal.accentSoft);
    g.fillStyle = wash;
    g.fillRect(0, PT, w, Math.max(0, yThr - PT));

    drawBands(g, pal, yThr, pb);
    drawThreshold(g, pal, thr, yThr);
    g.restore();

    if (!on) {
      g.save();
      g.font = monoFont(pal, 13, 700);
      g.fillStyle = pal.text3;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('DYN OFF', w / 2, pb / 2);
      g.restore();
    }
    const insetA = drag || hover ? 1 : Math.max(0, Math.min(1, (insetUntil + 300 - now) / 300));
    if (insetA > 0) drawInset(g, pal, insetA, on);
    if (!running) {
      g.save();
      g.font = monoFont(pal, 9);
      g.fillStyle = pal.text3;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(engine.state === 'error' ? 'AUDIO ERROR' : 'AUDIO OFF', 8, 8);
      g.restore();
    }
  }

  function drawBands(g: CanvasRenderingContext2D, pal: Palette, yThr: number, pb: number) {
    const k = pxPerDb();
    g.font = monoFont(pal, 9, 600);
    g.textAlign = 'center';
    for (let b = 0; b < NUM_BANDS; b++) {
      const amt = Math.max(0, Math.min(1, p.get(`band${b}.dyn`)));
      const cx = colCenter(b, viz.w);
      const x = Math.round(cx - BAR_W / 2);
      const a0 = g.globalAlpha;
      // bar strength follows the amount: a band with amount 0 is not processed
      g.globalAlpha = a0 * (0.3 + 0.7 * amt);
      const yL = Math.max(PT, yOf(level[b]));
      if (yL < pb) {
        // below the threshold neutral, above it lit
        const ySplit = Math.max(yL, Math.min(pb, yThr));
        g.fillStyle = pal.text3;
        g.globalAlpha = a0 * (0.15 + 0.35 * amt);
        g.fillRect(x, ySplit, BAR_W, pb - ySplit);
        if (ySplit > yL) {
          g.globalAlpha = a0 * (0.3 + 0.7 * amt);
          g.fillStyle = pal.accent;
          g.fillRect(x, yL, BAR_W, ySplit - yL);
        }
      }
      // peak hold tick
      if (peak[b] > DB_BOT + 0.5) {
        g.globalAlpha = a0 * (0.3 + 0.7 * amt);
        g.fillStyle = peak[b] > effective(p, 'dyn.threshold') ? pal.accent : pal.text2;
        g.fillRect(x, Math.round(Math.max(PT, yOf(peak[b]))) - 1, BAR_W, 2);
      }
      g.globalAlpha = a0;
      // gain change hanging from the top: reduction red, boost green
      const c = gr[b];
      if (Math.abs(c) > 0.05) {
        const len = Math.max(2, Math.abs(c) * k);
        g.fillStyle = c > 0 ? pal.fb : pal.ok;
        g.globalAlpha = a0 * 0.85;
        g.fillRect(x + 3, 0, BAR_W - 6, len);
        g.globalAlpha = a0;
        g.textBaseline = 'top';
        g.fillText(fmtDb(-c), cx, len + 3);
      }
      // amount at the foot: a short track
      const ty = pb + 6;
      g.fillStyle = pal.grid;
      g.fillRect(x, ty, BAR_W, 3);
      g.fillStyle = pal.text2;
      g.fillRect(x, ty, Math.round(BAR_W * amt), 3);
    }
  }

  function drawThreshold(g: CanvasRenderingContext2D, pal: Palette, thr: number, yThr: number) {
    const { w } = viz;
    const mod = p.isModulated('dyn.threshold');
    if (mod) {
      // base value dotted, the effective line solid
      const yb = Math.round(yOf(p.get('dyn.threshold'))) + 0.5;
      g.save();
      g.strokeStyle = pal.text3;
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(0, yb);
      g.lineTo(w, yb);
      g.stroke();
      g.restore();
    }
    const active = drag !== null || hover;
    const y = Math.round(yThr) + 0.5;
    g.save();
    g.strokeStyle = mod ? pal.mod : pal.accent;
    g.lineWidth = active ? 2 : 1.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
    // tag at the left edge, over the line
    const text = `THR ${fmtDb(thr)} dB`;
    g.font = monoFont(pal, 10, 600);
    const tw = Math.ceil(g.measureText(text).width) + 12;
    const th = 16;
    const ty = Math.max(1, Math.min(viz.h - FOOT - th - 1, y - th - 3));
    g.fillStyle = active ? (mod ? pal.mod : pal.accent) : pal.panel;
    g.strokeStyle = mod ? pal.mod : pal.accent;
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(4.5, ty + 0.5, tw, th, 3);
    g.fill();
    g.stroke();
    g.fillStyle = active ? pal.panel : mod ? pal.mod : pal.accent;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, 10.5, ty + th / 2 + 1);
    g.restore();
  }

  /** transfer curve (−60 … 0 dB in and out), top right */
  function drawInset(g: CanvasRenderingContext2D, pal: Palette, alpha: number, on: boolean) {
    const S = 84;
    const x0 = viz.w - S - 34;
    const y0 = 12;
    const thr = effective(p, 'dyn.threshold');
    const ratio = effective(p, 'dyn.ratio');
    const range = effective(p, 'dyn.range');
    const dynMode = Math.round(p.get('dyn.mode'));
    const px = (db: number) => x0 + ((db + 60) / 60) * S;
    const py = (db: number) => y0 + S - ((db + 60) / 60) * S;
    g.save();
    g.globalAlpha = alpha * (on ? 1 : 0.6);
    g.fillStyle = pal.panel2;
    g.strokeStyle = pal.lineStrong;
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x0 - 6.5, y0 - 6.5, S + 13, S + 27, 5);
    g.fill();
    g.stroke();
    g.strokeStyle = pal.grid;
    g.beginPath();
    for (let db = -48; db < 0; db += 12) {
      g.moveTo(Math.round(px(db)) + 0.5, y0);
      g.lineTo(Math.round(px(db)) + 0.5, y0 + S);
      g.moveTo(x0, Math.round(py(db)) + 0.5);
      g.lineTo(x0 + S, Math.round(py(db)) + 0.5);
    }
    g.stroke();
    g.strokeStyle = pal.text4;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(px(-60), py(-60));
    g.lineTo(px(0), py(0));
    g.stroke();
    g.strokeStyle = pal.text3;
    g.setLineDash([1, 2]);
    g.beginPath();
    g.moveTo(Math.round(px(thr)) + 0.5, y0);
    g.lineTo(Math.round(px(thr)) + 0.5, y0 + S);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = pal.accent;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const inDb = -60 + i;
      const out = Math.max(-60, Math.min(0, outputDb(inDb, thr, ratio, range, dynMode)));
      if (i) g.lineTo(px(inDb), py(out));
      else g.moveTo(px(inDb), py(out));
    }
    g.stroke();
    g.font = monoFont(pal, 9, 600);
    g.fillStyle = pal.text2;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText((DYN_MODES[dynMode] ?? 'Cut').toUpperCase(), x0, y0 + S + 6);
    g.textAlign = 'right';
    g.fillStyle = pal.text3;
    g.fillText(`${ratio.toFixed(1)}:1 ±${range.toFixed(0)}`, x0 + S, y0 + S + 6);
    g.restore();
  }

  /* ---------- pointer: drag the threshold line ---------- */

  const cv = viz.canvas;
  const localY = (e: PointerEvent | MouseEvent) => {
    const r = cv.getBoundingClientRect();
    return (e.clientY - r.top) * (viz.h / r.height);
  };
  const near = (y: number) => Math.abs(y - yOf(effective(p, 'dyn.threshold'))) <= HIT || Math.abs(y - yOf(p.get('dyn.threshold'))) <= HIT;
  const setHover = (v: boolean) => {
    if (v === hover) return;
    hover = v;
    cv.style.cursor = v ? 'ns-resize' : '';
    if (!v) insetUntil = now; // fade out
    viz.dirty = true;
  };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const y = localY(e);
    if (!near(y)) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, ly: y, acc: 0, thr0: p.get('dyn.threshold') };
    p.beginGesture('dyn.threshold');
    viz.dirty = true;
  });
  cv.addEventListener('pointermove', (e) => {
    const y = localY(e);
    if (!drag || e.pointerId !== drag.pointerId) {
      if (!drag) setHover(near(y));
      return;
    }
    drag.acc += (y - drag.ly) * (e.shiftKey ? FINE : 1);
    drag.ly = y;
    const s = p.spec('dyn.threshold');
    p.set('dyn.threshold', Math.max(s.min, Math.min(s.max, drag.thr0 - drag.acc / pxPerDb())));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    p.endGesture('dyn.threshold');
    drag = null;
    insetUntil = now + 600;
    setHover(near(localY(e)));
    viz.dirty = true;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('lostpointercapture', end);
  cv.addEventListener('pointerleave', () => {
    if (!drag) setHover(false);
  });
  cv.addEventListener('dblclick', (e) => {
    if (!near(localY(e))) return;
    p.beginGesture('dyn.threshold');
    p.reset('dyn.threshold');
    p.endGesture('dyn.threshold');
  });

  return {
    viz,
    peakGr() {
      let best = 0;
      let band = -1;
      for (let b = 0; b < NUM_BANDS; b++) {
        if (Math.abs(gr[b]) > Math.abs(best)) {
          best = gr[b];
          band = b;
        }
      }
      return { db: best, band };
    },
  };
}
