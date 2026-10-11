/**
 * FILTER tab visualisation (band axis): live in / out spectrum, the resonator response (faint),
 * both filter responses (selected one bright, with a cutoff handle: drag sideways = cutoff,
 * up / down = resonance) and per band column the level the band ends up with at its centre:
 * resonator × pre × post. Curves follow the effective (modulated) filter settings.
 */
import { filterMagnitude } from '../../../dsp/modules/filter';
import { FILTER_SLOTS, type FilterSlot } from '../../../shared/paramdefs/modules';
import { BAND_FREQS, NUM_BANDS, formatValue, fromNorm } from '../../../shared/params';
import { readModel, responseAt, type ResponseModel } from '../../response';
import { colCenter, freqOfX, xOfFreq } from '../../shell/bandAxis';
import type { TabContext } from '../../shell/tabs';
import { cornerNote, drawBandGrid, drawDbGrid, fillTrace, monoFont, strokeTrace, type Palette } from '../../viz/draw';
import { SPEC_BOT, SPEC_TOP, SpectrumSampler } from '../../viz/spectrum';
import { VizCanvas } from '../../viz/vizCanvas';

const DB_TOP = 18; // response axis, as on the FB tab
const DB_BOT = -42;
const GRID_DB = [12, 0, -12, -24, -36];
const KEYS = ['type', 'slope', 'cutoff', 'res', 'mix'] as const;
const CUT = 2; // index of cutoff in KEYS
const RES = 3;
const BAR_W = 26;
const HIT_R = 15; // handle grab radius (design px)
const RES_DRAG = 160; // px of vertical drag for the full resonance range
const FINE = 0.2;

export const SLOT_NAME: Record<FilterSlot, string> = { filterPre: 'PRE', filterPost: 'POST' };

interface Curve {
  slot: FilterSlot;
  ids: string[];
  on: boolean;
  /** effective plain values (KEYS order) the arrays were computed for */
  vals: Float64Array;
  /** response per drawing column (dB) */
  db: Float32Array;
  /** response at each band centre (dB) */
  bandDb: Float32Array;
}

interface Drag {
  slot: FilterSlot;
  pointerId: number;
  x0: number;
  y0: number;
  /** base cutoff x and resonance at grab time */
  cutX0: number;
  res0: number;
  /** last pointer position, for Shift fine mode */
  lx: number;
  ly: number;
  accX: number;
  accY: number;
}

const dbOf = (mag: number) => 20 * Math.log10(Math.max(1e-6, mag));

/**
 * @param selected current instance (0 = pre, 1 = post)
 * @param select switch instance (when the other filter's handle is grabbed)
 */
export function buildFilterViz(tab: TabContext, selected: () => number, select: (i: number) => void): VizCanvas {
  const { engine } = tab;
  const p = engine.params;
  const spec = new SpectrumSampler(engine);
  let model: ResponseModel | null = null;
  let resp = new Float32Array(0);
  const respBand = new Float32Array(NUM_BANDS);
  const curves: Curve[] = FILTER_SLOTS.map((slot) => ({
    slot,
    ids: KEYS.map((k) => `${slot}.${k}`),
    on: false,
    vals: new Float64Array(KEYS.length).fill(NaN),
    db: new Float32Array(0),
    bandDb: new Float32Array(NUM_BANDS),
  }));
  let drag: Drag | null = null;
  let hover: FilterSlot | null = null;

  const viz = new VizCanvas(tab.viz, tab, frame, {
    label: 'Pre and post filter responses over the spectrum; per band the level after the filters. Drag the handle: sideways = cutoff, up / down = resonance',
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
  p.subscribeAll(() => {
    model = null;
    viz.dirty = true;
  });
  engine.onStateChange(() => {
    spec.clear();
    viz.dirty = true;
  });

  const yResp = (db: number) => ((DB_TOP - db) / (DB_TOP - DB_BOT)) * viz.h;
  const ySpec = (db: number) => ((SPEC_TOP - db) / (SPEC_TOP - SPEC_BOT)) * viz.h;
  const respDbAt = (f: number) => (model ? dbOf(responseAt(model, f)) : 0);
  spec.synthShape = respDbAt;

  const effective = (id: string) => (p.isModulated(id) ? fromNorm(p.spec(id), p.getEffectiveNorm(id)) : p.get(id));

  /** recompute curves whose on state or effective settings changed; true if any did */
  function updateCurves(): boolean {
    const fs = engine.sampleRate || 48000;
    let changed = false;
    for (const c of curves) {
      const on = p.get(`${c.slot}.on`) >= 0.5;
      if (on !== c.on) {
        c.on = on;
        changed = true;
      }
      let same = true;
      for (let k = 0; k < KEYS.length; k++) {
        const v = effective(c.ids[k]);
        if (v !== c.vals[k]) {
          c.vals[k] = v;
          same = false;
        }
      }
      if (same) continue;
      changed = true;
      const [type, slope, cutoff, res, mix] = c.vals;
      for (let i = 0; i < c.db.length; i++) c.db[i] = dbOf(filterMagnitude(type, slope >= 0.5, cutoff, res, mix, spec.freqAt(i), fs));
      for (let b = 0; b < NUM_BANDS; b++) c.bandDb[b] = dbOf(filterMagnitude(type, slope >= 0.5, cutoff, res, mix, BAND_FREQS[b], fs));
    }
    return changed;
  }

  /** handle position of a curve: on the curve at the effective cutoff, kept inside the frame */
  function handleOf(c: Curve): { x: number; y: number } {
    const fs = engine.sampleRate || 48000;
    const [type, slope, cutoff, res, mix] = c.vals;
    const x = Math.max(6, Math.min(viz.w - 6, xOfFreq(cutoff, viz.w)));
    const db = dbOf(filterMagnitude(type, slope >= 0.5, cutoff, res, mix, cutoff, fs));
    return { x, y: Math.max(10, Math.min(yResp(-30), yResp(db))) };
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
    drawBandGrid(g, w, H, pal);
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

    drawBars(g, pal, H);

    const sel = curves[selected()];
    const other = curves[1 - selected()];
    drawCurve(g, pal, other, false);
    drawCurve(g, pal, sel, true);

    if (!running) cornerNote(g, pal, engine.state === 'error' ? 'AUDIO ERROR' : 'AUDIO OFF · RESPONSE ONLY');
  }

  /** per band: final level (resonator × filters) as a bar, the resonator-only level as a tick */
  function drawBars(g: CanvasRenderingContext2D, pal: Palette, H: number) {
    g.save();
    g.font = monoFont(pal, 9);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (let b = 0; b < NUM_BANDS; b++) {
      let db = respBand[b];
      for (const c of curves) if (c.on) db += c.bandDb[b];
      const x = Math.round(colCenter(b, viz.w) - BAR_W / 2);
      const yTop = Math.min(H - 14, Math.max(2, yResp(db)));
      const grad = g.createLinearGradient(0, yTop, 0, H);
      grad.addColorStop(0, pal.accentSoft);
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.fillRect(x, yTop, BAR_W, H - yTop);
      g.fillStyle = pal.accent;
      g.fillRect(x, Math.round(yTop) - 1, BAR_W, 2);
      // resonator-only level: what the filters take away (or add) is the gap to the bar
      const yRes = Math.min(H - 14, Math.max(2, yResp(respBand[b])));
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
    const name = SLOT_NAME[c.slot];
    const colour = isSel ? pal.text : pal.text3;
    g.save();
    if (!c.on) {
      // off: a faint dashed ghost, still grabbable so it can be set up before switching on
      g.globalAlpha = isSel ? 0.45 : 0.25;
      g.setLineDash([3, 4]);
    }
    strokeTrace(g, c.db, spec.colPx, w, yResp, colour, isSel ? 2 : 1, [-2, H + 2]);
    g.setLineDash([]);
    const hp = handleOf(c);
    const xm = Math.round(hp.x) + 0.5;
    // cutoff marker + name at the foot
    g.save();
    g.strokeStyle = colour;
    g.lineWidth = 1;
    g.globalAlpha *= 0.6;
    g.setLineDash([1, 3]);
    g.beginPath();
    g.moveTo(xm, 0);
    g.lineTo(xm, H - 28);
    g.stroke();
    g.restore();
    g.font = monoFont(pal, 9, 600);
    g.fillStyle = colour;
    g.textBaseline = 'bottom';
    const right = xm > w - 70;
    g.textAlign = right ? 'right' : 'left';
    g.fillText(c.on ? name : `${name} OFF`, right ? xm - 4 : xm + 4, H - 16);

    if (isSel) {
      const active = drag?.slot === c.slot || hover === c.slot;
      g.beginPath();
      g.arc(hp.x, hp.y, active ? 7 : 6, 0, Math.PI * 2);
      g.fillStyle = active ? colour : pal.well;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = colour;
      g.stroke();
      // frequency / resonance next to the handle (effective values; cyan while modulated)
      const cutId = c.ids[CUT];
      const resId = c.ids[RES];
      const fText = formatValue(p.spec(cutId), c.vals[CUT]);
      const rText = `RES ${formatValue(p.spec(resId), c.vals[RES])}`;
      const lx = right ? hp.x - 12 : hp.x + 12;
      const ly = hp.y < 30 ? hp.y + 4 : hp.y - 4;
      g.textAlign = right ? 'right' : 'left';
      g.textBaseline = 'bottom';
      g.font = monoFont(pal, 11, 600);
      g.fillStyle = p.isModulated(cutId) ? pal.mod : colour;
      g.fillText(fText, lx, ly);
      g.font = monoFont(pal, 9);
      g.textBaseline = 'top';
      g.fillStyle = p.isModulated(resId) ? pal.mod : pal.text3;
      g.fillText(rText, lx, ly + 2);
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

  /* ---------- pointer: grab a handle (or its cutoff marker) ---------- */

  const cv = viz.canvas;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (viz.w / r.width), y: (e.clientY - r.top) * (viz.h / r.height) };
  };
  /** the filter whose handle / marker is under (x, y): the selected one first */
  const hitTest = (x: number, y: number): FilterSlot | null => {
    const order = [curves[selected()], curves[1 - selected()]];
    for (const c of order) {
      const hp = handleOf(c);
      if (Math.hypot(x - hp.x, y - hp.y) <= HIT_R) return c.slot;
    }
    for (const c of order) {
      const hp = handleOf(c);
      if (Math.abs(x - hp.x) <= 6 && y < viz.h - 14) return c.slot;
    }
    return null;
  };
  const setHover = (s: FilterSlot | null) => {
    if (s === hover) return;
    hover = s;
    cv.style.cursor = s ? 'grab' : '';
    viz.dirty = true;
  };

  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const { x, y } = local(e);
    const slot = hitTest(x, y);
    if (!slot) return;
    e.preventDefault();
    const idx = FILTER_SLOTS.indexOf(slot);
    if (idx !== selected()) select(idx);
    cv.setPointerCapture(e.pointerId);
    const cutId = `${slot}.cutoff`;
    const resId = `${slot}.res`;
    drag = { slot, pointerId: e.pointerId, x0: x, y0: y, cutX0: xOfFreq(p.get(cutId), viz.w), res0: p.get(resId), lx: x, ly: y, accX: 0, accY: 0 };
    p.beginGesture(cutId);
    p.beginGesture(resId);
    cv.style.cursor = 'grabbing';
    viz.dirty = true;
  });
  cv.addEventListener('pointermove', (e) => {
    const { x, y } = local(e);
    if (!drag || e.pointerId !== drag.pointerId) {
      if (!drag) setHover(hitTest(x, y));
      return;
    }
    const k = e.shiftKey ? FINE : 1;
    drag.accX += (x - drag.lx) * k;
    drag.accY += (y - drag.ly) * k;
    drag.lx = x;
    drag.ly = y;
    const cutId = `${drag.slot}.cutoff`;
    const resId = `${drag.slot}.res`;
    const cs = p.spec(cutId);
    const f = Math.max(cs.min, Math.min(cs.max, freqOfX(drag.cutX0 + drag.accX, viz.w)));
    p.set(cutId, f);
    p.set(resId, Math.max(0, Math.min(1, drag.res0 - drag.accY / RES_DRAG)));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    p.endGesture(`${drag.slot}.cutoff`);
    p.endGesture(`${drag.slot}.res`);
    drag = null;
    const { x, y } = local(e);
    hover = null;
    setHover(hitTest(x, y));
    viz.dirty = true;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('lostpointercapture', end);
  cv.addEventListener('pointerleave', () => {
    if (!drag) setHover(null);
  });
  // double-click on a handle: back to the default cutoff / resonance
  cv.addEventListener('dblclick', (e) => {
    const { x, y } = local(e);
    const slot = hitTest(x, y);
    if (!slot) return;
    for (const id of [`${slot}.cutoff`, `${slot}.res`]) {
      p.beginGesture(id);
      p.reset(id);
      p.endGesture(id);
    }
  });

  return viz;
}
