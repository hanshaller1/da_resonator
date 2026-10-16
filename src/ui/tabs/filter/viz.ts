/**
 * FILTER tab visualisation (band axis): live in / out spectrum, the resonator response (faint), the
 * pre and post filter responses and the band filter curve (selected one bright, with a handle: drag
 * sideways = cutoff, up / down = resonance on PRE / POST, the passband level OFFSET on BAND) and per band
 * column the level the band ends up with at its centre: resonator × pre × post + band filter.
 * With BAND selected the foot shows the lock row; a click into a band's column locks or frees it too.
 * Curves follow the effective (modulated) settings.
 */
import { bandFilterDb } from '../../../dsp/modules/bandFilter';
import { filterMagnitude } from '../../../dsp/modules/filter';
import { BAND_FREQS, NUM_BANDS, formatValue, fromNorm } from '../../../shared/params';
import { LockRow, toggleLock } from '../../components/lockRow';
import { readModel, responseAt, type ResponseModel } from '../../response';
import { colCenter, colLeft, freqOfX, xOfFreq } from '../../shell/bandAxis';
import type { TabContext } from '../../shell/tabs';
import { cornerNote, drawBandGrid, drawDbGrid, fillTrace, monoFont, strokeTrace, type Palette } from '../../viz/draw';
import { SPEC_BOT, SPEC_TOP, SpectrumSampler } from '../../viz/spectrum';
import { VizCanvas } from '../../viz/vizCanvas';

const DB_TOP = 18; // response axis, as on the FB tab
const DB_BOT = -42;
const GRID_DB = [12, 0, -12, -24, -36];
const BAR_W = 26;
const HIT_R = 15; // handle grab radius (design px)
const RES_DRAG = 160; // px of vertical drag for the full resonance range
const FINE = 0.2;
const CLICK_PX = 4; // a press that moves less than this is a click (locks a band)
const LOCK_ROW = 18; // height of the lock row at the foot

/** the three filters of the tab: PRE and POST are audio filters, BAND reads a curve at the band centres */
export const FILTER_INSTANCES = ['filterPre', 'filterPost', 'filterBand'] as const;
export type FilterInst = (typeof FILTER_INSTANCES)[number];
export const SLOT_NAME: Record<FilterInst, string> = { filterPre: 'PRE', filterPost: 'POST', filterBand: 'BAND' };

/** settings each curve is drawn from (effective values, in this order) */
const KEYS: Record<FilterInst, readonly string[]> = {
  filterPre: ['type', 'slope', 'cutoff', 'res', 'mix'],
  filterPost: ['type', 'slope', 'cutoff', 'res', 'mix'],
  filterBand: ['type', 'slope', 'cutoff', 'width', 'depth', 'offset', 'rofs'],
};
const CUT = 2; // index of cutoff in KEYS
const VERT = 3; // index of the vertical handle value on PRE / POST (res)
const B_OFFSET = 5; // index of offset in the band filter KEYS
const B_ROFS = 6;

interface Curve {
  inst: FilterInst;
  band: boolean;
  ids: string[];
  on: boolean;
  /** effective plain values (KEYS order) the arrays were computed for */
  vals: Float64Array;
  /** locks the band levels were computed with (band filter) */
  lockKey: string;
  /** response per drawing column (dB) */
  db: Float32Array;
  /** band filter with R OFS: the curve of R per column (empty while R OFS is 0) */
  dbR: Float32Array;
  /** response at each band centre (dB; the band filter: its layer with the locks, −∞ = silent) */
  bandDb: Float32Array;
}

interface Drag {
  inst: FilterInst;
  pointerId: number;
  /** base cutoff x and the vertical value at grab time */
  cutX0: number;
  v0: number;
  /** last pointer position, for Shift fine mode */
  lx: number;
  ly: number;
  accX: number;
  accY: number;
}

const dbOf = (mag: number) => 20 * Math.log10(Math.max(1e-6, mag));

/**
 * @param selected current instance (FILTER_INSTANCES index)
 * @param select switch instance (when another filter's handle is grabbed)
 */
export function buildFilterViz(tab: TabContext, selected: () => number, select: (i: number) => void): VizCanvas {
  const { engine } = tab;
  const p = engine.params;
  const spec = new SpectrumSampler(engine);
  let model: ResponseModel | null = null;
  let resp = new Float32Array(0);
  const respBand = new Float32Array(NUM_BANDS);
  const curves: Curve[] = FILTER_INSTANCES.map((inst) => ({
    inst,
    band: inst === 'filterBand',
    ids: KEYS[inst].map((k) => `${inst}.${k}`),
    on: false,
    vals: new Float64Array(KEYS[inst].length).fill(NaN),
    lockKey: '',
    db: new Float32Array(0),
    dbR: new Float32Array(0),
    bandDb: new Float32Array(NUM_BANDS),
  }));
  let drag: Drag | null = null;
  let hover: FilterInst | null = null;
  let press: { pointerId: number; x: number; y: number } | null = null;

  const viz = new VizCanvas(tab.viz, tab, frame, {
    label: 'Pre, post and band filter over the spectrum; per band the level after the filters. Drag a handle: sideways = cutoff, up / down = resonance (band filter: level). With BAND selected a click into a band locks it',
    cls: 'flt-viz',
    onResize: (s) => {
      spec.resize(s.w);
      resp = new Float32Array(spec.cols);
      for (const c of curves) {
        c.db = new Float32Array(spec.cols);
        c.vals.fill(NaN);
      }
      model = null;
    },
  });
  const locks = new LockRow(p, 'filterBand', 'band filter');
  tab.viz.append(locks.el);
  p.subscribeAll(() => {
    model = null;
    viz.dirty = true;
  });
  engine.onStateChange(() => {
    spec.clear();
    viz.dirty = true;
  });

  const yResp = (db: number) => ((DB_TOP - db) / (DB_TOP - DB_BOT)) * viz.h;
  const pxPerDb = () => viz.h / (DB_TOP - DB_BOT);
  const ySpec = (db: number) => ((SPEC_TOP - db) / (SPEC_TOP - SPEC_BOT)) * viz.h;
  const respDbAt = (f: number) => (model ? dbOf(responseAt(model, f)) : 0);
  spec.synthShape = respDbAt;

  const effective = (id: string) => (p.isModulated(id) ? fromNorm(p.spec(id), p.getEffectiveNorm(id)) : p.get(id));
  const locked = (b: number) => p.get(`filterBand.lock${b}`) >= 0.5;
  const bandSelected = () => FILTER_INSTANCES[selected()] === 'filterBand';

  /** dB of a curve at f (band filter: −∞ clipped far below the frame) */
  function curveDb(c: Curve, f: number, fs: number, rOfs = false): number {
    const v = c.vals;
    if (c.band) {
      const fc = rOfs ? v[CUT] * Math.pow(2, v[B_ROFS]) : v[CUT];
      return Math.max(-200, bandFilterDb(Math.round(v[0]), fc, v[1], v[3], v[4], v[5], f));
    }
    return dbOf(filterMagnitude(v[0], v[1] >= 0.5, v[2], v[3], v[4], f, fs));
  }

  /** recompute curves whose on state, effective settings or locks changed; true if any did */
  function updateCurves(): boolean {
    const fs = engine.sampleRate || 48000;
    let changed = false;
    for (const c of curves) {
      const on = p.get(`${c.inst}.on`) >= 0.5;
      if (on !== c.on) {
        c.on = on;
        changed = true;
      }
      let same = true;
      for (let k = 0; k < c.ids.length; k++) {
        const v = effective(c.ids[k]);
        if (v !== c.vals[k]) {
          c.vals[k] = v;
          same = false;
        }
      }
      const lockKey = c.band ? Array.from({ length: NUM_BANDS }, (_, b) => (locked(b) ? 1 : 0)).join('') : '';
      if (same && lockKey === c.lockKey) continue;
      c.lockKey = lockKey;
      changed = true;
      for (let i = 0; i < c.db.length; i++) c.db[i] = curveDb(c, spec.freqAt(i), fs);
      if (c.band && Math.abs(c.vals[B_ROFS]) > 0.005) {
        if (c.dbR.length !== c.db.length) c.dbR = new Float32Array(c.db.length);
        for (let i = 0; i < c.dbR.length; i++) c.dbR[i] = curveDb(c, spec.freqAt(i), fs, true);
      } else if (c.dbR.length) c.dbR = new Float32Array(0);
      for (let b = 0; b < NUM_BANDS; b++) {
        c.bandDb[b] = c.band ? (locked(b) ? 0 : bandFilterDb(Math.round(c.vals[0]), c.vals[CUT], c.vals[1], c.vals[3], c.vals[4], c.vals[5], BAND_FREQS[b])) : curveDb(c, BAND_FREQS[b], fs);
      }
    }
    return changed;
  }

  /** handle position of a curve: on the curve at the effective cutoff, kept inside the frame */
  function handleOf(c: Curve): { x: number; y: number } {
    const fs = engine.sampleRate || 48000;
    const cutoff = c.vals[CUT];
    const x = Math.max(6, Math.min(viz.w - 6, xOfFreq(cutoff, viz.w)));
    return { x, y: Math.max(10, Math.min(yResp(-30), yResp(curveDb(c, cutoff, fs)))) };
  }

  function frame(dt: number) {
    const running = engine.state === 'running';
    const changed = updateCurves();
    if (!running && !viz.dirty && !changed) return;
    if (!model) {
      model = readModel(p);
      for (let i = 0; i < resp.length; i++) resp[i] = respDbAt(spec.freqAt(i));
      for (let b = 0; b < NUM_BANDS; b++) respBand[b] = respDbAt(BAND_FREQS[b]);
    }
    if (running) spec.update(dt);
    draw(running);
    viz.dirty = false;
  }

  function draw(running: boolean) {
    const g = viz.begin();
    const { w, h: H, pal } = viz;
    const bandSel = bandSelected();
    locks.el.hidden = !bandSel;
    drawBandGrid(g, w, H, pal, { labels: !bandSel });
    drawDbGrid(g, w, pal, GRID_DB, yResp);
    if (running) {
      fillTrace(g, spec.dispIn, spec.colPx, w, H, ySpec, pal.specIn, null);
      fillTrace(g, spec.dispOut, spec.colPx, w, H, ySpec, pal.specOut, pal.accent, 0.25);
    }
    // resonator alone: faint, so the filters read as the subject
    g.save();
    g.globalAlpha = 0.4;
    strokeTrace(g, resp, spec.colPx, w, yResp, pal.accent, 1);
    g.restore();

    if (bandSel) drawLocked(g, pal, H);
    drawBars(g, pal, H);

    const sel = curves[selected()];
    for (const c of curves) if (beside(c, sel)) drawCurve(g, pal, c, false);
    drawCurve(g, pal, sel, true);

    if (!running) cornerNote(g, pal, engine.state === 'error' ? 'AUDIO ERROR' : 'AUDIO OFF · RESPONSE ONLY');
  }

  /**
   * an unselected curve drawn beside the selected one: while on; switched off only as a ghost of PRE / POST
   * while PRE or POST is selected (the band filter's ghost and, with BAND selected, all ghosts would just clutter)
   */
  function beside(c: Curve, sel: Curve): boolean {
    return c !== sel && (c.on || (!c.band && !sel.band));
  }

  /** locked bands (band filter selected): their column lightly shaded */
  function drawLocked(g: CanvasRenderingContext2D, pal: Palette, H: number) {
    g.save();
    g.fillStyle = pal.panel2;
    g.globalAlpha = 0.55;
    for (let b = 0; b < NUM_BANDS; b++) {
      if (!locked(b)) continue;
      const x0 = Math.round(colLeft(b, viz.w)) + 1;
      g.fillRect(x0, 0, Math.round(colLeft(b + 1, viz.w)) - x0, H - LOCK_ROW);
    }
    g.restore();
  }

  /** per band: final level (resonator × filters + band filter) as a bar, the resonator-only level as a tick */
  function drawBars(g: CanvasRenderingContext2D, pal: Palette, H: number) {
    // with the lock row shown the bars stop above it, so the lock buttons stay readable
    const bandSel = bandSelected();
    const foot = bandSel ? LOCK_ROW + 3 : 14;
    const base = bandSel ? H - LOCK_ROW : H;
    g.save();
    g.font = monoFont(pal, 9);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (let b = 0; b < NUM_BANDS; b++) {
      let db = respBand[b];
      for (const c of curves) if (c.on) db += c.bandDb[b];
      const x = Math.round(colCenter(b, viz.w) - BAR_W / 2);
      const yTop = Math.min(H - foot, Math.max(2, yResp(db)));
      const grad = g.createLinearGradient(0, yTop, 0, base);
      grad.addColorStop(0, pal.accentSoft);
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.fillRect(x, yTop, BAR_W, base - yTop);
      g.fillStyle = pal.accent;
      g.fillRect(x, Math.round(yTop) - 1, BAR_W, 2);
      // resonator-only level: what the filters take away (or add) is the gap to the bar
      const yRes = Math.min(H - foot, Math.max(2, yResp(respBand[b])));
      if (Math.abs(yRes - yTop) > 2) {
        g.strokeStyle = pal.text3;
        g.lineWidth = 1;
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo(x, Math.round(yRes) + 0.5);
        g.lineTo(x + BAR_W, Math.round(yRes) + 0.5);
        g.stroke();
        g.setLineDash([]);
      }
      g.fillStyle = pal.text2;
      g.fillText(db <= -99.5 ? '−∞' : `${db >= 0.05 ? '+' : db <= -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)}`, x + BAR_W / 2, Math.min(yTop, yRes) - 4);
    }
    g.restore();
  }

  function drawCurve(g: CanvasRenderingContext2D, pal: Palette, c: Curve, isSel: boolean) {
    const { w, h: H } = viz;
    const name = SLOT_NAME[c.inst];
    const colour = isSel ? pal.text : pal.text3;
    g.save();
    if (!c.on) {
      // off: a faint dashed ghost, still grabbable so it can be set up before switching on
      g.globalAlpha = isSel ? 0.45 : 0.25;
      g.setLineDash([3, 4]);
    }
    strokeTrace(g, c.db, spec.colPx, w, yResp, colour, isSel ? 2 : 1, [-2, H + 2]);
    if (c.dbR.length) {
      // R with R OFS: thin dashed
      g.save();
      g.setLineDash([4, 3]);
      g.globalAlpha *= 0.7;
      strokeTrace(g, c.dbR, spec.colPx, w, yResp, colour, 1, [-2, H + 2]);
      g.restore();
    }
    g.setLineDash([]);
    const hp = handleOf(c);
    const xm = Math.round(hp.x) + 0.5;
    const foot = bandSelected() ? LOCK_ROW : 0;
    // cutoff marker + name at the foot
    g.save();
    g.strokeStyle = colour;
    g.lineWidth = 1;
    g.globalAlpha *= 0.6;
    g.setLineDash([1, 3]);
    g.beginPath();
    g.moveTo(xm, 0);
    g.lineTo(xm, H - 28 - foot);
    g.stroke();
    g.restore();
    g.font = monoFont(pal, 9, 600);
    g.fillStyle = colour;
    g.textBaseline = 'bottom';
    const right = xm > w - 70;
    g.textAlign = right ? 'right' : 'left';
    const rTag = c.dbR.length ? ` · R ${formatValue(p.spec(c.ids[B_ROFS]), c.vals[B_ROFS])}` : '';
    g.fillText(c.on ? `${name}${rTag}` : `${name} OFF`, right ? xm - 4 : xm + 4, H - 16 - foot);

    if (isSel) {
      const active = drag?.inst === c.inst || hover === c.inst;
      g.beginPath();
      g.arc(hp.x, hp.y, active ? 7 : 6, 0, Math.PI * 2);
      g.fillStyle = active ? colour : pal.well;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = colour;
      g.stroke();
      // frequency / resonance (band filter: level) next to the handle (effective values; cyan while modulated)
      const cutId = c.ids[CUT];
      const vId = c.ids[c.band ? B_OFFSET : VERT];
      const fText = formatValue(p.spec(cutId), c.vals[CUT]);
      const vText = c.band ? `LVL ${formatValue(p.spec(vId), c.vals[B_OFFSET])}` : `RES ${formatValue(p.spec(vId), c.vals[VERT])}`;
      const lx = right ? hp.x - 12 : hp.x + 12;
      const ly = hp.y < 30 ? hp.y + 4 : hp.y - 4;
      g.textAlign = right ? 'right' : 'left';
      g.textBaseline = 'bottom';
      g.font = monoFont(pal, 11, 600);
      g.fillStyle = p.isModulated(cutId) ? pal.mod : colour;
      g.fillText(fText, lx, ly);
      g.font = monoFont(pal, 9);
      g.textBaseline = 'top';
      g.fillStyle = p.isModulated(vId) ? pal.mod : pal.text3;
      g.fillText(vText, lx, ly + 2);
    } else {
      g.beginPath();
      g.arc(hp.x, hp.y, 3.5, 0, Math.PI * 2);
      g.fillStyle = pal.well;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = colour;
      g.stroke();
    }
    g.restore();
  }

  /* ---------- pointer: grab a handle (or its cutoff marker); a click into a column locks a band ---------- */

  const cv = viz.canvas;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (viz.w / r.width), y: (e.clientY - r.top) * (viz.h / r.height) };
  };
  /** the curves that can be grabbed, the selected one first */
  const grabbable = (): Curve[] => {
    const sel = curves[selected()];
    return [sel, ...curves.filter((c) => beside(c, sel))];
  };
  /** the filter whose handle / marker is under (x, y) */
  const hitTest = (x: number, y: number): FilterInst | null => {
    const order = grabbable();
    for (const c of order) {
      const hp = handleOf(c);
      if (Math.hypot(x - hp.x, y - hp.y) <= HIT_R) return c.inst;
    }
    for (const c of order) {
      const hp = handleOf(c);
      if (Math.abs(x - hp.x) <= 6 && y < viz.h - 14) return c.inst;
    }
    return null;
  };
  const setHover = (s: FilterInst | null) => {
    if (s === hover) return;
    hover = s;
    cv.style.cursor = s ? 'grab' : bandSelected() ? 'pointer' : '';
    viz.dirty = true;
  };
  const vertId = (inst: FilterInst) => `${inst}.${inst === 'filterBand' ? 'offset' : 'res'}`;

  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const { x, y } = local(e);
    const inst = hitTest(x, y);
    if (!inst) {
      if (bandSelected()) press = { pointerId: e.pointerId, x, y };
      return;
    }
    e.preventDefault();
    const idx = FILTER_INSTANCES.indexOf(inst);
    if (idx !== selected()) select(idx);
    cv.setPointerCapture(e.pointerId);
    const cutId = `${inst}.cutoff`;
    const vId = vertId(inst);
    drag = { inst, pointerId: e.pointerId, cutX0: xOfFreq(p.get(cutId), viz.w), v0: p.get(vId), lx: x, ly: y, accX: 0, accY: 0 };
    p.beginGesture(cutId);
    p.beginGesture(vId);
    cv.style.cursor = 'grabbing';
    viz.dirty = true;
  });
  cv.addEventListener('pointermove', (e) => {
    const { x, y } = local(e);
    if (press && e.pointerId === press.pointerId && Math.hypot(x - press.x, y - press.y) > CLICK_PX) press = null;
    if (!drag || e.pointerId !== drag.pointerId) {
      if (!drag) setHover(hitTest(x, y));
      return;
    }
    const k = e.shiftKey ? FINE : 1;
    drag.accX += (x - drag.lx) * k;
    drag.accY += (y - drag.ly) * k;
    drag.lx = x;
    drag.ly = y;
    const cutId = `${drag.inst}.cutoff`;
    const vId = vertId(drag.inst);
    const cs = p.spec(cutId);
    const vs = p.spec(vId);
    p.set(cutId, Math.max(cs.min, Math.min(cs.max, freqOfX(drag.cutX0 + drag.accX, viz.w))));
    const v = drag.inst === 'filterBand' ? drag.v0 - drag.accY / pxPerDb() : drag.v0 - drag.accY / RES_DRAG;
    p.set(vId, Math.max(vs.min, Math.min(vs.max, v)));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    p.endGesture(`${drag.inst}.cutoff`);
    p.endGesture(vertId(drag.inst));
    drag = null;
    const { x, y } = local(e);
    hover = null;
    setHover(hitTest(x, y));
    viz.dirty = true;
  };
  cv.addEventListener('pointerup', (e) => {
    if (press && e.pointerId === press.pointerId && bandSelected()) {
      const b = Math.max(0, Math.min(NUM_BANDS - 1, Math.floor((press.x / viz.w) * NUM_BANDS)));
      toggleLock(p, 'filterBand', b);
    }
    press = null;
    end(e);
  });
  cv.addEventListener('pointercancel', (e) => {
    press = null;
    end(e);
  });
  cv.addEventListener('lostpointercapture', end);
  cv.addEventListener('pointerleave', () => {
    if (!drag) setHover(null);
  });
  // double-click on a handle: back to the default cutoff / resonance (band filter: level)
  cv.addEventListener('dblclick', (e) => {
    const { x, y } = local(e);
    const inst = hitTest(x, y);
    if (!inst) return;
    for (const id of [`${inst}.cutoff`, vertId(inst)]) {
      p.beginGesture(id);
      p.reset(id);
      p.endGesture(id);
    }
  });
  return viz;
}
