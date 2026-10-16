/**
 * The clock in the UI. One clock drives the clock mods and the LFOs on DIV: the internal clock
 * (TEMPO, RUN, TAP, RESET) or the MIDI clock (from the MIDI device or a device of its own, with
 * OFFSET). Both are set on CONFIG → CLOCK; CONFIG → GENERAL shows both (tempo, beats, MIDI source);
 * CLK MOD and LFO MOD show the clock in use in their status line: the tempo (a click opens
 * CONFIG → CLOCK), INT · MIDI and the beat LEDs. INT · MIDI is one browser setting
 * (docs/midi-2026-10-16.md 1B), the same wherever it is switched.
 */
import '../styles/components/clock.css';
import type { EngineAPI } from '../core/types';
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

function flash(el: HTMLElement): void {
  el.classList.remove('is-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('is-flash');
}

const isExt = (engine: EngineAPI) => engine.midi.clockSource === 'midi';
const fresh = (engine: EngineAPI) => performance.now() - engine.midi.clockAt < FRESH_MS;

/** make `src` the clock; MIDI needs access first (where the page may not use MIDI the clock stays internal) */
export async function setClock(engine: EngineAPI, src: 'int' | 'midi'): Promise<void> {
  const midi = engine.midi;
  if (src === 'midi' && midi.status !== 'on') await midi.enable();
  if (src === 'int' || midi.status === 'on') midi.setClockSource(src);
}

export type ClockWhich = 'active' | 'int' | 'midi';

/** what a clock shows: tempo (0 = unknown), position in beats, running, and whether it moves at all (`live`) */
export interface ClockView {
  bpm: number;
  beats: number;
  running: boolean;
  live: boolean;
}

/** INT moves only while it is the clock and audio runs */
function intView(engine: EngineAPI): ClockView {
  const p = engine.params;
  return { bpm: p.get('clock.bpm'), beats: engine.mod.beats, running: p.get('clock.run') >= 0.5, live: !isExt(engine) && engine.state === 'running' };
}

/** MIDI: the engine's clock while it follows MIDI and audio runs, else the clock as the MIDI service follows it */
function midiView(engine: EngineAPI): ClockView {
  const m = engine.midi;
  if (isExt(engine) && engine.state === 'running') return { bpm: engine.mod.bpm, beats: engine.mod.beats, running: engine.mod.running, live: true };
  const f = fresh(engine);
  return { bpm: m.clockBpm, beats: m.clockBeats, running: m.clockRunning && f, live: f };
}

export function clockView(engine: EngineAPI, which: ClockWhich): ClockView {
  return which === 'int' || (which === 'active' && !isExt(engine)) ? intView(engine) : midiView(engine);
}

/** INT · MIDI: which clock drives the clock mods and the LFOs on DIV. The MIDI button lights while MIDI clock comes in. */
export function clockSourceSwitch(engine: EngineAPI): HTMLElement {
  const midi = engine.midi;
  const led = h('span', { class: 'inst-led', 'aria-hidden': 'true' });
  const btns = (['int', 'midi'] as const).map((src) => {
    const b = h(
      'button',
      { type: 'button', class: 'inst-btn', title: src === 'int' ? 'Internal clock: TEMPO, RUN and TAP in CONFIG → CLOCK' : 'Follow MIDI clock: tempo, Start, Stop and Continue (source in CONFIG → CLOCK)' },
      ...(src === 'midi' ? [led, 'MIDI'] : ['INT']),
    );
    b.addEventListener('click', () => void setClock(engine, src));
    return { src, b };
  });
  const sync = () => {
    for (const { src, b } of btns) {
      toggleClass(b, 'is-selected', midi.clockSource === src);
      b.setAttribute('aria-pressed', String(midi.clockSource === src));
    }
  };
  sync();
  midi.onChange(sync);
  let lit = false;
  frameLoop.add(() => {
    const on = isExt(engine) && fresh(engine);
    if (on !== lit) toggleClass(led, 'is-on', (lit = on));
  });
  return h('span', { class: 'inst clk-src', role: 'group', 'aria-label': 'Clock source' }, ...btns.map((x) => x.b));
}

/** four beat LEDs of the clock in use, or of INT / MIDI: position in the bar, flash on each beat while it runs */
export function beatLeds(engine: EngineAPI, which: ClockWhich = 'active'): HTMLElement {
  const beats = Array.from({ length: 4 }, () => h('span', { class: 'clk-beat' }));
  const row = h('span', { class: 'clk-beats', role: 'img', 'aria-label': which === 'int' ? 'Beat of the internal clock' : which === 'midi' ? 'Beat of the MIDI clock' : 'Beat' }, ...beats);
  let lastBeat = -1;
  let lastFlash = false;
  frameLoop.add(() => {
    const v = clockView(engine, which);
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

/** the tempo as a readout: TEMPO on INT, the measured tempo on MIDI; a click opens CONFIG → CLOCK */
function tempoReadout(engine: EngineAPI): HTMLElement {
  const val = h('span', { class: 'pfield-value' });
  const el = h('button', { type: 'button', class: 'pfield clk-tempo', 'aria-label': 'Tempo, set in CONFIG → CLOCK' }, h('span', { class: 'pfield-label' }, 'TEMPO'), val);
  el.addEventListener('click', () => nav.reveal('clock.bpm'));
  let last = '';
  frameLoop.add(() => {
    const ext = isExt(engine);
    const v = clockView(engine, 'active');
    const f = fresh(engine);
    const key = `${v.bpm.toFixed(1)}|${ext}|${f}|${v.running}`;
    if (key === last) return;
    last = key;
    val.textContent = bpmText(v.bpm);
    el.title = ext
      ? !f
        ? 'No MIDI clock: the last tempo runs on (CONFIG → CLOCK)'
        : v.running
          ? 'Tempo of the MIDI clock (CONFIG → CLOCK)'
          : 'MIDI clock stopped (CONFIG → CLOCK)'
      : `Internal clock${v.running ? '' : ', stopped'}: TEMPO, RUN, TAP and RESET in CONFIG → CLOCK`;
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

/** a clock in words, for CONFIG: in use or not, running; `led` lights while it runs ('wait': stopped or no clock) */
export function clockState(engine: EngineAPI, which: 'int' | 'midi'): { text: string; led: 'on' | 'wait' | 'off' } {
  const used = (which === 'midi') === isExt(engine);
  const live = engine.state === 'running';
  if (which === 'int') {
    const run = engine.params.get('clock.run') >= 0.5;
    if (!used) return { text: 'Not in use: the MIDI clock drives', led: 'off' };
    return { text: `In use · ${run ? 'running' : 'stopped'}${live ? '' : ' (start audio)'}`, led: run && live ? 'on' : 'wait' };
  }
  const src = midiClockSourceText(engine);
  if (!fresh(engine)) return { text: used ? `${src} · ${live ? 'the last tempo runs on' : 'waiting'}` : src, led: 'off' };
  const run = clockView(engine, 'midi').running;
  return { text: `${used ? 'In use' : 'Not in use'} · ${src} · ${run ? 'running' : 'stopped'}`, led: run ? 'on' : 'wait' };
}

/**
 * CONFIG → GENERAL: both clocks as information only. INT and MIDI each with tempo and beat LEDs,
 * the LED before the name marks the clock in use; under MIDI where its clock comes from.
 */
export function clockInfo(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const row = (which: 'int' | 'midi', label: string) => {
    const led = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
    const bpm = h('b', { class: 'cfg-val clk-info-bpm' });
    const el = h('div', { class: 'cfg-row clk-info-row' }, led, h('span', { class: 'cfg-key' }, label), bpm, h('span', { class: 'cfg-grow' }), beatLeds(engine, which));
    return { which, led, bpm, el };
  };
  const rows = [row('int', 'INT'), row('midi', 'MIDI')];
  const src = h('span', { class: 'cfg-instate clk-info-src' });
  let last = '';
  frameLoop.add(() => {
    const ext = isExt(engine);
    const iv = p.get('clock.bpm');
    const mv = clockView(engine, 'midi');
    const s = midiClockSourceText(engine);
    const key = `${ext}|${iv.toFixed(1)}|${mv.bpm.toFixed(1)}|${mv.live}|${s}`;
    if (key === last) return;
    last = key;
    for (const r of rows) {
      const used = (r.which === 'midi') === ext;
      toggleClass(r.led, 'is-on', used);
      toggleClass(r.el, 'is-used', used);
      r.el.title = used ? 'In use: the clock mods and the LFOs on DIV follow it' : 'Not in use';
    }
    rows[0].bpm.textContent = bpmText(iv);
    rows[1].bpm.textContent = bpmText(mv.live ? mv.bpm : 0);
    src.textContent = src.title = s;
  });
  return h('div', { class: 'clk-info' }, rows[0].el, rows[1].el, h('div', { class: 'cfg-row clk-info-from' }, src));
}

/** status line group of CLK MOD and LFO MOD: tempo, INT · MIDI, beat LEDs */
export function clockStatus(engine: EngineAPI): HTMLElement {
  return h('span', { class: 'clk-clock' }, tempoReadout(engine), clockSourceSwitch(engine), beatLeds(engine));
}

/** TEMPO, RUN, TAP and RESET of the internal clock (CONFIG). On MIDI, Start and Stop run the clock: RUN, TAP and RESET rest. */
export function intClockControls(engine: EngineAPI): { tempo: HTMLElement; run: HTMLElement; tap: HTMLElement; reset: HTMLElement } {
  const p = engine.params;
  const midi = engine.midi;
  const tempo = new ParamField(p, 'clock.bpm', { label: 'TEMPO', ariaLabel: 'Tempo', format: (v) => `${v.toFixed(1)} BPM` });
  const run = new ParamToggle(p, 'clock.run', { label: 'RUN', ariaLabel: 'Clock run' });

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
  const reset = h('button', { type: 'button', class: 'clk-btn', title: 'Restart the clock at beat 1' }, 'RESET');
  reset.addEventListener('click', () => {
    engine.mod.resetClock();
    flash(reset);
  });

  const sync = () => {
    const ext = isExt(engine);
    run.el.disabled = tap.disabled = reset.disabled = ext;
    toggleClass(run.el, 'is-ext', ext);
    run.el.title = ext ? 'MIDI Start and Stop run the clock' : '';
    reset.title = ext ? 'MIDI Start restarts the clock at beat 1' : 'Restart the clock at beat 1';
    tap.title = ext ? 'The MIDI clock sets the tempo' : 'Tap tempo';
    tempo.el.title = ext ? 'Tempo of the internal clock, used when it is on' : '';
  };
  sync();
  midi.onChange(sync);
  return { tempo: tempo.el, run: run.el, tap, reset };
}
