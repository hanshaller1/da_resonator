/**
 * SPECTR tab: the analyser as a page. Two spectra on the band axis (each band's centre over its
 * fader), chosen as a pair like on the hardware: OUT L·R, IN L·R, L IN·OUT, R IN·OUT, or input and
 * output with L and R together (IN·OUT). A Lissajous figure of the same pair (X = first, Y =
 * second), optional peak hold with an adjustable drop, freeze, the filterbank response as a guide
 * and a crosshair readout. Status line = loudest frequency of the second trace, pair and display switches.
 */
import '../../styles/tabs/spectr.css';
import type { ChannelAnalysers, EngineAPI } from '../../core/types';
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';
import { stepper } from '../components/stepper';
import { h, toggleClass } from '../dom';
import { readModel, responseAt, type ResponseModel } from '../response';
import { colCenter, freqOfX } from '../shell/bandAxis';
import { registerTab } from '../shell/tabs';
import { cornerNote, drawBandGrid, drawDbGrid, fillTrace, formatHz, monoFont, strokeTrace } from '../viz/draw';
import { Lissajous } from '../viz/lissajous';
import { SPEC_BOT, SPEC_TOP, SpectrumSampler, type SynthTrace } from '../viz/spectrum';
import { VizCanvas } from '../viz/vizCanvas';

type Pair = 'sum' | 'out' | 'in' | 'l' | 'r';
interface PairDef {
  label: string;
  title: string;
  /** names of trace A (grey, X of the figure) and trace B (accent, Y) */
  a: string;
  b: string;
  pick(e: EngineAPI, lr: ChannelAnalysers | null): [AnalyserNode | null, AnalyserNode | null];
  synth: [SynthTrace, SynthTrace];
}
const IN = (ch: 0 | 1 | -1): SynthTrace => ({ kind: 'in', ch });
const OUT = (ch: 0 | 1 | -1): SynthTrace => ({ kind: 'out', ch });
/** the display pairs, in button order (hardware: OUT L & R, IN L & R, L IN & OUT, R IN & OUT) */
const PAIRS: Record<Pair, PairDef> = {
  sum: { label: 'IN·OUT', title: 'Input and output, L and R together', a: 'INPUT', b: 'OUTPUT', pick: (e) => [e.analyserIn, e.analyserOut], synth: [IN(-1), OUT(-1)] },
  out: { label: 'OUT L·R', title: 'Left and right output', a: 'OUT L', b: 'OUT R', pick: (_e, lr) => [lr?.outL ?? null, lr?.outR ?? null], synth: [OUT(0), OUT(1)] },
  in: { label: 'IN L·R', title: 'Left and right input', a: 'IN L', b: 'IN R', pick: (_e, lr) => [lr?.inL ?? null, lr?.inR ?? null], synth: [IN(0), IN(1)] },
  l: { label: 'L IN·OUT', title: 'Left input and left output', a: 'IN L', b: 'OUT L', pick: (_e, lr) => [lr?.inL ?? null, lr?.outL ?? null], synth: [IN(0), OUT(0)] },
  r: { label: 'R IN·OUT', title: 'Right input and right output', a: 'IN R', b: 'OUT R', pick: (_e, lr) => [lr?.inR ?? null, lr?.outR ?? null], synth: [IN(1), OUT(1)] },
};
const PAIR_ORDER = Object.keys(PAIRS) as Pair[];
/** peak-hold drop speeds (dB per second after the hold), slow to fast */
const DROPS = [3, 6, 12, 24, 48, 96, 192];
const DROP_DEF = 3;
/** how long a peak stays before it drops */
const HOLD_MS = 1500;

interface Settings {
  pair: Pair;
  hold: boolean;
  /** index into DROPS */
  drop: number;
  /** Lissajous figure shown */
  xy: boolean;
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
  const d: Settings = { pair: 'sum', hold: true, drop: DROP_DEF, xy: true, resp: true };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Settings> | null;
    if (s && typeof s === 'object') {
      if (typeof s.pair === 'string' && s.pair in PAIRS) d.pair = s.pair;
      if (typeof s.hold === 'boolean') d.hold = s.hold;
      if (typeof s.drop === 'number' && DROPS[s.drop] !== undefined) d.drop = s.drop;
      if (typeof s.xy === 'boolean') d.xy = s.xy;
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
    const peakName = h('span', { class: 'sp-st' });
    const peak = h('b', { class: 'sp-peak' }, '–');
    const btn = (label: string, title: string) => h('button', { type: 'button', class: 'inst-btn', title }, label);
    const pairs = Object.fromEntries(PAIR_ORDER.map((k) => [k, btn(PAIRS[k].label, PAIRS[k].title)])) as Record<Pair, HTMLButtonElement>;
    const holdBtn = btn('HOLD', 'Peak hold: keep the loudest level per frequency for a moment, then let it drop');
    const drop = stepper(
      'Peak drop',
      () => set.drop,
      (v) => {
        const i = Math.max(0, Math.min(DROPS.length - 1, v));
        if (i === set.drop) return;
        set.drop = i;
        spec.dropDbPerSec = DROPS[i];
        saveSettings(set);
        drop.sync();
      },
      (i) => `${DROPS[i]} dB/s`,
    );
    drop.el.classList.add('sp-drop');
    drop.el.title = 'How fast the peaks drop after the hold';
    const xyBtn = btn('XY', 'Lissajous figure of the pair: first on X, second on Y');
    const freezeBtn = btn('FREEZE', 'Freeze the picture');
    const respBtn = btn('RESP', 'Filterbank response as a guide');
    tab.status.append(
      h('span', { class: 'sp-st' }, peakName, peak),
      h('span', { class: 'tp-spacer' }),
      h('span', { class: 'inst', role: 'group', 'aria-label': 'Spectrum pair' }, ...PAIR_ORDER.map((k) => pairs[k])),
      h('span', { class: 'inst', role: 'group', 'aria-label': 'Peak hold' }, holdBtn, drop.el),
      h('span', { class: 'inst', role: 'group', 'aria-label': 'Display' }, xyBtn, respBtn, freezeBtn),
    );
    const syncButtons = () => {
      for (const k of PAIR_ORDER) {
        toggleClass(pairs[k], 'is-selected', set.pair === k);
        pairs[k].setAttribute('aria-pressed', String(set.pair === k));
      }
      for (const [b, on] of [
        [holdBtn, set.hold],
        [xyBtn, set.xy],
        [respBtn, set.resp],
        [freezeBtn, frozen],
      ] as const) {
        toggleClass(b, 'is-selected', on);
        b.setAttribute('aria-pressed', String(on));
      }
      toggleClass(drop.el, 'is-off', !set.hold);
      peakName.textContent = `Loudest ${PAIRS[set.pair].b} `;
      viz.dirty = true;
    };
    const usePair = () => {
      const d = PAIRS[set.pair];
      spec.pick = () => d.pick(engine, engine.analysersLR);
      spec.synthTraces = d.synth;
      spec.clear();
      xy.clear();
    };
    for (const k of PAIR_ORDER)
      pairs[k].addEventListener('click', () => {
        if (set.pair === k) return;
        set.pair = k;
        saveSettings(set);
        usePair();
        syncButtons();
      });
    holdBtn.addEventListener('click', () => {
      set.hold = !set.hold;
      saveSettings(set);
      syncButtons();
    });
    xyBtn.addEventListener('click', () => {
      set.xy = !set.xy;
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
    const spec = new SpectrumSampler(engine, { peakHold: true, holdMs: HOLD_MS, dropDbPerSec: DROPS[set.drop] });
    const xy = new Lissajous();
    let model: ResponseModel | null = null;
    let resp = new Float32Array(0);
    let peakAge = PEAK_MS;
    let cursor: { x: number; y: number } | null = null;
    const viz = new VizCanvas(body, tab, frame, {
      label: 'Spectra of two signals on the band axis and their Lissajous figure',
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
      xy.clear();
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
      if (live) {
        spec.update(dt);
        if (set.xy) readXY(dt);
      }
      draw(running);
      viz.dirty = false;
      peakAge += dt;
      if (peakAge >= PEAK_MS) {
        peakAge = 0;
        updatePeak(running);
      }
    }

    /** the pair's time signals for the Lissajous figure (mock engine: from the level meters) */
    function readXY(dt: number) {
      const [a, b] = PAIRS[set.pair].pick(engine, engine.analysersLR);
      if (a && b) {
        xy.read(a, b, dt);
        return;
      }
      const fr = engine.meters.latest();
      const lvl = (t: SynthTrace) => {
        const pr = t.kind === 'in' ? fr?.inPeak : fr?.outPeak;
        return pr ? (t.ch === -1 ? Math.max(pr[0], pr[1]) : pr[t.ch]) : 0;
      };
      const [sa, sb] = PAIRS[set.pair].synth;
      xy.synth(lvl(sa), lvl(sb), dt);
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

      const pd = PAIRS[set.pair];
      if (running) {
        fillTrace(g, spec.dispIn, spec.colPx, w, plotH, ySpec, pal.specIn, null);
        fillTrace(g, spec.dispOut, spec.colPx, w, plotH, ySpec, pal.specOut, pal.accent, 0.9);
        if (set.hold) {
          g.save();
          g.globalAlpha = 0.4;
          strokeTrace(g, spec.peakIn, spec.colPx, w, ySpec, pal.text3, 1, [0, plotH]);
          strokeTrace(g, spec.peakOut, spec.colPx, w, ySpec, pal.accent, 1, [0, plotH]);
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
        item(pal.text3, pd.a);
        item(pal.accent, pd.b);
        if (set.hold) item(pal.text3, `PEAK HOLD ${DROPS[set.drop]} dB/s`);
      }
      if (set.resp) item(pal.text2, 'RESPONSE (SHAPE)', true);
      if (frozen) item(pal.mod, 'FROZEN');

      // Lissajous figure of the pair, top right
      if (running && set.xy) {
        const size = Math.min(170, plotH - 16);
        xy.draw(g, w - size - 46, 8, size, pal, pd.a, pd.b);
      }

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
          const pad = Math.max(pd.a.length, pd.b.length) + 1;
          lines.push(`${pd.a.padEnd(pad)}${spec.dispIn[i].toFixed(0)} dB`);
          lines.push(`${pd.b.padEnd(pad)}${spec.dispOut[i].toFixed(0)} dB`);
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

    usePair();
    syncButtons();
  },
});
