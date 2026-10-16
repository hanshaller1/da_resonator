/**
 * CLK MOD tab: the two clock mods and the band scanner (SCAN, docs/hardware-modi-und-pools-2026-10-16.md),
 * with the clock of the selected one in the status line (tempo, INT · MIDI (param cmodN.clk), the scanner
 * RATE · INT · MIDI, beat LEDs; the clocks themselves are set in CONFIG → CLOCK).
 * Clock mod: control row MODE … UNI; visualisation = its 16-step lane (draw values in Steps mode, Euclid
 * pulses, current step) with the output trace below, and its targets on the right.
 * Scanner: control row SOURCE, SHAPE, LFO, RATE, DIV, DIR, DEPTH, OFFSET, R DLY, R INV; visualisation =
 * the level it gives every band and the running step over the whole width, with the locks (clk/scanViz.ts).
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
import { ScanViz } from './clk/scanViz';
import { MODE_EUCLID, MODE_STEPS, StepLane } from './clk/stepLane';
import { History, SourceTab, effective, onReadouts } from './lfo/sourceTab';

const TRACE_MS = 4000;
/** instance index of the band scanner (after the clock mods) */
const SCAN = NUM_CMODS;
const SCAN_TITLES: Record<string, string> = {
  'scan.src': 'What the scanner samples: its own LFO, or a modulation source',
  'scan.lfo': 'Rate of the scanner’s own LFO',
  'scan.rate': 'Steps per second while the scanner runs free (RATE in the status line)',
  'scan.div': 'Step length while the scanner follows a clock (INT or MIDI in the status line)',
  'scan.depth': 'How far a low value takes a band down',
  'scan.offset': 'Level of a band at the top value, on top of its fader',
  'scan.rdly': 'R follows L this many steps later',
  'scan.rinv': 'R gets the inverted value: the bands lean the other way on R',
};

let src: SourceTab | null = null;

registerTab({
  id: 'clk',
  reveal: (id) => src?.reveal(id, (x) => /^cmod\d\./.test(x) || x.startsWith('scan.')) ?? false,
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const isCmod = () => !!src && src.current < SCAN;
    const st = new SourceTab(tab, {
      key: 'clk',
      count: NUM_CMODS + 1,
      module: (i) => (i < SCAN ? `cmod${i + 1}` : 'scan'),
      label: (i) => (i < SCAN ? `CM${i + 1}` : 'SCAN'),
      name: (i) => (i < SCAN ? `Clock Mod ${i + 1}` : 'Band Scanner'),
      isSource: (i) => i < SCAN,
      routes: {
        sources: () => (src && isCmod() ? [src.module] : []),
        addFrom: () => (src && isCmod() ? src.module : null),
        triggerIns: () => (src && isCmod() ? [`${src.module}.reset`] : []),
        triggerOuts: () => (src && isCmod() ? [`${src.module}.step`, 'clock.beat', 'clock.midiBeat'] : []),
      },
    });
    src = st;
    st.routes.refresh();
    // the clock of each instance (tempo, INT · MIDI or RATE · INT · MIDI, beat LEDs) between the description and the instance group
    const clocks = Array.from({ length: NUM_CMODS + 1 }, (_, i) => (i < SCAN ? clockStatus(engine, `cmod${i + 1}`, `Clock Mod ${i + 1}`) : clockStatus(engine, 'scan', 'The scanner', true)));
    st.desc.after(...clocks);
    st.track(clocks);

    /* ---------- control row ---------- */
    const sel = (id: string, aria: string) => new ParamSelect(p, id, { ariaLabel: aria }).el;
    const knob = (id: string, aria: string, label?: string) => new Knob(p, id, { size: 'md', label, ariaLabel: aria }).el;
    const scanCtl = (key: string): HTMLElement => {
      const id = `scan.${key}`;
      const spec = p.spec(id);
      const aria = `Scanner ${spec.short.toLowerCase()}`;
      const el =
        spec.curve === 'discrete'
          ? sel(id, aria)
          : spec.curve === 'toggle'
            ? new ParamToggle(p, id, { label: spec.short, tone: 'neutral', ariaLabel: aria }).el
            : knob(id, aria, key === 'lfo' ? 'LFO' : undefined);
      if (SCAN_TITLES[id]) el.title = SCAN_TITLES[id];
      return el;
    };
    /** slot k: the clock mod's control, or the scanner's */
    const slot = (k: number, cm: (i: number, m: string) => HTMLElement, sc: string) => st.slot(k, (i, m) => (i < SCAN ? cm(i, m) : scanCtl(sc)));
    const cmSel = (key: string) => (i: number, m: string) => sel(`${m}.${key}`, `Clock Mod ${i + 1} ${p.spec(`${m}.${key}`).short.toLowerCase()}`);
    const cmKnob = (key: string) => (i: number, m: string) => knob(`${m}.${key}`, `Clock Mod ${i + 1} ${key}`);
    slot(0, cmSel('mode'), 'src');
    const shape = slot(1, cmSel('div'), 'shape');
    const steps = slot(2, cmSel('steps'), 'lfo');
    const pulses = slot(3, cmSel('pulses'), 'rate');
    const rotate = slot(4, cmSel('rotate'), 'div');
    slot(5, cmKnob('prob'), 'dir');
    slot(6, cmKnob('swing'), 'depth');
    slot(7, cmKnob('slew'), 'offset');
    slot(8, cmKnob('level'), 'rdly');
    slot(9, (i, m) => new ParamToggle(p, `${m}.uni`, { label: 'UNI', tone: 'neutral', ariaLabel: `Clock Mod ${i + 1} unipolar` }).el, 'rinv');

    /* ---------- clock mod picture: step lane + output trace ---------- */
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
      if (!hh || (!hh.fresh && !viz.dirty)) return;
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

    /* ---------- scanner picture: the whole visualisation ---------- */
    const scan = new ScanViz(engine, tab);
    const showPic = () => {
      const s = st.current === SCAN;
      st.pic.hidden = s;
      st.side.hidden = s;
      scan.el.hidden = !s;
      viz.dirty = true;
      scan.viz.dirty = true;
    };
    showPic();
    st.onChange(showPic);

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
      // scanner: SHAPE and LFO only for its own LFO, RATE only while free, DIV only on a clock
      const own = Math.round(p.get('scan.src')) === 0;
      const free = p.get('scan.sync') < 0.5;
      toggleClass(shape[SCAN], 'is-dim', !own);
      toggleClass(steps[SCAN], 'is-dim', !own);
      toggleClass(pulses[SCAN], 'is-dim', !free);
      toggleClass(rotate[SCAN], 'is-dim', free);
      syncDesc();
    };
    const syncDesc = () => {
      const m = st.module;
      const v = (k: string) => formatValue(p.spec(`${m}.${k}`), effective(engine, `${m}.${k}`));
      if (st.current === SCAN) {
        const own = Math.round(p.get('scan.src')) === 0;
        const parts = ['Band Scanner', own ? `${v('shape')} ${v('lfo')}` : v('src'), p.get('scan.sync') < 0.5 ? `${v('rate')}` : v('div'), v('dir')];
        st.desc.textContent = parts.join(' · ');
        return;
      }
      const md = Math.round(p.get(`${m}.mode`));
      const parts = [`Clock Mod ${st.current + 1}`, v('mode'), v('div')];
      if (md === MODE_STEPS || md === MODE_EUCLID) parts.push(`${v('steps')} steps`);
      if (md === MODE_EUCLID) parts.push(`${v('pulses')} pulses`);
      st.desc.textContent = parts.join(' · ');
    };
    syncMode();
    p.subscribeAll((id) => {
      if (/^cmod\d\.mode$/.test(id) || id === 'scan.src' || id === 'scan.sync') syncMode();
      else if (/^cmod\d\.(div|steps|pulses)$/.test(id) || /^scan\.(shape|lfo|rate|div|dir)$/.test(id)) syncDesc();
    });
    st.onChange(syncDesc);

    frameLoop.add(() => {
      if (tab.visible && st.current < SCAN) lanes[st.current].tick();
    });
  },
});
