/**
 * External MIDI clock for the modulation clock (docs/midi-2026-10-16.md, point 1B).
 *
 * The main thread forwards clock ticks (24 per quarter note), Start, Continue and Stop with their
 * time on the AudioContext timeline. Per audio block `advance()` moves the beat position:
 *   - Position: tick k after Start lies on beat k/24. Between ticks the position runs on at the
 *     measured tempo; a small correction pulls it onto the ticks without ever running backwards.
 *   - Tempo: average tick interval over the last two beats.
 *   - Start: beat 0, the sources restart; the clock waits for the first tick. Stop holds the
 *     position, Continue resumes it with the next tick.
 *   - Before any Start or Stop it runs while ticks arrive (joined a running device).
 *   - Without ticks it keeps the last tempo and runs on. When ticks come back after a pause it
 *     carries on from where it is.
 * Only shared code and plain numbers here: it runs inside the AudioWorklet.
 */
import type { ClockState } from './modules/types';

export const MIDI_TICK = 0;
export const MIDI_START = 1;
export const MIDI_CONTINUE = 2;
export const MIDI_STOP = 3;

/** MIDI clock ticks per quarter note */
export const PPQ = 24;
const RING = 2 * PPQ;
/** ticks needed before the measured tempo replaces the previous one */
const MIN_TICKS = 6;
/** the position runs on at the tempo of the last few ticks, so it follows tempo changes at once */
const RATE_TICKS = 6;
/** a pause between two ticks longer than this (and at least GAP_TICKS intervals) starts over */
const GAP_SEC = 0.25;
const GAP_TICKS = 4;
/** time constant of the pull onto the ticks */
const TAU = 0.05;
/** a position more than this far behind the ticks jumps instead of catching up */
const SNAP_BEATS = 0.5;
export const EXT_BPM_MIN = 20;
export const EXT_BPM_MAX = 300;
/** events further ahead than this are taken as due now (a broken time mapping) */
const MAX_AHEAD = 0.2;
const QUEUE_MAX = 1024;

export class ExtClock {
  /** measured tempo (two beats), shown and used by the modules */
  bpm = 120;
  /** tempo of the last few ticks: the speed between ticks */
  private rate = 120;
  /** current position in beats */
  phase = 0;
  /** position moves */
  running = true;
  /** a Start arrived since the last advance(): the engine restarts its sources at beat 0 */
  started = false;
  /** time of the last tick seen (any transport state), -Infinity before the first */
  lastTick = -Infinity;

  /** 'free': no Start / Stop seen yet, runs while ticks come; 'run' / 'stop': transport */
  private transport: 'free' | 'run' | 'stop' = 'free';
  /** after Start / Continue: hold until the first tick */
  private armed = false;
  /** ticks counted since Start (-1 = none yet) */
  private tick = -1;
  /** time of the last counted tick */
  private tickT = NaN;
  /** position of tick 0 */
  private base = 0;
  private ring = new Float64Array(RING);
  private ringN = 0;
  private ringHead = 0;
  private qEv: number[] = [];
  private qT: number[] = [];
  private qHead = 0;

  /** start over from a position and tempo (switching from the internal clock) */
  reset(phase: number, bpm: number): void {
    this.phase = phase;
    this.bpm = this.rate = clampBpm(bpm);
    this.running = true;
    this.started = false;
    this.transport = 'free';
    this.armed = false;
    this.tick = -1;
    this.tickT = NaN;
    this.base = phase;
    this.ringN = 0;
    this.ringHead = 0;
    this.lastTick = -Infinity;
    this.qEv.length = this.qT.length = 0;
    this.qHead = 0;
  }

  /** back to beat 0 at the current tick (RESET); transport and tempo stay */
  rewind(): void {
    this.phase = 0;
    this.base = this.tick >= 0 ? -this.tick / PPQ : 0;
  }

  /** queue an event at time t (seconds, AudioContext time) */
  push(ev: number, t: number): void {
    if (!Number.isFinite(t) || ev < MIDI_TICK || ev > MIDI_STOP) return;
    if (this.qEv.length - this.qHead >= QUEUE_MAX) return;
    // in time order (a changed OFFSET can stamp a new event before queued ones)
    let i = this.qT.length;
    while (i > this.qHead && this.qT[i - 1] > t) i--;
    this.qEv.splice(i, 0, ev);
    this.qT.splice(i, 0, t);
  }

  /** tempo over the last n ticks (newest at time t) */
  private tempoOver(n: number, t: number, fallback: number): number {
    const span = t - this.ring[(this.ringHead - n + RING) % RING];
    return span > 0 ? clampBpm((60 * (n - 1)) / (PPQ * span)) : fallback;
  }

  private gap(): number {
    return Math.max(GAP_SEC, (GAP_TICKS * 60) / (this.bpm * PPQ));
  }

  private apply(ev: number, t: number): void {
    switch (ev) {
      case MIDI_TICK: {
        const pause = !(t - this.lastTick <= this.gap());
        // tempo from every tick, also while stopped (devices keep sending clock)
        if (pause) this.ringN = 0;
        this.ring[this.ringHead] = t;
        this.ringHead = (this.ringHead + 1) % RING;
        if (this.ringN < RING) this.ringN++;
        if (this.ringN >= MIN_TICKS) {
          this.bpm = this.tempoOver(this.ringN, t, this.bpm);
          this.rate = this.tempoOver(RATE_TICKS, t, this.rate);
        }
        this.lastTick = t;
        if (this.transport === 'stop') break;
        this.tick++;
        // first tick at all, or back after a pause: carry on from the current position
        if (pause && !this.armed) this.base = this.phase - this.tick / PPQ;
        this.tickT = t;
        this.armed = false;
        break;
      }
      case MIDI_START:
        this.transport = 'run';
        this.armed = true;
        this.tick = -1;
        this.tickT = NaN;
        this.base = 0;
        this.phase = 0;
        this.started = true;
        break;
      case MIDI_CONTINUE:
        this.transport = 'run';
        this.armed = true;
        break;
      case MIDI_STOP:
        this.transport = 'stop';
        break;
    }
  }

  /**
   * Move the clock to the end of a block: t1 = block end, dt = block length (seconds).
   * Writes position, tempo and run state into `c`; returns true when a Start arrived.
   */
  advance(c: ClockState, t1: number, dt: number): boolean {
    this.started = false;
    const qe = this.qEv, qt = this.qT;
    while (this.qHead < qe.length) {
      let t = qt[this.qHead];
      if (t > t1 + MAX_AHEAD) t = t1; // far ahead: the time mapping is off, take it as due now
      else if (t > t1) break; // due in a later block (OFFSET delays events)
      this.apply(qe[this.qHead], t);
      this.qHead++;
    }
    if (this.qHead > 256 || this.qHead === qe.length) {
      qe.splice(0, this.qHead);
      qt.splice(0, this.qHead);
      this.qHead = 0;
    }
    const started = this.started;
    this.running = this.transport !== 'stop' && !this.armed;
    if (this.running) {
      const pred = this.phase + (dt * this.rate) / 60;
      if (this.tick >= 0 && t1 - this.tickT <= this.gap() * 4) {
        // pull onto the ticks: target = position of the last tick, run on at the tempo since
        const target = this.base + this.tick / PPQ + ((t1 - this.tickT) * this.rate) / 60;
        const err = target - pred;
        const next = err > SNAP_BEATS ? target : pred + err * (1 - Math.exp(-dt / TAU));
        if (next > this.phase) this.phase = next;
      } else {
        this.phase = pred; // no clock (yet): the last tempo runs on
      }
    }
    c.beatsPrev = started ? 0 : c.beats;
    c.beats = this.phase;
    c.bpm = this.bpm;
    c.running = this.running;
    return started;
  }
}

function clampBpm(v: number): number {
  return v > EXT_BPM_MAX ? EXT_BPM_MAX : v >= EXT_BPM_MIN ? v : EXT_BPM_MIN;
}
