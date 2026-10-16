/**
 * LFO MOD tab: LFO 1–4, with the clock of the selected LFO in the status line (tempo, INT · MIDI
 * (param lfoN.clk), beat LEDs). Control
 * row = the selected LFO (SHAPE … UNI). RATE or DIV, whichever was set last, decides the speed:
 * turning RATE lets the LFO run free, choosing a DIV syncs it to the clock (param lfoN.sync, no
 * button of its own). Visualisation = two cycles of its waveform as set (shape, morph, phase,
 * smooth, level, polarity) next to a scrolling trace of its live output, and its targets on the right.
 */
import { DIVISIONS } from '../../shared/paramdefs/types';
import { NUM_LFOS } from '../../shared/paramdefs/modules';
import { formatValue } from '../../shared/params';
import { Knob } from '../components/knob';
import { ParamSelect } from '../components/select';
import { ParamToggle } from '../components/toggle';
import { clockStatus, clockView, followedClock } from '../clock';
import { toggleClass } from '../dom';
import { registerTab } from '../shell/tabs';
import { monoFont } from '../viz/draw';
import { VizCanvas } from '../viz/vizCanvas';
import { History, SourceTab, effective, onReadouts, picNote } from './lfo/sourceTab';

/** what MORPH does per shape (LFO_SHAPES order, see the DSP) */
const MORPH_NAMES = ['SKEW', 'SKEW', 'TILT', 'WIDTH', 'HOLD', 'HOLD'];
const MORPH_HINTS = [
  'Morph: skew (faster rise, slower fall)',
  'Morph: skew (faster rise, slower fall)',
  'Morph: saw up → triangle → ramp down',
  'Morph: pulse width 50% → 2%',
  'Morph: chance a step keeps its value (100% freezes)',
  'Morph: chance a step keeps its value (100% freezes)',
];
const TRACE_MS = 4000;
const CYCLES = 2;
const PREVIEW_PTS = 240;
/** example random line for the S&H / Smooth preview (one value per cycle) */
const RANDOM_LINE = [0.62, -0.45, 0.18, -0.8, 0.9, -0.1];

/** one waveform value at cycle position x (cycles, PHASE already added), as in the DSP */
function shapeAt(shape: number, morph: number, x: number): number {
  const seg = Math.floor(x);
  const p = x - seg;
  switch (shape) {
    case 0:
    case 1: {
      const r = 0.5 - 0.48 * morph;
      let q = p + 0.25;
      if (q >= 1) q -= 1;
      if (q < r) {
        const u = q / r;
        return shape === 0 ? -Math.cos(Math.PI * u) : 2 * u - 1;
      }
      const u = (q - r) / (1 - r);
      return shape === 0 ? Math.cos(Math.PI * u) : 1 - 2 * u;
    }
    case 2: {
      const r = 1 - morph;
      return p < r ? (2 * p) / r - 1 : 1 - (2 * (p - r)) / Math.max(1e-6, 1 - r);
    }
    case 3:
      return p < 0.5 - 0.48 * morph ? 1 : -1;
    default: {
      const k = ((seg % RANDOM_LINE.length) + RANDOM_LINE.length) % RANDOM_LINE.length;
      const rb = RANDOM_LINE[k];
      if (shape === 4) return rb;
      const ra = RANDOM_LINE[(k + RANDOM_LINE.length - 1) % RANDOM_LINE.length];
      return ra + (rb - ra) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    }
  }
}

let src: SourceTab | null = null;

registerTab({
  id: 'lfo',
  reveal: (id) => src?.reveal(id, (x) => /^lfo\d\./.test(x)) ?? false,
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const st = new SourceTab(tab, {
      key: 'lfo',
      count: NUM_LFOS,
      module: (i) => `lfo${i + 1}`,
      label: (i) => `LFO${i + 1}`,
      name: (i) => `LFO ${i + 1}`,
      routes: { triggerIns: () => (src ? [`${src.module}.reset`] : []), triggerOuts: () => (src ? [`${src.module}.cycle`] : []) },
    });
    src = st;
    st.routes.refresh();
    // per LFO: the tempo of its clock, INT · MIDI, beat LEDs
    const clocks = Array.from({ length: NUM_LFOS }, (_, i) => clockStatus(engine, `lfo${i + 1}`, `LFO ${i + 1}`));
    st.desc.after(...clocks);
    st.track(clocks);

    /* ---------- control row ---------- */
    const L = (i: number) => `LFO ${i + 1}`;
    const knob = (key: string, label?: string) => (i: number, m: string) => new Knob(p, `${m}.${key}`, { size: 'md', label, ariaLabel: `${L(i)} ${key}` }).el;
    st.slot(0, (i, m) => new ParamSelect(p, `${m}.shape`, { ariaLabel: `${L(i)} shape` }).el);
    const rate = st.slot(1, knob('rate'));
    const div = st.slot(2, (i, m) => new ParamSelect(p, `${m}.div`, { ariaLabel: `${L(i)} division` }).el);
    st.slot(3, knob('phase'));
    const morph = st.slot(4, knob('morph'));
    st.slot(5, knob('smooth', 'SMOOTH'));
    st.slot(6, knob('level'));
    st.slot(7, (i, m) => new ParamToggle(p, `${m}.uni`, { label: 'UNI', tone: 'neutral', ariaLabel: `${L(i)} unipolar` }).el);

    // the last edit decides: RATE runs free, a DIV follows the clock
    p.onGesture((id, phase) => {
      const k = phase === 'begin' ? /^(lfo\d)\.(rate|div)$/.exec(id) : null;
      if (!k) return;
      const want = k[2] === 'div' ? 1 : 0;
      if ((p.get(`${k[1]}.sync`) >= 0.5 ? 1 : 0) !== want) p.set(`${k[1]}.sync`, want);
    });

    const syncView = () => {
      for (let i = 0; i < NUM_LFOS; i++) {
        const m = `lfo${i + 1}`;
        const sync = p.get(`${m}.sync`) >= 0.5;
        toggleClass(rate[i], 'is-dim', sync);
        toggleClass(div[i], 'is-dim', !sync);
        toggleClass(clocks[i], 'is-free', !sync);
        clocks[i].title = sync ? '' : `LFO ${i + 1} runs free on RATE: its clock counts on DIV`;
        rate[i].title = sync ? 'Turn RATE to let the LFO run free' : '';
        div[i].title = sync ? '' : 'Choose a DIV to sync the LFO to the clock';
        const s = Math.max(0, Math.min(MORPH_NAMES.length - 1, Math.round(p.get(`${m}.shape`))));
        const name = morph[i].querySelector('.knob-name');
        if (name) name.textContent = MORPH_NAMES[s];
        morph[i].title = MORPH_HINTS[s];
      }
      const m = st.module;
      const sync = p.get(`${m}.sync`) >= 0.5;
      const v = (k: string) => formatValue(p.spec(`${m}.${k}`), effective(engine, `${m}.${k}`));
      st.desc.textContent = [`LFO ${st.current + 1}`, v('shape'), sync ? `${v('div')} sync` : v('rate'), p.get(`${m}.uni`) >= 0.5 ? 'unipolar' : 'bipolar'].join(' · ');
      viz.dirty = true;
    };

    /* ---------- picture: waveform preview | live trace ---------- */
    const hist = Array.from({ length: NUM_LFOS }, () => new History());
    onReadouts(engine, (dt) => {
      for (let i = 0; i < NUM_LFOS; i++) hist[i].push(p.get(`lfo${i + 1}.on`) >= 0.5 ? engine.mod.sourceValue(`lfo${i + 1}`) : 0, dt);
    });
    const preview = new Float32Array(PREVIEW_PTS);
    let previewKey = '';
    const viz = new VizCanvas(st.pic, tab, () => draw(), { label: 'LFO waveform and live output' });

    /** two cycles as set; SMOOTH as a one-pole over the cycle's duration (run twice to settle) */
    const buildPreview = () => {
      const m = st.module;
      const e = (k: string) => effective(engine, `${m}.${k}`);
      const shape = Math.round(e('shape'));
      const morphV = e('morph');
      const phase = e('phase');
      const smooth = e('smooth');
      const level = e('level');
      const uni = e('uni') >= 0.5;
      const sync = e('sync') >= 0.5;
      const cycleS = sync ? ((DIVISIONS[Math.round(e('div'))]?.beats ?? 1) * 60) / Math.max(1, clockView(engine, followedClock(engine, m)).bpm || p.get('clock.bpm')) : 1 / Math.max(1e-3, e('rate'));
      const key = [shape, morphV, phase, smooth, level, uni, cycleS].map((x) => (typeof x === 'number' ? x.toFixed(4) : x)).join('/');
      if (key === previewKey) return false;
      previewKey = key;
      const dt = (cycleS * CYCLES) / PREVIEW_PTS;
      const a = smooth > 0 ? 1 - Math.exp(-dt / (smooth * smooth)) : 1;
      let y = shapeAt(shape, morphV, phase);
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < PREVIEW_PTS; k++) {
          const raw = shapeAt(shape, morphV, (k / PREVIEW_PTS) * CYCLES + phase);
          y += (raw - y) * a;
          if (pass) preview[k] = (uni ? 0.5 + 0.5 * y : y) * level;
        }
      }
      return true;
    };

    const draw = () => {
      const hh = hist[st.current];
      const changed = buildPreview();
      if (!hh.fresh && !viz.dirty && !changed) return;
      hh.fresh = false;
      viz.dirty = false;
      const g = viz.begin();
      const { w, h: H, pal } = viz;
      const m = st.module;
      const on = p.get(`${m}.on`) >= 0.5;
      const uni = p.get(`${m}.uni`) >= 0.5;
      const top = 26;
      const bot = H - 16;
      const zero = uni ? bot : (top + bot) / 2;
      const span = uni ? bot - top : (bot - top) / 2;
      const yOf = (v: number) => zero - Math.max(-1, Math.min(1, v)) * span;
      const split = Math.round(w * 0.38);

      // frames and axes
      g.fillStyle = pal.grid;
      g.fillRect(0, Math.round(zero) - 0.5, w, 1);
      g.fillRect(0, top - 0.5, w, 1);
      if (!uni) g.fillRect(0, bot - 0.5, w, 1);
      g.fillStyle = pal.line;
      g.fillRect(split, 0, 1, H);
      g.font = monoFont(pal, 9);
      g.fillStyle = pal.text4;
      g.textBaseline = 'top';
      g.fillText(`WAVEFORM · ${CYCLES} CYCLES`, 10, 8);
      g.fillText('OUTPUT · 4 S', split + 10, 8);
      for (let c = 1; c < CYCLES; c++) {
        const x = 10 + ((split - 20) * c) / CYCLES;
        g.fillStyle = pal.grid;
        g.fillRect(Math.round(x), top, 1, bot - top);
      }

      // waveform preview
      g.beginPath();
      for (let k = 0; k < PREVIEW_PTS; k++) {
        const x = 10 + ((split - 20) * k) / (PREVIEW_PTS - 1);
        if (k === 0) g.moveTo(x, yOf(preview[k]));
        else g.lineTo(x, yOf(preview[k]));
      }
      g.strokeStyle = on ? pal.accent : pal.text4;
      g.lineWidth = 1.75;
      g.lineJoin = 'round';
      g.stroke();

      // live trace
      const n = hh.layout(split + 10, w - 10, TRACE_MS, yOf);
      if (n > 1) {
        if (on) {
          g.beginPath();
          hh.path(g, n);
          g.lineTo(hh.px(n - 1), zero);
          g.lineTo(hh.px(0), zero);
          g.closePath();
          g.fillStyle = pal.modSoft;
          g.fill();
        }
        g.beginPath();
        hh.path(g, n);
        g.strokeStyle = on ? pal.mod : pal.text4;
        g.lineWidth = 1.5;
        g.stroke();
        if (on) {
          // current value: dot at the trace head and a guide across the waveform
          const y = hh.py(0);
          g.fillStyle = pal.mod;
          g.beginPath();
          g.arc(hh.px(0), y, 2.8, 0, Math.PI * 2);
          g.fill();
          g.save();
          g.setLineDash([2, 4]);
          g.strokeStyle = pal.mod;
          g.globalAlpha = 0.6;
          g.beginPath();
          g.moveTo(10, Math.round(y) + 0.5);
          g.lineTo(split - 10, Math.round(y) + 0.5);
          g.stroke();
          g.restore();
        }
      }
      if (!on) picNote(g, monoFont(pal, 10), pal.text3, `LFO ${st.current + 1} IS OFF`, split + (w - split) / 2, (top + bot) / 2);
    };

    syncView();
    p.subscribeAll((id) => {
      if (/^lfo\d\.(sync|shape|rate|div|uni|on|morph|phase|smooth|level)$/.test(id)) syncView();
    });
    st.onChange(() => {
      previewKey = '';
      syncView();
    });
  },
});
