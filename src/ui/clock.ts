/**
 * The clocks in the UI. Two clocks run side by side: the internal clock (TEMPO, RUN, TAP, RESET)
 * and the MIDI clock (from the MIDI device or a device of its own, with OFFSET). Each is switched
 * on and off in CONFIG → CLOCK (remembered in the browser). Each LFO and clock mod chooses one with
 * INT · MIDI in the status line of LFO MOD and CLK MOD (param .clk, saved with the preset) and
 * follows the other one while its own is off. CONFIG → GENERAL shows both (tempo, beats, MIDI source).
 * The MIDI tempo is shown steady: while the measured tempo only wobbles a little, its mean shows.
 */
import '../styles/components/clock.css';
import { clocksOn } from '../core/midi';
import type { EngineAPI } from '../core/types';
import { NUM_CMODS, NUM_LFOS, followsMidi } from '../shared/paramdefs/modules';
import { ParamField } from './components/paramField';
import { ParamToggle } from './components/toggle';
import { h, toggleClass } from './dom';
import { frameLoop } from './scheduler';
import { nav } from './shell/tabs';

const BPM_MIN = 20;
const BPM_MAX = 300;
/** taps further apart than this start a new measurement (20 BPM = 3 s) */
const TAP_TIMEOUT_MS = 3000;
const TAP_MAX = 6;
/** beat LED flash length, fraction of a beat */
const FLASH = 0.15;
/** MIDI clock counts as coming in this long after the last tick (ms) */
const FRESH_MS = 500;
/** the shown MIDI tempo keeps to its mean while the measured one stays within this (BPM) */
const WOBBLE = 0.3;
/** a measured tempo outside WOBBLE for this long is a new tempo (ms) */
const NEW_TEMPO_MS = 400;
/** the mean covers about this many frames (4 s at 60 Hz) */
const MEAN_FRAMES = 240;

export type ClockName = 'int' | 'midi';
const CLOCK_WORD: Record<ClockName, string> = { int: 'internal', midi: 'MIDI' };

function flash(el: HTMLElement): void {
  el.classList.remove('is-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('is-flash');
}

const fresh = (engine: EngineAPI) => performance.now() - engine.midi.clockAt < FRESH_MS;

/** switch a clock on or off; the MIDI clock needs MIDI access first (where the page may not use MIDI it stays off) */
export async function setClockOn(engine: EngineAPI, which: ClockName, on: boolean): Promise<void> {
  const midi = engine.midi;
  if (which === 'midi' && on && midi.status !== 'on') await midi.enable();
  if (which === 'int' || !on || midi.status === 'on') midi.setClockOn(which, on);
}

/** the clock runs (the MIDI clock also needs MIDI on) */
export function clockOn(engine: EngineAPI, which: ClockName): boolean {
  return clocksOn(engine.midi)[which];
}

/** the clock a module ('lfo2', 'cmod1') chose */
export function chosenClock(engine: EngineAPI, module: string): ClockName {
  return engine.params.get(`${module}.clk`) >= 0.5 ? 'midi' : 'int';
}

/** the clock a module follows now: its choice, or the other one while that is off */
export function followedClock(engine: EngineAPI, module: string): ClockName {
  const on = clocksOn(engine.midi);
  return followsMidi(chosenClock(engine, module) === 'midi', on.int, on.midi) ? 'midi' : 'int';
}

/** what a clock shows: tempo (0 = unknown), position in beats, running, and whether it moves at all (`live`) */
export interface ClockView {
  bpm: number;
  beats: number;
  running: boolean;
  live: boolean;
}

/** INT moves while it is on and audio runs */
function intView(engine: EngineAPI): ClockView {
  const p = engine.params;
  const on = engine.midi.intClockOn;
  return { bpm: p.get('clock.bpm'), beats: engine.mod.beats, running: on && p.get('clock.run') >= 0.5, live: on && engine.state === 'running' };
}

/** MIDI as measured: the engine's MIDI clock while it is on and audio runs, else the clock as the MIDI service follows it */
function rawMidiView(engine: EngineAPI): ClockView {
  const m = engine.midi;
  const mod = engine.mod;
  if (clocksOn(m).midi && engine.state === 'running') return { bpm: mod.midiBpm, beats: mod.midiBeats, running: mod.midiRunning, live: true };
  const f = fresh(engine);
  return { bpm: m.clockBpm, beats: m.clockBeats, running: m.clockRunning && f, live: f };
}

/**
 * The shown MIDI tempo: the mean while the measured tempo stays within ±WOBBLE of it, a new mean
 * once it stays outside for NEW_TEMPO_MS. The last digit changes only when the mean moves a tenth.
 */
class SteadyTempo {
  shown = 0;
  private sum = 0;
  private n = 0;
  private awaySince = -1;

  push(bpm: number, now: number): void {
    if (!(bpm > 0)) {
      this.shown = this.sum = this.n = 0;
      this.awaySince = -1;
      return;
    }
    if (this.n > 0 && Math.abs(bpm - this.sum / this.n) > WOBBLE) {
      if (this.awaySince < 0) this.awaySince = now;
      if (now - this.awaySince < NEW_TEMPO_MS) return;
      this.sum = this.n = 0;
    }
    this.awaySince = -1;
    this.sum += bpm;
    this.n++;
    if (this.n > MEAN_FRAMES) {
      this.sum *= MEAN_FRAMES / this.n;
      this.n = MEAN_FRAMES;
    }
    const mean = this.sum / this.n;
    if (this.n === 1 || Math.abs(mean - this.shown) >= 0.1) this.shown = Math.round(mean * 10) / 10;
  }
}

const steady = new WeakMap<EngineAPI, SteadyTempo>();
function steadyMidiBpm(engine: EngineAPI): number {
  let s = steady.get(engine);
  if (!s) {
    const t = new SteadyTempo();
    steady.set(engine, (s = t));
    const push = () => t.push(rawMidiView(engine).bpm, performance.now());
    push();
    frameLoop.add(push);
  }
  return s.shown;
}

export function clockView(engine: EngineAPI, which: ClockName): ClockView {
  if (which === 'int') return intView(engine);
  return { ...rawMidiView(engine), bpm: steadyMidiBpm(engine) };
}

/** four beat LEDs of a clock (or of the clock `which()` names): position in the bar, flash on each beat while it runs */
export function beatLeds(engine: EngineAPI, which: ClockName | (() => ClockName)): HTMLElement {
  const pick = typeof which === 'function' ? which : () => which;
  const beats = Array.from({ length: 4 }, () => h('span', { class: 'clk-beat' }));
  const row = h('span', { class: 'clk-beats', role: 'img', 'aria-label': typeof which === 'function' ? 'Beat' : `Beat of the ${CLOCK_WORD[which]} clock` }, ...beats);
  let lastBeat = -1;
  let lastFlash = false;
  frameLoop.add(() => {
    const v = clockView(engine, pick());
    const b = v.beats;
    const beat = v.live ? Math.floor(b) : -1;
    const on = v.live && v.running && b - Math.floor(b) < FLASH;
    if (beat === lastBeat && on === lastFlash) return;
    const k = beat < 0 ? -1 : beat % 4;
    beats.forEach((el, i) => {
      toggleClass(el, 'is-on', i === k);
      toggleClass(el, 'is-flash', i === k && on);
    });
    lastBeat = beat;
    lastFlash = on;
  });
  return row;
}

/** tempo as text: "120.0 BPM", or "— BPM" while unknown */
export function bpmText(bpm: number): string {
  return bpm > 0 ? `${bpm.toFixed(1)} BPM` : '— BPM';
}

/**
 * INT · MIDI of one LFO or clock mod (param .clk). The MIDI button lights while MIDI clock comes in.
 * While the chosen clock is off its button shows dim: the module follows the other one.
 */
export function clockChoice(engine: EngineAPI, module: string, name: string): HTMLElement {
  const p = engine.params;
  const id = `${module}.clk`;
  const led = h('span', { class: 'inst-led', 'aria-hidden': 'true' });
  const btns = (['int', 'midi'] as const).map((c) => {
    const b = h(
      'button',
      { type: 'button', class: 'inst-btn', title: c === 'int' ? `${name} follows the internal clock (CONFIG → CLOCK)` : `${name} follows the MIDI clock (CONFIG → CLOCK)` },
      ...(c === 'midi' ? [led, 'MIDI'] : ['INT']),
    );
    b.addEventListener('click', () => {
      p.beginGesture(id);
      p.set(id, c === 'midi' ? 1 : 0);
      p.endGesture(id);
    });
    return { c, b };
  });
  const el = h('span', { class: 'inst clk-src', role: 'group', 'aria-label': `${name} clock`, 'data-param': id }, ...btns.map((x) => x.b));
  let last = '';
  frameLoop.add(() => {
    const ch = chosenClock(engine, module);
    const fol = followedClock(engine, module);
    const none = !clockOn(engine, fol);
    const lit = clockOn(engine, 'midi') && fresh(engine);
    const key = `${ch}|${fol}|${none}|${lit}`;
    if (key === last) return;
    last = key;
    for (const { c, b } of btns) {
      toggleClass(b, 'is-selected', ch === c);
      toggleClass(b, 'is-standby', ch === c && (fol !== c || none));
      b.setAttribute('aria-pressed', String(ch === c));
    }
    toggleClass(led, 'is-on', lit);
    el.title = none
      ? `Both clocks are off (CONFIG → CLOCK): ${name} stands still`
      : fol !== ch
        ? `The ${CLOCK_WORD[ch]} clock is off: ${name} follows the ${CLOCK_WORD[fol]} clock`
        : '';
  });
  return el;
}

/** the tempo of the clock `which()` names as a readout; a click opens CONFIG → CLOCK */
function tempoReadout(engine: EngineAPI, which: () => ClockName): HTMLElement {
  const val = h('span', { class: 'pfield-value' });
  const el = h('button', { type: 'button', class: 'pfield clk-tempo', 'aria-label': 'Tempo, set in CONFIG → CLOCK' }, h('span', { class: 'pfield-label' }, 'TEMPO'), val);
  el.addEventListener('click', () => nav.reveal('clock.bpm'));
  let last = '';
  frameLoop.add(() => {
    const w = which();
    const v = clockView(engine, w);
    const on = clockOn(engine, w);
    const f = fresh(engine);
    const key = `${w}|${v.bpm.toFixed(1)}|${on}|${f}|${v.running}`;
    if (key === last) return;
    last = key;
    val.textContent = bpmText(v.bpm);
    el.title = !on
      ? 'Both clocks are off (CONFIG → CLOCK)'
      : w === 'int'
        ? `Internal clock${v.running ? '' : ', stopped'}: TEMPO, RUN, TAP and RESET in CONFIG → CLOCK`
        : !f
          ? 'No MIDI clock: the last tempo runs on (CONFIG → CLOCK)'
          : v.running
            ? 'Tempo of the MIDI clock, steadied (CONFIG → CLOCK)'
            : 'MIDI clock stopped (CONFIG → CLOCK)';
  });
  return el;
}

/** where the MIDI clock comes from, in words */
export function midiClockSourceText(engine: EngineAPI): string {
  const m = engine.midi;
  if (m.status !== 'on') return m.status === 'blocked' || m.status === 'unsupported' ? 'No MIDI on this page' : 'MIDI is off';
  if (!m.clockFrom) return 'No MIDI device chosen';
  if (!m.clockConnected) return `${m.clockFrom} not connected`;
  return fresh(engine) ? `from ${m.clockFrom}` : `no clock from ${m.clockFrom}`;
}

/** a clock in words, for CONFIG → CLOCK; `led` lights while it runs ('wait': stopped or no clock) */
export function clockState(engine: EngineAPI, which: ClockName): { text: string; led: 'on' | 'wait' | 'off' } {
  const on = clocksOn(engine.midi);
  const live = engine.state === 'running';
  const other = which === 'int' ? on.midi : on.int;
  const stand = other ? `${which === 'int' ? 'MIDI' : 'INT'} stands in` : 'all stand still';
  if (which === 'int') {
    if (!on.int) return { text: `Off · ${stand}`, led: 'off' };
    const run = engine.params.get('clock.run') >= 0.5;
    return { text: `On · ${run ? 'running' : 'stopped'}${live ? '' : ' (start audio)'}`, led: run && live ? 'on' : 'wait' };
  }
  const src = midiClockSourceText(engine);
  if (!engine.midi.midiClockOn) return { text: `Off · ${stand}`, led: 'off' };
  if (!on.midi) return { text: `${src} · ${stand}`, led: 'off' };
  if (!fresh(engine)) return { text: `${src} · ${live ? 'the last tempo runs on' : 'waiting'}`, led: 'off' };
  const run = clockView(engine, 'midi').running;
  return { text: `On · ${src} · ${run ? 'running' : 'stopped'}`, led: run ? 'on' : 'wait' };
}

/** the LFOs and clock mods that are on and chose this clock: "LFO1", "CM2" …; an LFO on RATE runs free: "LFO3 (RATE)" */
export function clockUsers(engine: EngineAPI, which: ClockName): string[] {
  const p = engine.params;
  const out: string[] = [];
  for (let n = 1; n <= NUM_LFOS; n++) if (p.get(`lfo${n}.on`) >= 0.5 && chosenClock(engine, `lfo${n}`) === which) out.push(p.get(`lfo${n}.sync`) >= 0.5 ? `LFO${n}` : `LFO${n} (RATE)`);
  for (let n = 1; n <= NUM_CMODS; n++) if (p.get(`cmod${n}.on`) >= 0.5 && chosenClock(engine, `cmod${n}`) === which) out.push(`CM${n}`);
  return out;
}

/**
 * CONFIG → GENERAL: both clocks as information only. INT and MIDI each with tempo and beat LEDs,
 * the LED before the name lights while the clock is on; under MIDI where its clock comes from.
 */
export function clockInfo(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const row = (which: ClockName, label: string) => {
    const led = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
    const bpm = h('b', { class: 'cfg-val clk-info-bpm' });
    const el = h('div', { class: 'cfg-row clk-info-row' }, led, h('span', { class: 'cfg-key' }, label), bpm, h('span', { class: 'cfg-grow' }), beatLeds(engine, which));
    return { which, led, bpm, el };
  };
  const rows = [row('int', 'INT'), row('midi', 'MIDI')];
  const src = h('span', { class: 'cfg-instate clk-info-src' });
  let last = '';
  frameLoop.add(() => {
    const on = clocksOn(engine.midi);
    const iv = p.get('clock.bpm');
    const mv = clockView(engine, 'midi');
    const s = midiClockSourceText(engine);
    const key = `${on.int}|${on.midi}|${iv.toFixed(1)}|${mv.bpm.toFixed(1)}|${mv.live}|${s}`;
    if (key === last) return;
    last = key;
    for (const r of rows) {
      toggleClass(r.led, 'is-on', on[r.which]);
      toggleClass(r.el, 'is-used', on[r.which]);
      r.el.title = on[r.which] ? 'On' : 'Off';
    }
    rows[0].bpm.textContent = bpmText(iv);
    rows[1].bpm.textContent = bpmText(mv.live ? mv.bpm : 0);
    src.textContent = src.title = s;
  });
  return h('div', { class: 'clk-info' }, rows[0].el, rows[1].el, h('div', { class: 'cfg-row clk-info-from' }, src));
}

/** status line group of one LFO or clock mod: the tempo of the clock it follows, INT · MIDI, beat LEDs */
export function clockStatus(engine: EngineAPI, module: string, name: string): HTMLElement {
  const follow = () => followedClock(engine, module);
  return h('span', { class: 'clk-clock' }, tempoReadout(engine, follow), clockChoice(engine, module, name), beatLeds(engine, follow));
}

/** TEMPO, RUN, TAP and RESET of the internal clock (CONFIG → CLOCK) */
export function intClockControls(engine: EngineAPI): { tempo: HTMLElement; run: HTMLElement; tap: HTMLElement; reset: HTMLElement } {
  const p = engine.params;
  const tempo = new ParamField(p, 'clock.bpm', { label: 'TEMPO', ariaLabel: 'Tempo', format: (v) => `${v.toFixed(1)} BPM` });
  const run = new ParamToggle(p, 'clock.run', { label: 'RUN', ariaLabel: 'Clock run' });
  run.el.title = 'Run or stop the internal clock';

  const setBpm = (v: number) => {
    p.beginGesture('clock.bpm');
    p.set('clock.bpm', Math.min(BPM_MAX, Math.max(BPM_MIN, v)));
    p.endGesture('clock.bpm');
  };
  /* tap tempo: average interval of the last taps */
  const tap = h('button', { type: 'button', class: 'clk-btn', title: 'Tap tempo' }, 'TAP');
  const taps: number[] = [];
  const onTap = (t: number) => {
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
    flash(tap);
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(Math.round((60000 / avg) * 10) / 10);
    }
  };
  // pointerdown, not click: the press is the beat
  tap.addEventListener('pointerdown', (e) => {
    if (e.button === 0) onTap(e.timeStamp);
  });
  tap.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      onTap(e.timeStamp);
    }
  });
  const reset = h('button', { type: 'button', class: 'clk-btn', title: 'Restart the internal clock at beat 1 (the MIDI clock restarts with MIDI Start)' }, 'RESET');
  reset.addEventListener('click', () => {
    engine.mod.resetClock();
    flash(reset);
  });

  return { tempo: tempo.el, run: run.el, tap, reset };
}
