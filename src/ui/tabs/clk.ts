/**
 * CLK MOD tab: the two clock mods, with the clock of the selected one in the status line (tempo,
 * INT · MIDI (param cmodN.clk), beat LEDs; the clocks themselves are set in CONFIG → CLOCK). Control row = the selected clock mod
 * (MODE … UNI). Visualisation = its 16-step lane (draw values in Steps mode, Euclid pulses,
 * current step) with the output trace below, and its targets on the right.
 */
import '../../styles/tabs/clk.css';
import { NUM_CMODS } from '../../shared/paramdefs/modules';
import { formatValue } from '../../shared/params';
import { Knob } from '../components/knob';
import { ParamSelect } from '../components/select';
import { ParamToggle } from '../components/toggle';
import { clockStatus } from '../clock';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';
import { registerTab } from '../shell/tabs';
import { monoFont } from '../viz/draw';
import { VizCanvas } from '../viz/vizCanvas';
import { MODE_EUCLID, MODE_STEPS, StepLane } from './clk/stepLane';
import { History, SourceTab, effective, onReadouts } from './lfo/sourceTab';

const TRACE_MS = 4000;

let src: SourceTab | null = null;

registerTab({
  id: 'clk',
  reveal: (id) => src?.reveal(id, (x) => /^cmod\d\./.test(x)) ?? false,
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const st = new SourceTab(tab, {
      key: 'clk',
      count: NUM_CMODS,
      module: (i) => `cmod${i + 1}`,
      label: (i) => `CM${i + 1}`,
      name: (i) => `Clock Mod ${i + 1}`,
      routes: { triggerIns: () => (src ? [`${src.module}.reset`] : []), triggerOuts: () => (src ? [`${src.module}.step`, 'clock.beat', 'clock.midiBeat'] : []) },
    });
    src = st;
    st.routes.refresh();
    // the clock of each clock mod (tempo, INT · MIDI, beat LEDs) sits between the description and the instance group
    const clocks = Array.from({ length: NUM_CMODS }, (_, i) => clockStatus(engine, `cmod${i + 1}`, `Clock Mod ${i + 1}`));
    st.desc.after(...clocks);
    st.track(clocks);

    /* ---------- control row ---------- */
    const sel = (key: string) => (i: number, m: string) => new ParamSelect(p, `${m}.${key}`, { ariaLabel: `Clock Mod ${i + 1} ${p.spec(`${m}.${key}`).short.toLowerCase()}` }).el;
    const knob = (key: string) => (i: number, m: string) => new Knob(p, `${m}.${key}`, { size: 'md', ariaLabel: `Clock Mod ${i + 1} ${key}` }).el;
    st.slot(0, sel('mode'));
    st.slot(1, sel('div'));
    const steps = st.slot(2, sel('steps'));
    const pulses = st.slot(3, sel('pulses'));
    const rotate = st.slot(4, sel('rotate'));
    st.slot(5, knob('prob'));
    st.slot(6, knob('swing'));
    st.slot(7, knob('slew'));
    st.slot(8, knob('level'));
    st.slot(9, (i, m) => new ParamToggle(p, `${m}.uni`, { label: 'UNI', tone: 'neutral', ariaLabel: `Clock Mod ${i + 1} unipolar` }).el);

    /* ---------- picture: step lane + output trace ---------- */
    const lanes = Array.from({ length: NUM_CMODS }, (_, i) => new StepLane(engine, `cmod${i + 1}`, `Clock Mod ${i + 1}`));
    const laneBox = h('div', { class: 'clk-lanebox' }, ...lanes.map((l) => l.el));
    st.track(lanes.map((l) => l.el));
    const traceBox = h('div', { class: 'clk-trace' });
    st.pic.append(laneBox, traceBox);

    const hist = Array.from({ length: NUM_CMODS }, () => new History());
    onReadouts(engine, (dt) => {
      for (let i = 0; i < NUM_CMODS; i++) hist[i].push(p.get(`cmod${i + 1}.on`) >= 0.5 ? engine.mod.sourceValue(`cmod${i + 1}`) : 0, dt);
    });
    const viz = new VizCanvas(traceBox, tab, () => drawTrace(), { label: 'Clock mod output' });
    const drawTrace = () => {
      const hh = hist[st.current];
      if (!hh.fresh && !viz.dirty) return;
      hh.fresh = false;
      viz.dirty = false;
      const g = viz.begin();
      const { w, h: H, pal } = viz;
      const uni = p.get(`${st.module}.uni`) >= 0.5;
      const pad = 4;
      const zero = uni ? H - pad : H / 2;
      const span = uni ? H - 2 * pad : H / 2 - pad;
      const yOf = (v: number) => zero - Math.max(-1, Math.min(1, v)) * span;
      g.fillStyle = pal.grid;
      g.fillRect(0, Math.round(zero) - 0.5, w, 1);
      g.font = monoFont(pal, 9);
      g.fillStyle = pal.text4;
      g.textBaseline = 'top';
      g.fillText('OUT', 6, 3);
      const n = hh.layout(30, w - 6, TRACE_MS, yOf);
      if (n < 2) return;
      const on = p.get(`${st.module}.on`) >= 0.5;
      g.beginPath();
      hh.path(g, n);
      g.strokeStyle = on ? pal.mod : pal.text4;
      g.lineWidth = 1.5;
      g.lineJoin = 'round';
      g.stroke();
      if (on) {
        g.fillStyle = pal.mod;
        g.beginPath();
        g.arc(hh.px(0), hh.py(0), 2.5, 0, Math.PI * 2);
        g.fill();
      }
    };
    p.subscribeAll((id) => {
      if (/^cmod\d\.(uni|on)$/.test(id)) viz.dirty = true;
    });
    st.onChange(() => (viz.dirty = true));

    /* ---------- mode: dim what the mode does not use, describe it ---------- */
    const syncMode = () => {
      for (let i = 0; i < NUM_CMODS; i++) {
        const m = `cmod${i + 1}`;
        const md = Math.round(p.get(`${m}.mode`));
        const pattern = md === MODE_STEPS || md === MODE_EUCLID;
        toggleClass(steps[i], 'is-dim', !pattern);
        toggleClass(pulses[i], 'is-dim', md !== MODE_EUCLID);
        toggleClass(rotate[i], 'is-dim', md !== MODE_EUCLID);
        lanes[i].setMode(md);
      }
      syncDesc();
    };
    const syncDesc = () => {
      const m = st.module;
      const v = (k: string) => formatValue(p.spec(`${m}.${k}`), effective(engine, `${m}.${k}`));
      const md = Math.round(p.get(`${m}.mode`));
      const parts = [`Clock Mod ${st.current + 1}`, v('mode'), v('div')];
      if (md === MODE_STEPS || md === MODE_EUCLID) parts.push(`${v('steps')} steps`);
      if (md === MODE_EUCLID) parts.push(`${v('pulses')} pulses`);
      st.desc.textContent = parts.join(' · ');
    };
    syncMode();
    p.subscribeAll((id) => {
      if (/^cmod\d\.mode$/.test(id)) syncMode();
      else if (/^cmod\d\.(div|steps|pulses)$/.test(id)) syncDesc();
    });
    st.onChange(syncDesc);

    frameLoop.add(() => {
      if (tab.visible) lanes[st.current].tick();
    });
  },
});

