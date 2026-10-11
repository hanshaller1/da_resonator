/**
 * ENV MOD tab: envelope followers EF 1–4. Control row = the selected follower (INPUT … LEVEL).
 * Visualisation = its transfer curve (detected level → output, threshold, curve, level) with the
 * current operating point, a scrolling trace of its output, and its targets on the right.
 */
import '../../styles/tabs/env.css';
import type { EngineAPI } from '../../core/types';
import { NUM_EFS, TAP_IN, TAP_OUT } from '../../shared/paramdefs/modules';
import { formatValue } from '../../shared/params';
import { Knob } from '../components/knob';
import { ParamSelect } from '../components/select';
import { h, icon } from '../dom';
import { registerTab } from '../shell/tabs';
import { monoFont } from '../viz/draw';
import { VizCanvas } from '../viz/vizCanvas';
import { History, SourceTab, effective, onReadouts, picNote } from './lfo/sourceTab';

const FEEDBACK_HINT =
  'Feedback: this follower listens to audio that one of its own targets processes, ' +
  'so it hears its own effect (one block later). Can pump or self-oscillate.';
/** curve −1..1 → exponent of the shaping function, as in the DSP */
const CURVE_K = 6;
/** x range of the transfer picture (detected level after GAIN, dBFS) */
const DB_MIN = -66;
const DB_MAX = 0;
const DB_GRID = [-60, -48, -36, -24, -12, 0];
const TRACE_MS = 4000;

/**
 * True when one of follower n's routes changes the audio it listens to: the pre filter feeds every
 * tap, the resonator and band dynamics feed every tap behind the input, the post filter feeds Out.
 */
function hasFeedback(engine: EngineAPI, n: number): boolean {
  const p = engine.params;
  const tap = Math.round(p.get(`ef${n}.tap`));
  return engine.mod.routesFrom(`ef${n}`).some((r) => {
    const spec = p.spec(r.target);
    if (spec.module === 'filterPre') return true;
    if (spec.module === 'filterPost') return tap === TAP_OUT;
    return (spec.modClass === 'resonator' || spec.modClass === 'dyn') && tap > TAP_IN;
  });
}

/** output 0..1 of the follower for a detected level in dBFS (DSP update(), without LEVEL) */
function transfer(db: number, thr: number, curve: number): number {
  let u = thr < -1e-3 ? (db - thr) / -thr : db >= 0 ? 1 : 0;
  if (!(u > 0)) return 0;
  if (u > 1) u = 1;
  const k = curve * CURVE_K;
  if (k > 1e-4 || k < -1e-4) u = (Math.exp(k * u) - 1) / (Math.exp(k) - 1);
  return u;
}

/** detected level (dBFS) that gives shaped output s (0..1): inverse of transfer() above threshold */
function inverse(s: number, thr: number, curve: number): number {
  const k = curve * CURVE_K;
  const u = k > 1e-4 || k < -1e-4 ? Math.log(1 + s * (Math.exp(k) - 1)) / k : s;
  return thr + Math.max(0, Math.min(1, u)) * -thr;
}

let src: SourceTab | null = null;

registerTab({
  id: 'env',
  reveal: (id) => src?.reveal(id, (x) => /^ef\d\./.test(x)) ?? false,
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const st = new SourceTab(tab, {
      key: 'env',
      count: NUM_EFS,
      module: (i) => `ef${i + 1}`,
      label: (i) => `EF${i + 1}`,
      name: (i) => `Env Follower ${i + 1}`,
      routes: { triggerOuts: () => (src ? [`${src.module}.gate`] : []) },
    });
    src = st;
    st.routes.refresh();

    /* ---------- control row ---------- */
    const L = (i: number) => `Env Follower ${i + 1}`;
    const knob = (key: string, label?: string) => (i: number, m: string) => new Knob(p, `${m}.${key}`, { size: 'md', label, ariaLabel: `${L(i)} ${key}` }).el;
    st.slot(0, (i, m) => new ParamSelect(p, `${m}.tap`, { label: 'INPUT', ariaLabel: `${L(i)} input` }).el);
    st.slot(1, knob('attack', 'ATK'));
    st.slot(2, knob('release', 'REL'));
    st.slot(3, knob('gain', 'GAIN'));
    st.slot(4, knob('threshold', 'THR'));
    st.slot(5, knob('curve', 'CURVE'));
    st.slot(6, knob('level', 'LEVEL'));

    /* ---------- feedback warning (in the picture, top right) ---------- */
    const badge = h('span', { class: 'env-fb', title: FEEDBACK_HINT, role: 'note' }, icon('panic', 'env-fb-icon'), 'FEEDBACK');
    st.pic.append(badge);
    const syncFeedback = () => (badge.hidden = !hasFeedback(engine, st.current + 1));

    const syncView = () => {
      const m = st.module;
      const v = (k: string) => formatValue(p.spec(`${m}.${k}`), effective(engine, `${m}.${k}`));
      st.desc.textContent = [`Env Follower ${st.current + 1}`, v('tap'), `ATK ${v('attack')}`, `REL ${v('release')}`, `THR ${v('threshold')}`].join(' · ');
      syncFeedback();
      viz.dirty = true;
    };

    /* ---------- picture: transfer curve | live trace ---------- */
    const hist = Array.from({ length: NUM_EFS }, () => new History());
    onReadouts(engine, (dt) => {
      for (let i = 0; i < NUM_EFS; i++) hist[i].push(p.get(`ef${i + 1}.on`) >= 0.5 ? engine.mod.sourceValue(`ef${i + 1}`) : 0, dt);
    });
    const viz = new VizCanvas(st.pic, tab, () => draw(), { label: 'Envelope follower transfer curve and live output' });

    const draw = () => {
      const hh = hist[st.current];
      if (!hh.fresh && !viz.dirty) return;
      hh.fresh = false;
      viz.dirty = false;
      const g = viz.begin();
      const { w, h: H, pal } = viz;
      const m = st.module;
      const on = p.get(`${m}.on`) >= 0.5;
      const thr = effective(engine, `${m}.threshold`);
      const curve = effective(engine, `${m}.curve`);
      const level = effective(engine, `${m}.level`);
      const top = 30;
      const bot = H - 22;
      const yOf = (v: number) => bot - Math.max(0, Math.min(1, v)) * (bot - top);
      const split = Math.round(w * 0.42);
      const x0 = 34;
      const x1 = split - 14;
      const xOfDb = (db: number) => x0 + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * (x1 - x0);

      // frames, labels, grids
      g.fillStyle = pal.line;
      g.fillRect(split, 0, 1, H);
      g.font = monoFont(pal, 9);
      g.fillStyle = pal.text4;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText('TRANSFER · INPUT × GAIN → OUT', 10, 8);
      g.fillText('OUTPUT · 4 S', split + 10, 8);
      g.fillStyle = pal.grid;
      for (const v of [0, 0.5, 1]) g.fillRect(x0, Math.round(yOf(v)) - 0.5, x1 - x0, 1);
      for (const v of [0, 0.5, 1]) g.fillRect(split + 10, Math.round(yOf(v)) - 0.5, w - split - 20, 1);
      g.textBaseline = 'middle';
      g.textAlign = 'right';
      g.fillStyle = pal.text4;
      for (const v of [0, 0.5, 1]) g.fillText(`${Math.round(v * 100)}`, x0 - 6, yOf(v));
      g.textAlign = 'center';
      g.textBaseline = 'top';
      for (const db of DB_GRID) {
        const x = Math.round(xOfDb(db)) - 0.5;
        g.fillStyle = pal.grid;
        g.fillRect(x, top, 1, bot - top);
        g.fillStyle = pal.text4;
        g.fillText(`${db}`, x, bot + 6);
      }

      // threshold
      const xt = Math.round(xOfDb(thr)) + 0.5;
      g.save();
      g.setLineDash([3, 3]);
      g.strokeStyle = pal.text3;
      g.beginPath();
      g.moveTo(xt, top - 4);
      g.lineTo(xt, bot);
      g.stroke();
      g.restore();
      g.fillStyle = pal.text3;
      g.textAlign = xt > x1 - 40 ? 'right' : 'left';
      g.textBaseline = 'bottom';
      g.fillText(`THR ${thr.toFixed(0)} dB`, xt + (xt > x1 - 40 ? -4 : 4), top - 2);

      // transfer curve
      const col = on ? pal.accent : pal.text4;
      g.beginPath();
      const N = 160;
      for (let k = 0; k <= N; k++) {
        const db = DB_MIN + ((DB_MAX - DB_MIN) * k) / N;
        const y = yOf(transfer(db, thr, curve) * level);
        if (k === 0) g.moveTo(xOfDb(db), y);
        else g.lineTo(xOfDb(db), y);
      }
      g.strokeStyle = col;
      g.lineWidth = 1.75;
      g.lineJoin = 'round';
      g.stroke();

      // live trace
      const n = hh.layout(split + 10, w - 10, TRACE_MS, yOf);
      if (n > 1) {
        if (on) {
          g.beginPath();
          hh.path(g, n);
          g.lineTo(hh.px(n - 1), bot);
          g.lineTo(hh.px(0), bot);
          g.closePath();
          g.fillStyle = pal.modSoft;
          g.fill();
        }
        g.beginPath();
        hh.path(g, n);
        g.strokeStyle = on ? pal.mod : pal.text4;
        g.lineWidth = 1.5;
        g.stroke();
      }

      if (!on) {
        picNote(g, monoFont(pal, 10), pal.text3, `EF ${st.current + 1} IS OFF`, split + (w - split) / 2, (top + bot) / 2);
        return;
      }
      // operating point: the output read back through the curve (exact while above threshold)
      const out = hh.count ? hh.at(0) : 0;
      g.fillStyle = pal.mod;
      if (out > 1e-4 && level > 1e-4) {
        const x = xOfDb(inverse(Math.min(1, out / level), thr, curve));
        g.beginPath();
        g.arc(x, yOf(out), 3.2, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(hh.px(0), hh.py(0), 2.8, 0, Math.PI * 2);
        g.fill();
      } else {
        g.font = monoFont(pal, 9);
        g.textAlign = 'right';
        g.textBaseline = 'bottom';
        g.fillStyle = pal.text3;
        g.fillText('BELOW THR', xt - 4, bot - 4);
      }
    };

    syncView();
    p.subscribeAll((id) => {
      if (/^ef\d\./.test(id)) syncView();
    });
    engine.mod.onChange(syncFeedback);
    st.onChange(syncView);
  },
});
