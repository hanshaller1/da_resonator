/**
 * The clock in the UI. The internal clock is set once, in CONFIG (TEMPO, RUN, TAP, RESET); CLK MOD
 * and LFO MOD show the clock in their status line: the tempo (a click opens CONFIG), INT · MIDI
 * and the beat LEDs. INT · MIDI is one browser setting (docs/midi-2026-10-16.md 1B), the same
 * wherever it is switched.
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

/** INT · MIDI: which clock drives the clock mods and the LFOs on DIV. The MIDI button lights while MIDI clock comes in. */
export function clockSourceSwitch(engine: EngineAPI): HTMLElement {
  const midi = engine.midi;
  const led = h('span', { class: 'inst-led', 'aria-hidden': 'true' });
  const btns = (['int', 'midi'] as const).map((src) => {
    const b = h(
      'button',
      { type: 'button', class: 'inst-btn', title: src === 'int' ? 'Internal clock: TEMPO, RUN and TAP in CONFIG' : 'Follow MIDI clock: tempo, Start, Stop and Continue of the MIDI device (CONFIG → MIDI)' },
      ...(src === 'midi' ? [led, 'MIDI'] : ['INT']),
    );
    b.addEventListener('click', async () => {
      // MIDI needs access first; where the page may not use MIDI the clock stays internal
      if (src === 'midi' && midi.status !== 'on') await midi.enable();
      if (src === 'int' || midi.status === 'on') midi.setClockSource(src);
    });
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
    const on = isExt(engine) && performance.now() - midi.clockAt < FRESH_MS;
    if (on !== lit) toggleClass(led, 'is-on', (lit = on));
  });
  return h('span', { class: 'inst clk-src', role: 'group', 'aria-label': 'Clock source' }, ...btns.map((x) => x.b));
}

/** four beat LEDs: position in the bar, flash on each beat while the clock runs */
export function beatLeds(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const beats = Array.from({ length: 4 }, () => h('span', { class: 'clk-beat' }));
  const row = h('span', { class: 'clk-beats', role: 'img', 'aria-label': 'Beat' }, ...beats);
  let lastBeat = -1;
  let lastFlash = false;
  frameLoop.add(() => {
    const live = engine.state === 'running';
    const b = engine.mod.beats;
    const beat = live ? Math.floor(b) : -1;
    const running = isExt(engine) ? engine.mod.running : p.get('clock.run') >= 0.5;
    const on = live && running && b - Math.floor(b) < FLASH;
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

/** the tempo as a readout: TEMPO on INT, the measured tempo on MIDI; a click opens the clock in CONFIG */
function tempoReadout(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const midi = engine.midi;
  const val = h('span', { class: 'pfield-value' });
  const el = h('button', { type: 'button', class: 'pfield clk-tempo', 'aria-label': 'Tempo, set in CONFIG' }, h('span', { class: 'pfield-label' }, 'TEMPO'), val);
  el.addEventListener('click', () => nav.reveal('clock.bpm'));
  let last = '';
  frameLoop.add(() => {
    const ext = isExt(engine);
    const bpm = ext ? engine.mod.bpm : p.get('clock.bpm');
    const fresh = performance.now() - midi.clockAt < FRESH_MS;
    const run = ext ? engine.mod.running : p.get('clock.run') >= 0.5;
    const key = `${bpm.toFixed(1)}|${ext}|${fresh}|${run}`;
    if (key === last) return;
    last = key;
    val.textContent = `${bpm.toFixed(1)} BPM`;
    el.title = ext
      ? !fresh
        ? 'No MIDI clock: the last tempo runs on'
        : run
          ? 'Tempo of the MIDI clock'
          : 'MIDI clock stopped'
      : `Internal clock${run ? '' : ', stopped'}: set TEMPO, RUN, TAP and RESET in CONFIG`;
  });
  return el;
}

/** the clock in words, for CONFIG: source, tempo, running; `led` lights while it runs ('wait': MIDI clock stopped) */
export function clockState(engine: EngineAPI): { text: string; led: 'on' | 'wait' | 'off' } {
  const midi = engine.midi;
  const live = engine.state === 'running';
  const bpm = `${engine.mod.bpm.toFixed(1)} BPM`;
  if (!isExt(engine)) {
    const run = engine.params.get('clock.run') >= 0.5;
    return { text: `Internal · ${engine.params.get('clock.bpm').toFixed(1)} BPM · ${run ? 'running' : 'stopped'}`, led: run && live ? 'on' : 'off' };
  }
  const fresh = performance.now() - midi.clockAt < FRESH_MS;
  if (!fresh) return { text: `No MIDI clock · ${live ? `${bpm} runs on` : 'waiting'}`, led: 'off' };
  const run = engine.mod.running;
  return { text: `MIDI clock · ${bpm} · ${run ? 'running' : 'stopped'}${live ? '' : ' (start audio)'}`, led: run ? 'on' : 'wait' };
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
    tempo.el.title = ext ? 'Tempo of the internal clock, used on INT' : '';
  };
  sync();
  midi.onChange(sync);
  return { tempo: tempo.el, run: run.el, tap, reset };
}
