/**
 * FB tab: the bands. Visualisation = live input / output spectrum with the filterbank response;
 * each band node sits over its fader and glows with its feedback. Control row = per band
 * RES, FB and WOB (slot k = band k). Status line = global resonance, spread, feedback state and
 * DICE (RES/BAND and FB/BAND under RESET sit in the global column).
 * The hardware's function keys in FB mode: holding WOB wobbles the band ±10 % of fader travel, one
 * sine per beat of the master clock (engine.wobble, a DSP layer, never saved); DICE sets all band
 * levels at random (channel.ts rollLevels).
 * L/R per band: the response follows the channel switch (L, R, or both averaged); once the
 * channels differ, the other channel(s) show as thin dashed lines. A node's ring is split: left
 * half L feedback, right half R feedback.
 */
import '../../styles/tabs/fb.css';
import type { EngineAPI } from '../../core/types';
import { BAND_FREQS, NUM_BANDS, bandParamId, bandParamIdR, formatValue } from '../../shared/params';
import { channelSel, rollLevels, DICE_MAX_DB, DICE_MIN_DB } from '../channel';
import { Knob } from '../components/knob';
import { h, toggleClass } from '../dom';
import { bandResFb, readModel, responseAt, type ModelChannel, type ResponseModel } from '../response';
import { colCenter } from '../shell/bandAxis';
import { freqText } from '../shell/faders';
import { registerTab } from '../shell/tabs';
import { cornerNote, drawBandGrid, drawDbGrid, fillTrace, monoFont, strokeTrace } from '../viz/draw';
import { SPEC_BOT, SPEC_TOP, SpectrumSampler } from '../viz/spectrum';
import { VizCanvas } from '../viz/vizCanvas';

const DB_TOP = 18; // response axis
const DB_BOT = -42;
const GRID_DB = [12, 0, -12, -24, -36];

/** the channel(s) a wobble takes, from the L · L+R · R switch */
const WOB_CH = { LR: 0, L: 1, R: 2 } as const;

/** WOB: hold it and the band wobbles (the hardware's function key in FB mode); mouse, touch or Enter */
function wobKey(engine: EngineAPI, b: number, name: string): HTMLElement {
  const key = h(
    'button',
    { type: 'button', class: 'fb-wob', title: 'Hold: the band wobbles ±10 % around its fader, one sine per beat of the clock', 'aria-label': `${name}: hold to wobble` },
    h('span', { class: 'fb-wob-key' }, h('span', { class: 'led', 'aria-hidden': 'true' })),
    h('span', { class: 'fb-wob-name' }, 'WOB'),
  );
  let held = false;
  const press = () => {
    if (held) return;
    held = true;
    engine.wobble(b, true, WOB_CH[channelSel.get()]);
    toggleClass(key, 'is-on', true);
  };
  const release = () => {
    if (!held) return;
    held = false;
    engine.wobble(b, false);
    toggleClass(key, 'is-on', false);
  };
  key.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    key.setPointerCapture?.(e.pointerId);
    press();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'] as const) key.addEventListener(ev, release);
  key.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) press();
  });
  key.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') release();
  });
  window.addEventListener('blur', release);
  return key;
}

function statusLine(engine: EngineAPI, el: HTMLElement): void {
  const p = engine.params;
  const val = (id: string) => formatValue(p.spec(id), p.get(id));
  const res = h('b');
  const spread = h('b');
  const fbAll = h('b');
  const bands = h('b');
  const hot = h('span', { class: 'fb-hot' }, h('span', { class: 'led' }), 'HOT');
  const dice = h(
    'button',
    { type: 'button', class: 'inst-btn', title: `All 10 band levels to random fader positions (${DICE_MIN_DB} … +${DICE_MAX_DB} dB), in the channel(s) of the switch` },
    'DICE',
  );
  dice.addEventListener('click', () => rollLevels(p, channelSel.get()));
  el.append(
    h('span', null, 'Resonance ', res),
    h('span', null, 'Spread ', spread),
    h('span', null, 'FB All ', fbAll),
    h('span', null, 'Feedback ', bands),
    h('span', { class: 'tp-spacer' }),
    h('span', { class: 'inst', role: 'group', 'aria-label': 'Band levels' }, dice),
    hot,
  );
  const allText = (on: string, amt: string) => (p.get(on) >= 0.5 ? `on ${val(amt)}` : 'off');
  const sync = () => {
    res.textContent = `${val('resOffset')}${p.get('reso.knob') >= 0.5 ? ' (feedback)' : ''}`;
    spread.textContent = `${val('spread')}${p.get('reso.spread') >= 0.5 ? ' (classic)' : ''}`;
    const l = allText('fbAllOn', 'fbAll');
    const r = allText('fbAllOnR', 'fbAllR');
    const anyOn = p.get('fbAllOn') >= 0.5 || p.get('fbAllOnR') >= 0.5;
    fbAll.textContent = (l === r ? l : `L ${l} · R ${r}`) + (anyOn ? ` · tone ${val('fbAllTone')}` : '');
    // a band counts once, whichever channel feeds back
    const n = Array.from({ length: NUM_BANDS }, (_, b) => Math.max(p.get(bandParamId(b, 'fb')), p.get(bandParamIdR(b, 'fb'))) > 0.02).filter(Boolean).length;
    bands.textContent = (n ? `${n} band${n === 1 ? '' : 's'}` : 'none') + (p.get('reso.route') >= 0.5 ? ' · common' : '');
  };
  sync();
  p.subscribeAll((id) => {
    if (id === 'resOffset' || id === 'spread' || id.startsWith('fbAll') || id.startsWith('reso.') || /^band\d\.fbR?$/.test(id)) sync();
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
  reveal: (id) => /^band\d\.(res|fb)R?$/.test(id),
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
      tab.slots[b].append(res.el, fb.el, wobKey(engine, b, name));
    }

    /* ---------- visualisation ---------- */
    const spec = new SpectrumSampler(engine);
    let model: ResponseModel | null = null;
    let resp = new Float32Array(0);
    // the channels the main line does not show, once L and R differ (thin, dashed)
    let others: { ch: 'L' | 'R'; resp: Float32Array }[] = [];
    // the two channels (after SPREAD), for the per-band L and R values at the nodes
    let models: [ResponseModel, ResponseModel] | null = null;
    const fbAmt = new Float32Array(NUM_BANDS * 2); // [b*2 + ch], signed feedback magnitude per channel
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
    channelSel.onChange(() => {
      model = null;
      viz.dirty = true;
    });
    engine.onStateChange(() => {
      spec.clear();
      viz.dirty = true;
    });

    const yResp = (db: number) => ((DB_TOP - db) / (DB_TOP - DB_BOT)) * viz.h;
    const ySpec = (db: number) => ((SPEC_TOP - db) / (SPEC_TOP - SPEC_BOT)) * viz.h;
    const dbOf = (m: ResponseModel, f: number) => 20 * Math.log10(Math.max(1e-6, responseAt(m, f)));
    const respDbAt = (f: number) => (model ? dbOf(model, f) : 0);
    spec.synthShape = respDbAt;
    const sameModel = (a: ResponseModel, b: ResponseModel) => a.gains.every((g, i) => Math.abs(g - b.gains[i]) < 1e-9 && Math.abs(a.qs[i] - b.qs[i]) < 1e-9);

    /** the main model follows the channel switch; the other channels are kept while L and R differ */
    function buildModels(): void {
      const c = channelSel.get();
      const ml = readModel(p, undefined, 0);
      const mr = readModel(p, undefined, 1);
      const main: ModelChannel = c === 'L' ? 0 : c === 'R' ? 1 : 'both';
      model = main === 0 ? ml : main === 1 ? mr : readModel(p, undefined, 'both');
      for (let i = 0; i < resp.length; i++) resp[i] = respDbAt(spec.freqAt(i));
      others = [];
      models = null;
      if (sameModel(ml, mr)) return;
      models = [ml, mr];
      const add = (ch: 'L' | 'R', m: ResponseModel) => {
        const r = new Float32Array(resp.length);
        for (let i = 0; i < r.length; i++) r[i] = dbOf(m, spec.freqAt(i));
        others.push({ ch, resp: r });
      };
      if (c !== 'L') add('L', ml);
      if (c !== 'R') add('R', mr);
    }

    function frame(dt: number) {
      const running = engine.state === 'running';
      const f = engine.meters.latest();
      let changed = false;
      for (let b = 0; b < NUM_BANDS; b++) {
        const al = Math.abs(bandResFb(p, b, 0).fb);
        const ar = Math.abs(bandResFb(p, b, 1).fb);
        const isHot = f?.hot && running && Math.max(al, ar) > 0.02 ? 1 : 0;
        if (al !== fbAmt[b * 2] || ar !== fbAmt[b * 2 + 1] || isHot !== hot[b]) {
          fbAmt[b * 2] = al;
          fbAmt[b * 2 + 1] = ar;
          hot[b] = isHot;
          changed = true;
        }
      }
      if (!running && !viz.dirty && !changed) return;
      if (!model) buildModels();
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
      // L and R differ: the channels the main line does not show, thin and dashed, with their letter
      g.font = monoFont(pal, 9);
      for (const o of others) {
        g.save();
        g.setLineDash([4, 3]);
        strokeTrace(g, o.resp, spec.colPx, w, yResp, pal.text2, 1);
        g.restore();
        // the letter where this line is farthest from the main line, on its far side
        let k = 0;
        for (let i = Math.floor(resp.length * 0.05); i < resp.length * 0.95; i++) if (Math.abs(o.resp[i] - resp[i]) > Math.abs(o.resp[k] - resp[k])) k = i;
        g.fillStyle = pal.text2;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(o.ch, Math.min(w - 8, k * spec.colPx + 9), Math.max(8, Math.min(H - 8, yResp(o.resp[k]) + (o.resp[k] >= resp[k] ? -8 : 8))));
      }
      strokeTrace(g, resp, spec.colPx, w, yResp, pal.accent, 1.5);

      // band nodes over their faders: ring grows with feedback, red while hot; left half L, right half R
      for (let b = 0; b < NUM_BANDS; b++) {
        const x = colCenter(b, w);
        const db = respDbAt(BAND_FREQS[b]);
        const y = Math.max(8, Math.min(H - 16, yResp(db)));
        const al = fbAmt[b * 2];
        const ar = fbAmt[b * 2 + 1];
        const a = Math.max(al, ar);
        for (const [amt, a0, a1] of [
          [al, Math.PI / 2, Math.PI * 1.5],
          [ar, -Math.PI / 2, Math.PI / 2],
        ]) {
          if (amt <= 0.02) continue;
          g.beginPath();
          g.arc(x, y, 5 + amt * 9, a0, a1);
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
        const dbText = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
        // L and R differ at this band (levels, RES, SPREAD …): both values
        const dl = models ? dbOf(models[0], BAND_FREQS[b]) : db;
        const dr = models ? dbOf(models[1], BAND_FREQS[b]) : db;
        g.fillText(Math.abs(dl - dr) >= 0.05 ? `L${dbText(dl)} R${dbText(dr)}` : dbText(db), x, y - 8);
      }
      if (!running) cornerNote(g, pal, engine.state === 'error' ? 'AUDIO ERROR' : 'AUDIO OFF · RESPONSE ONLY');
    }
  },
});
