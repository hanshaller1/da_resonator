/**
 * CLK MOD tab: the clock (tempo, INT · MIDI, run, tap, reset, beat LEDs in the status line) and the two
 * clock mods. Control row = the selected clock mod (MODE … UNI). Visualisation = its 16-step
 * lane (draw values in Steps mode, Euclid pulses, current step) with the output trace below,
 * and its targets on the right.
 */
import '../../styles/tabs/clk.css';
import type { EngineAPI } from '../../core/types';
import { NUM_CMODS } from '../../shared/paramdefs/modules';
import { formatValue } from '../../shared/params';
import { Knob } from '../components/knob';
import { ParamField } from '../components/paramField';
import { ParamSelect } from '../components/select';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';
import { registerTab } from '../shell/tabs';
import { monoFont } from '../viz/draw';
import { VizCanvas } from '../viz/vizCanvas';
import { MODE_EUCLID, MODE_STEPS, StepLane } from './clk/stepLane';
import { History, SourceTab, effective, onReadouts } from './lfo/sourceTab';

const BPM_MIN = 20;
const BPM_MAX = 300;
/** taps further apart than this start a new measurement (20 BPM = 3 s) */
const TAP_TIMEOUT_MS = 3000;
const TAP_MAX = 6;
/** beat LED flash length, fraction of a beat */
const FLASH = 0.15;
const TRACE_MS = 4000;

function flash(el: HTMLElement): void {
  el.classList.remove('is-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('is-flash');
}

/** tempo field, RUN, TAP, RESET and the beat LEDs */
function clockGroup(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const bpm = new ParamField(p, 'clock.bpm', { label: 'TEMPO', ariaLabel: 'Tempo', format: (v) => `${v.toFixed(1)} BPM` });
  const run = new ParamToggle(p, 'clock.run', { label: 'RUN', ariaLabel: 'Clock run' });

  const setBpm = (v: number) => {
    p.beginGesture('clock.bpm');
    p.set('clock.bpm', Math.min(BPM_MAX, Math.max(BPM_MIN, v)));
    p.endGesture('clock.bpm');
  };
  /* tap tempo: average interval of the last taps */
  const tapBtn = h('button', { type: 'button', class: 'clk-btn', title: 'Tap tempo' }, 'TAP');
  const taps: number[] = [];
  const tap = (t: number) => {
    const last = taps[taps.length - 1];
    if (last !== undefined) {
      const gap = t - last;
      if (gap > TAP_TIMEOUT_MS) taps.length = 0;
      else if (taps.length >= 2) {
        // clearly different tempo: start over from the last tap instead of averaging it in
        const avg = (last - taps[0]) / (taps.length - 1);
        if (gap > avg * 1.6 || gap < avg / 1.6) taps.splice(0, taps.length - 1);
      }
    }
    taps.push(t);
    if (taps.length > TAP_MAX) taps.shift();
    flash(tapBtn);
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(Math.round((60000 / avg) * 10) / 10);
    }
  };
  // pointerdown, not click: the press is the beat
  tapBtn.addEventListener('pointerdown', (e) => {
    if (e.button === 0) tap(e.timeStamp);
  });
  tapBtn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      tap(e.timeStamp);
    }
  });
  const resetBtn = h('button', { type: 'button', class: 'clk-btn', title: 'Restart the clock at beat 1' }, 'RESET');
  resetBtn.addEventListener('click', () => {
    engine.mod.resetClock();
    flash(resetBtn);
  });

  /* INT · MIDI (docs/midi-2026-10-16.md 1B): on MIDI the tempo is measured, Start / Stop run the clock */
  const midi = engine.midi;
  const extBpm = h('span', { class: 'pfield clk-ext-bpm', role: 'status', 'aria-label': 'Tempo from MIDI clock' }, h('span', { class: 'pfield-label' }, 'TEMPO'), h('span', { class: 'pfield-value' }));
  const extVal = extBpm.lastElementChild as HTMLElement;
  const extLed = h('span', { class: 'inst-led', 'aria-hidden': 'true' });
  const srcBtns = (['int', 'midi'] as const).map((src) => {
    const b = h('button', { type: 'button', class: 'inst-btn', title: src === 'int' ? 'Internal clock: TEMPO, RUN, TAP' : 'Follow MIDI clock: tempo, Start, Stop and Continue of the MIDI device (CONFIG → MIDI)' }, ...(src === 'midi' ? [extLed, 'MIDI'] : ['INT']));
    b.addEventListener('click', async () => {
      // MIDI needs access first; where the page may not use MIDI the clock stays internal
      if (src === 'midi' && midi.status !== 'on') await midi.enable();
      if (src === 'int' || midi.status === 'on') midi.setClockSource(src);
    });
    return { src, b };
  });
  const srcGroup = h('span', { class: 'inst clk-src', role: 'group', 'aria-label': 'Clock source' }, ...srcBtns.map((x) => x.b));
  const syncSrc = () => {
    const ext = midi.clockSource === 'midi';
    for (const { src, b } of srcBtns) {
      toggleClass(b, 'is-selected', midi.clockSource === src);
      b.setAttribute('aria-pressed', String(midi.clockSource === src));
    }
    bpm.el.hidden = ext;
    extBpm.hidden = !ext;
    run.el.disabled = tapBtn.disabled = resetBtn.disabled = ext;
    toggleClass(run.el, 'is-ext', ext);
    run.el.title = ext ? 'MIDI Start and Stop run the clock' : '';
    resetBtn.title = ext ? 'MIDI Start restarts the clock at beat 1' : 'Restart the clock at beat 1';
  };
  syncSrc();
  midi.onChange(syncSrc);

  /* beat LEDs: position in the bar, flash on each beat */
  const beats = Array.from({ length: 4 }, () => h('span', { class: 'clk-beat' }));
  const beatRow = h('span', { class: 'clk-beats', role: 'img', 'aria-label': 'Beat' }, ...beats);
  let lastBeat = -1;
  let lastFlash = false;
  let lastExt = '';
  frameLoop.add(() => {
    const live = engine.state === 'running';
    const ext = midi.clockSource === 'midi';
    if (ext) {
      // measured tempo; the LED shows that clock comes in
      const fresh = performance.now() - midi.clockAt < 500;
      const txt = `${engine.mod.bpm.toFixed(1)} BPM|${fresh}|${engine.mod.running}`;
      if (txt !== lastExt) {
        lastExt = txt;
        extVal.textContent = `${engine.mod.bpm.toFixed(1)} BPM`;
        toggleClass(extLed, 'is-on', fresh);
        extBpm.title = !fresh ? 'No MIDI clock: the last tempo runs on' : engine.mod.running ? 'Tempo of the MIDI clock' : 'MIDI clock stopped';
      }
    }
    const b = engine.mod.beats;
    const beat = live ? Math.floor(b) : -1;
    const on = live && (ext ? engine.mod.running : p.get('clock.run') >= 0.5) && b - Math.floor(b) < FLASH;
    if (beat === lastBeat && on === lastFlash) return;
    const k = beat < 0 ? -1 : beat % 4;
    beats.forEach((el, i) => {
      toggleClass(el, 'is-on', i === k);
      toggleClass(el, 'is-flash', i === k && on);
    });
    lastBeat = beat;
    lastFlash = on;
  });

  return h('span', { class: 'clk-clock' }, bpm.el, extBpm, srcGroup, run.el, tapBtn, resetBtn, beatRow);
}

let src: SourceTab | null = null;

registerTab({
  id: 'clk',
  reveal: (id) => {
    if (id.startsWith('clock.')) return true;
    return src?.reveal(id, (x) => /^cmod\d\./.test(x)) ?? false;
  },
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const st = new SourceTab(tab, {
      key: 'clk',
      count: NUM_CMODS,
      module: (i) => `cmod${i + 1}`,
      label: (i) => `CM${i + 1}`,
      name: (i) => `Clock Mod ${i + 1}`,
      routes: { triggerIns: () => (src ? [`${src.module}.reset`] : []), triggerOuts: () => (src ? [`${src.module}.step`, 'clock.beat'] : []) },
    });
    src = st;
    st.routes.refresh();
    // the clock sits between the description and the instance group
    st.desc.after(clockGroup(engine));

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

