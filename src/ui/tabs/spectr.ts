/**
 * SPECTR tab: the analyser as a page. Input and output spectra on the band axis (each band's
 * centre over its fader), optional peak hold, freeze, the filterbank response as a guide and a
 * crosshair readout. Status line = loudest output frequency, view and display switches.
 */
import '../../styles/tabs/spectr.css';
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';
import { h, toggleClass } from '../dom';
import { readModel, responseAt, type ResponseModel } from '../response';
import { colCenter, freqOfX } from '../shell/bandAxis';
import { registerTab } from '../shell/tabs';
import { cornerNote, drawBandGrid, drawDbGrid, fillTrace, formatHz, monoFont, strokeTrace } from '../viz/draw';
import { SPEC_BOT, SPEC_TOP, SpectrumSampler } from '../viz/spectrum';
import { VizCanvas } from '../viz/vizCanvas';

type View = 'in' | 'out' | 'both';
interface Settings {
  view: View;
  hold: boolean;
  resp: boolean;
}
const STORE_KEY = 'resonator.spectr';
const GRID_DB = [-24, -48, -72, -96];
/** response guide axis (relative dB), as on the FB tab */
const RESP_TOP = 18;
const RESP_BOT = -42;
/** status peak readout refresh */
const PEAK_MS = 200;

function loadSettings(): Settings {
  const d: Settings = { view: 'both', hold: true, resp: true };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Settings> | null;
    if (s && typeof s === 'object') {
      if (s.view === 'in' || s.view === 'out' || s.view === 'both') d.view = s.view;
      if (typeof s.hold === 'boolean') d.hold = s.hold;
      if (typeof s.resp === 'boolean') d.resp = s.resp;
    }
  } catch {
    /* storage unavailable: defaults */
  }
  return d;
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* not persisted */
  }
}

/** nearest band to a frequency (log distance) */
function nearestBand(f: number): number {
  let best = 0;
  for (let b = 1; b < NUM_BANDS; b++) if (Math.abs(Math.log(f / BAND_FREQS[b])) < Math.abs(Math.log(f / BAND_FREQS[best]))) best = b;
  return best;
}

registerTab({
  id: 'spectr',
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const set = loadSettings();
    let frozen = false;

    /* ---------- status line ---------- */
    const peak = h('b', { class: 'sp-peak' }, '–');
    const btn = (label: string, title: string) => h('button', { type: 'button', class: 'inst-btn', title }, label);
    const views: Record<View, HTMLButtonElement> = { in: btn('IN', 'Show the input spectrum'), out: btn('OUT', 'Show the output spectrum'), both: btn('BOTH', 'Show input and output') };
    const holdBtn = btn('HOLD', 'Peak hold: keep the loudest level per frequency for a moment');
    const freezeBtn = btn('FREEZE', 'Freeze the picture');
    const respBtn = btn('RESP', 'Filterbank response as a guide');
    tab.status.append(
      h('span', { class: 'sp-st' }, 'Loudest out ', peak),
      h('span', { class: 'tp-spacer' }),
      h('span', { class: 'inst', role: 'group', 'aria-label': 'Spectrum view' }, views.in, views.out, views.both),
      h('span', { class: 'inst', role: 'group', 'aria-label': 'Display' }, holdBtn, respBtn, freezeBtn),
    );
    const syncButtons = () => {
      for (const v of Object.keys(views) as View[]) {
        toggleClass(views[v], 'is-selected', set.view === v);
        views[v].setAttribute('aria-pressed', String(set.view === v));
      }
      for (const [b, on] of [
        [holdBtn, set.hold],
        [respBtn, set.resp],
        [freezeBtn, frozen],
      ] as const) {
        toggleClass(b, 'is-selected', on);
        b.setAttribute('aria-pressed', String(on));
      }
      viz.dirty = true;
    };
    for (const v of Object.keys(views) as View[])
      views[v].addEventListener('click', () => {
        set.view = v;
        saveSettings(set);
        syncButtons();
      });
    holdBtn.addEventListener('click', () => {
      set.hold = !set.hold;
      saveSettings(set);
      syncButtons();
    });
    respBtn.addEventListener('click', () => {
      set.resp = !set.resp;
      saveSettings(set);
      syncButtons();
    });
    freezeBtn.addEventListener('click', () => {
      frozen = !frozen;
      syncButtons();
    });

    /* ---------- picture ---------- */
    const body = tab.useBody();
    body.classList.add('sp-body');
    const spec = new SpectrumSampler(engine, { peakHold: true, holdMs: 1500 });
    let model: ResponseModel | null = null;
    let resp = new Float32Array(0);
    let peakAge = PEAK_MS;
    let cursor: { x: number; y: number } | null = null;
    const viz = new VizCanvas(body, tab, frame, {
      label: 'Input and output spectrum on the band axis',
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

    const ySpec = (db: number) => Math.min(1, (SPEC_TOP - db) / (SPEC_TOP - SPEC_BOT)) * (viz.h - 18);
    const yResp = (db: number) => ((RESP_TOP - db) / (RESP_TOP - RESP_BOT)) * (viz.h - 18);
    const respDbAt = (f: number) => (model ? 20 * Math.log10(Math.max(1e-6, responseAt(model, f))) : 0);
    spec.synthShape = respDbAt;

    viz.canvas.addEventListener('pointermove', (e) => {
      const r = viz.canvas.getBoundingClientRect();
      cursor = { x: (e.clientX - r.left) * (viz.w / r.width), y: (e.clientY - r.top) * (viz.h / r.height) };
      viz.dirty = true;
    });
    viz.canvas.addEventListener('pointerleave', () => {
      cursor = null;
      viz.dirty = true;
    });

    function frame(dt: number) {
      const running = engine.state === 'running';
      if (!model) {
        model = readModel(p);
        for (let i = 0; i < resp.length; i++) resp[i] = respDbAt(spec.freqAt(i));
        viz.dirty = true;
      }
      const live = running && !frozen;
      if (!live && !viz.dirty) return;
      if (live) spec.update(dt);
      draw(running);
      viz.dirty = false;
      peakAge += dt;
      if (peakAge >= PEAK_MS) {
        peakAge = 0;
        updatePeak(running);
      }
    }

    function updatePeak(running: boolean) {
      if (!running || !spec.cols) {
        peak.textContent = '–';
        return;
      }
      let best = 0;
      for (let i = 1; i < spec.cols; i++) if (spec.dispOut[i] > spec.dispOut[best]) best = i;
      const db = spec.dispOut[best];
      if (db <= SPEC_BOT + 1) {
        peak.textContent = 'silence';
        return;
      }
      const f = spec.freqAt(best);
      peak.textContent = `${formatHz(f)} Hz · ${db.toFixed(0)} dBFS · near band ${nearestBand(f) + 1}`;
    }

    function draw(running: boolean) {
      const g = viz.begin();
      const { w, h: H, pal } = viz;
      const plotH = H - 18;
      drawBandGrid(g, w, H, pal);
      drawDbGrid(g, w, pal, GRID_DB, ySpec, ' dB');
      g.fillStyle = pal.line;
      g.fillRect(0, plotH, w, 1);

      if (running) {
        const showIn = set.view !== 'out';
        const showOut = set.view !== 'in';
        if (showIn) fillTrace(g, spec.dispIn, spec.colPx, w, plotH, ySpec, pal.specIn, set.view === 'in' ? pal.text2 : null);
        if (showOut) fillTrace(g, spec.dispOut, spec.colPx, w, plotH, ySpec, pal.specOut, pal.accent, 0.9);
        if (set.hold) {
          g.save();
          g.globalAlpha = 0.4;
          if (showIn) strokeTrace(g, spec.peakIn, spec.colPx, w, ySpec, pal.text3, 1, [0, plotH]);
          if (showOut) strokeTrace(g, spec.peakOut, spec.colPx, w, ySpec, pal.accent, 1, [0, plotH]);
          g.restore();
        }
      }
      if (set.resp) {
        g.save();
        g.setLineDash([3, 4]);
        g.globalAlpha = 0.5;
        strokeTrace(g, resp, spec.colPx, w, yResp, pal.text2, 1, [0, plotH]);
        g.restore();
        // band nodes on the guide, over their faders
        for (let b = 0; b < NUM_BANDS; b++) {
          const x = colCenter(b, w);
          const y = Math.max(6, Math.min(plotH - 6, yResp(respDbAt(BAND_FREQS[b]))));
          g.beginPath();
          g.arc(x, y, 2.6, 0, Math.PI * 2);
          g.fillStyle = pal.well;
          g.fill();
          g.lineWidth = 1.25;
          g.strokeStyle = pal.text3;
          g.stroke();
        }
      }

      // legend
      g.font = monoFont(pal, 9);
      g.textBaseline = 'middle';
      let lx = 10;
      const item = (color: string, text: string, dashed = false) => {
        g.save();
        g.strokeStyle = color;
        g.lineWidth = 2;
        if (dashed) g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(lx, 12.5);
        g.lineTo(lx + 12, 12.5);
        g.stroke();
        g.restore();
        g.fillStyle = pal.text3;
        g.fillText(text, lx + 16, 13);
        lx += 22 + g.measureText(text).width + 10;
      };
      if (running) {
        if (set.view !== 'out') item(pal.text3, 'INPUT');
        if (set.view !== 'in') item(pal.accent, 'OUTPUT');
        if (set.hold) item(pal.text3, 'PEAK HOLD');
      }
      if (set.resp) item(pal.text2, 'RESPONSE (SHAPE)', true);
      if (frozen) item(pal.mod, 'FROZEN');

      // crosshair readout
      if (cursor && cursor.y < plotH) {
        const x = Math.round(cursor.x) + 0.5;
        g.save();
        g.strokeStyle = pal.lineStrong;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, plotH);
        g.stroke();
        g.restore();
        const i = Math.max(0, Math.min(spec.cols - 1, Math.floor(cursor.x / spec.colPx)));
        const f = freqOfX(cursor.x, w);
        const lines = [`${formatHz(f)} Hz`];
        if (running) {
          if (set.view !== 'out') lines.push(`IN  ${spec.dispIn[i].toFixed(0)} dB`);
          if (set.view !== 'in') lines.push(`OUT ${spec.dispOut[i].toFixed(0)} dB`);
        }
        g.font = monoFont(pal, 10);
        const bw = Math.max(...lines.map((t) => g.measureText(t).width)) + 14;
        const bh = lines.length * 14 + 8;
        const bx = cursor.x + 10 + bw > w ? cursor.x - 10 - bw : cursor.x + 10;
        const by = Math.max(4, Math.min(plotH - bh - 4, cursor.y - bh / 2));
        g.fillStyle = pal.panel;
        g.strokeStyle = pal.lineStrong;
        g.beginPath();
        g.roundRect(bx, by, bw, bh, 4);
        g.fill();
        g.stroke();
        g.fillStyle = pal.text;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        lines.forEach((t, k) => g.fillText(t, bx + 7, by + 5 + k * 14));
      }

      if (!running) {
        g.save();
        g.translate(0, 18);
        cornerNote(g, pal, engine.state === 'error' ? 'AUDIO ERROR' : 'AUDIO OFF · NO SPECTRUM');
        g.restore();
      }
    }

    syncButtons();
  },
});
