/**
 * FB tab: the bands. Visualisation = live input / output spectrum with the filterbank response;
 * each band node sits over its fader and glows with its feedback. Control row = per band
 * RES and FB (slot k = band k). Status line = global resonance, spread, feedback state.
 */
import '../../styles/tabs/fb.css';
import type { EngineAPI } from '../../core/types';
import { BAND_FREQS, NUM_BANDS, bandParamId, formatValue } from '../../shared/params';
import { Knob } from '../components/knob';
import { h, toggleClass } from '../dom';
import { readModel, responseAt, type ResponseModel } from '../response';
import { colCenter } from '../shell/bandAxis';
import { freqText } from '../shell/faders';
import { registerTab } from '../shell/tabs';
import { cornerNote, drawBandGrid, drawDbGrid, fillTrace, monoFont, strokeTrace } from '../viz/draw';
import { SPEC_BOT, SPEC_TOP, SpectrumSampler } from '../viz/spectrum';
import { VizCanvas } from '../viz/vizCanvas';

const DB_TOP = 18; // response axis
const DB_BOT = -42;
const GRID_DB = [12, 0, -12, -24, -36];

function statusLine(engine: EngineAPI, el: HTMLElement): void {
  const p = engine.params;
  const val = (id: string) => formatValue(p.spec(id), p.get(id));
  const res = h('b');
  const spread = h('b');
  const fbAll = h('b');
  const bands = h('b');
  const hot = h('span', { class: 'fb-hot' }, h('span', { class: 'led' }), 'HOT');
  el.append(
    h('span', null, 'Resonance ', res),
    h('span', null, 'Spread ', spread),
    h('span', null, 'FB All ', fbAll),
    h('span', null, 'Feedback ', bands),
    h('span', { class: 'tp-spacer' }),
    hot,
  );
  const sync = () => {
    res.textContent = val('resOffset');
    spread.textContent = val('spread');
    fbAll.textContent = p.get('fbAllOn') >= 0.5 ? `on ${val('fbAll')} · tone ${val('fbAllTone')}` : 'off';
    const n = Array.from({ length: NUM_BANDS }, (_, b) => p.get(bandParamId(b, 'fb')) > 0.02).filter(Boolean).length;
    bands.textContent = n ? `${n} band${n === 1 ? '' : 's'}` : 'none';
  };
  sync();
  p.subscribeAll((id) => {
    if (id === 'resOffset' || id === 'spread' || id.startsWith('fbAll') || /^band\d\.fb$/.test(id)) sync();
  });
  let wasHot = false;
  engine.meters.subscribe((f) => {
    const isHot = !!f.hot && engine.state === 'running';
    if (isHot !== wasHot) {
      wasHot = isHot;
      toggleClass(hot, 'is-on', isHot);
    }
  });
}

registerTab({
  id: 'fb',
  reveal: (id) => /^band\d\.(res|fb)$/.test(id),
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    statusLine(engine, tab.status);

    /* ---------- control row: RES + FB per band ---------- */
    for (let b = 0; b < NUM_BANDS; b++) {
      const f = freqText(BAND_FREQS[b]);
      const name = `Band ${b + 1} (${f.value} ${f.unit})`;
      const res = new Knob(p, bandParamId(b, 'res'), { size: 'sm', tone: 'accent', label: 'RES', ariaLabel: `${name} resonance` });
      const fb = new Knob(p, bandParamId(b, 'fb'), { size: 'sm', tone: 'fb', label: 'FB', ariaLabel: `${name} feedback` });
      tab.slots[b].append(res.el, fb.el);
    }

    /* ---------- visualisation ---------- */
    const spec = new SpectrumSampler(engine);
    let model: ResponseModel | null = null;
    let resp = new Float32Array(0);
    const fbAmt = new Float32Array(NUM_BANDS);
    const hot = new Uint8Array(NUM_BANDS);
    const viz = new VizCanvas(tab.viz, tab, frame, {
      label: 'Spectrum and filterbank response; one node per band, over its fader',
      onResize: (s) => {
        spec.resize(s.w);
        resp = new Float32Array(spec.cols);
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
    const respDbAt = (f: number) => (model ? 20 * Math.log10(Math.max(1e-6, responseAt(model, f))) : 0);
    spec.synthShape = respDbAt;

    function frame(dt: number) {
      const running = engine.state === 'running';
      const f = engine.meters.latest();
      const fbAll = p.get('fbAllOn') >= 0.5 ? p.get('fbAll') : 0;
      let changed = false;
      for (let b = 0; b < NUM_BANDS; b++) {
        const a = Math.min(1, p.get(bandParamId(b, 'fb')) + fbAll);
        const isHot = f?.hot && running && a > 0.02 ? 1 : 0;
        if (a !== fbAmt[b] || isHot !== hot[b]) {
          fbAmt[b] = a;
          hot[b] = isHot;
          changed = true;
        }
      }
      if (!running && !viz.dirty && !changed) return;
      if (!model) {
        model = readModel(p);
        for (let i = 0; i < resp.length; i++) resp[i] = respDbAt(spec.freqAt(i));
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
        fillTrace(g, spec.dispOut, spec.colPx, w, H, ySpec, pal.specOut, pal.accent);
      }
      // response: soft fill + line
      g.save();
      g.beginPath();
      g.moveTo(0, H);
      for (let i = 0; i < resp.length; i++) g.lineTo(Math.min(w, i * spec.colPx), yResp(resp[i]));
      g.lineTo(w, H);
      g.closePath();
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, pal.accentSoft);
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.fill();
      g.restore();
      strokeTrace(g, resp, spec.colPx, w, yResp, pal.accent, 1.5);

      // band nodes over their faders: ring grows with feedback, red while hot
      g.font = monoFont(pal, 9);
      for (let b = 0; b < NUM_BANDS; b++) {
        const x = colCenter(b, w);
        const db = respDbAt(BAND_FREQS[b]);
        const y = Math.max(8, Math.min(H - 16, yResp(db)));
        const a = fbAmt[b];
        if (a > 0.02) {
          g.beginPath();
          g.arc(x, y, 5 + a * 9, 0, Math.PI * 2);
          g.strokeStyle = hot[b] ? pal.fb : pal.fbSoft;
          g.lineWidth = hot[b] ? 2 : 1.5;
          g.stroke();
        }
        g.beginPath();
        g.arc(x, y, 3.2, 0, Math.PI * 2);
        g.fillStyle = pal.well;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = hot[b] ? pal.fb : a > 0.02 ? pal.fb : pal.accent;
        g.stroke();
        g.fillStyle = pal.text3;
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillText(`${db >= 0 ? '+' : ''}${db.toFixed(1)}`, x, y - 8);
      }
      if (!running) cornerNote(g, pal, engine.state === 'error' ? 'AUDIO ERROR' : 'AUDIO OFF · RESPONSE ONLY');
    }
  },
});
