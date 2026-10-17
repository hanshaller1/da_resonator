/**
 * Modulation engine inside the AudioWorklet (docs/plan-modulation-und-module.md E1, 4.3).
 *
 * Per audio block:
 *   1. walk the modulation graph in topological order (clock, macros, LFOs, clock mods, env
 *      followers, routes); every module first gets its own effective params, then computes its value
 *   2. routes add `source × depth` (normalized) onto their target params
 *   3. effective values of the audio modules (resonator, dyn, filters) are ready for the audio pass
 *   4. the band scanner steps (it reads any source, so it runs after the whole graph)
 * After the audio pass analysers (env followers) read the tap buffers, and every ~16 ms a readout
 * goes to the UI.
 */
import { NUM_CMODS, NUM_EFS, NUM_LFOS, NUM_TAPS, followsMidi } from '../shared/paramdefs/modules';
import { NUM_PARAMS, PARAMS, PARAM_BY_ID, defaultValues, fromNorm, paramIndex, toNorm } from '../shared/params';
import { evaluationOrder, routeDests, type ModConfig } from '../shared/mod/rules';
import { NUM_SOURCES, NUM_TRIGGER_INS, NUM_TRIGGER_OUTS, SOURCE_BY_ID, TRIGGER_OUT_BY_ID } from '../shared/mod/sources';
import { ClockModDsp } from './modules/cmod';
import { EnvFollowerDsp } from './modules/ef';
import { FilterStage } from './modules/filter';
import { LfoDsp } from './modules/lfo';
import { BandScanner } from './modules/scan';
import type { BlockCtx, ClockState, SourceDsp } from './modules/types';
import { ExtClock } from './extClock';

export const MAX_BLOCK = 128;
const READOUT_SEC = 1 / 60;

type Step = () => void;

export interface ModReadout {
  type: 'mod';
  /** current value of every source (SOURCES order) */
  src: Float32Array;
  /** pairs [paramIndex, effectiveNorm] for every modulated param */
  mod: Float32Array;
  /** internal clock: beats, tempo, 1 while it moves */
  beats: number;
  bpm: number;
  run: number;
  /** MIDI clock: beats, measured tempo, 1 while it moves */
  midiBeats: number;
  midiBpm: number;
  midiRun: number;
}

export class ModEngine {
  readonly base = defaultValues();
  private baseNorm = new Float32Array(NUM_PARAMS);
  readonly eff = defaultValues();
  /** normalized offset per param (sum of routes) */
  private offset = new Float32Array(NUM_PARAMS);
  /** 1 if any route targets the param */
  readonly modulated = new Uint8Array(NUM_PARAMS);
  readonly srcVals = new Float32Array(NUM_SOURCES);
  /** true when any resonator param (index < 40) is modulated or a base value changed */
  baseVersion = 0;

  /** internal clock: TEMPO and RUN */
  readonly clock: ClockState = { bpm: 120, running: true, beats: 0, beatsPrev: 0 };
  /** MIDI clock (docs/midi-2026-10-16.md): tempo, Start / Stop and position from the incoming clock */
  readonly midiClock: ClockState = { bpm: 120, running: false, beats: 0, beatsPrev: 0 };
  readonly ext = new ExtClock();
  /**
   * Which clocks are on (CONFIG → CLOCK). Both run side by side; each LFO and clock mod follows the
   * one its param `.clk` names, or the other one while that is off. A clock that is off stands
   * still; with both off, so does everything on a clock.
   */
  private intOn = true;
  private midiOn = false;
  /** time at the end of the current block (seconds; AudioContext time in the worklet) */
  private time = 0;
  readonly taps: Float32Array[] = [];
  readonly tapsL: Float32Array[] = [];
  readonly tapsR: Float32Array[] = [];
  /** a follower that is on listens to L or R: the worklet fills tapsL / tapsR this block */
  lrTaps = false;
  private efCh: { on: number; ch: number }[] = [];
  readonly preFilter = new FilterStage('filterPre');
  readonly postFilter = new FilterStage('filterPost');
  /** band scanner (CLK MOD → SCAN): runs after the graph, so every source has its value of this block */
  readonly scan = new BandScanner();
  private scanClk = paramIndex('scan.clk');

  /** clkIdx: index of the source's clock choice (INT / MIDI), -1 if it has none (env followers) */
  private sources = new Map<string, { dsp: SourceDsp; onIdx: number; srcIdx: number; clkIdx: number; wasOn: boolean }>();
  private steps: Step[] = [];
  private routeDsts: number[] = [];
  private trigPending = new Uint8Array(NUM_TRIGGER_INS);
  private trigTargets: number[][] = [];
  private cfg: ModConfig = { routes: [], triggers: [] };
  private readoutEvery: number;
  private readoutCount = 0;
  private iBpm = paramIndex('clock.bpm');
  private iRun = paramIndex('clock.run');
  private beatTrig = TRIGGER_OUT_BY_ID['clock.beat'].index;
  private midiBeatTrig = TRIGGER_OUT_BY_ID['clock.midiBeat'].index;
  readonly ctx: BlockCtx;

  constructor(readonly fs: number, private post: (m: ModReadout) => void) {
    for (let t = 0; t < NUM_TAPS; t++) {
      this.taps.push(new Float32Array(MAX_BLOCK));
      this.tapsL.push(new Float32Array(MAX_BLOCK));
      this.tapsR.push(new Float32Array(MAX_BLOCK));
    }
    for (let n = 1; n <= NUM_EFS; n++) this.efCh.push({ on: paramIndex(`ef${n}.on`), ch: paramIndex(`ef${n}.ch`) });
    for (let t = 0; t < NUM_TRIGGER_OUTS; t++) this.trigTargets.push([]);
    const add = (id: string, dsp: SourceDsp) =>
      this.sources.set(id, { dsp, onIdx: paramIndex(`${id}.on`), srcIdx: SOURCE_BY_ID[id].index, clkIdx: PARAM_BY_ID[`${id}.clk`]?.index ?? -1, wasOn: false });
    for (let n = 1; n <= NUM_LFOS; n++) add(`lfo${n}`, new LfoDsp(n));
    for (let n = 1; n <= NUM_CMODS; n++) add(`cmod${n}`, new ClockModDsp(n));
    for (let n = 1; n <= NUM_EFS; n++) add(`ef${n}`, new EnvFollowerDsp(n));
    this.readoutEvery = Math.max(1, Math.round((READOUT_SEC * fs) / MAX_BLOCK));
    const self = this;
    this.ctx = {
      fs,
      n: MAX_BLOCK,
      dt: MAX_BLOCK / fs,
      eff: this.eff,
      clock: this.clock,
      taps: this.taps,
      tapsL: this.tapsL,
      tapsR: this.tapsR,
      triggered(i: number) {
        const t = self.trigPending[i] === 1;
        self.trigPending[i] = 0;
        return t;
      },
      fire(o: number) {
        for (const i of self.trigTargets[o]) self.trigPending[i] = 1;
      },
    };
    this.setBase(this.base);
    this.setConfig(this.cfg);
  }

  /** new base values (plain). Shorter arrays only update the leading params (old v1 senders). */
  setBase(values: Float32Array): void {
    const n = Math.min(values.length, NUM_PARAMS);
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (Number.isFinite(v)) this.base[i] = v;
    }
    for (let i = 0; i < NUM_PARAMS; i++) {
      this.baseNorm[i] = toNorm(PARAMS[i], this.base[i]);
      if (!this.modulated[i]) this.eff[i] = this.base[i];
    }
    this.baseVersion++;
  }

  setConfig(cfg: ModConfig): void {
    let order: string[];
    try {
      order = evaluationOrder(cfg);
    } catch {
      return; // never apply a cyclic config (main thread validates; this is a safety net)
    }
    this.cfg = cfg;
    this.modulated.fill(0);
    this.routeDsts = [];
    for (const r of cfg.routes) {
      // a route onto an L/R pair moves the L param, its R twin or both (channel); onto a band group its bands (shared/mod/rules.ts)
      for (const [d] of routeDests(r.dst, r.ch)) {
        this.modulated[d] = 1;
        if (!this.routeDsts.includes(d)) this.routeDsts.push(d);
      }
    }
    for (let i = 0; i < NUM_PARAMS; i++) if (!this.modulated[i]) this.eff[i] = this.base[i];
    for (const l of this.trigTargets) l.length = 0;
    for (const t of cfg.triggers) this.trigTargets[t.src].push(t.dst);
    this.steps = this.compile(order);
    this.baseVersion++;
  }

  private paramsOf(module: string): number[] {
    const out: number[] = [];
    for (const p of PARAMS) if (p.module === module) out.push(p.index);
    return out;
  }

  /** effective values for a set of params: base + Σ routes (normalized), back to plain */
  private resolve(idx: number[]): void {
    const eff = this.eff, off = this.offset, mod = this.modulated;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (!mod[i]) continue;
      const o = off[i];
      eff[i] = o === 0 ? this.base[i] : fromNorm(PARAMS[i], this.baseNorm[i] + o);
    }
  }

  private compile(order: string[]): Step[] {
    const steps: Step[] = [];
    const routeBySlot = new Map(this.cfg.routes.map((r) => [r.slot, r]));
    for (const node of order) {
      const params = this.paramsOf(node);
      const needsResolve = params.some((i) => this.modulated[i]);
      const resolve = needsResolve ? () => this.resolve(params) : null;
      if (node === 'clock') {
        steps.push(() => {
          resolve?.();
          this.advanceClock();
        });
      } else if (node.startsWith('macro')) {
        const vi = paramIndex(`${node}.value`);
        const si = SOURCE_BY_ID[node].index;
        steps.push(() => {
          this.srcVals[si] = this.eff[vi];
        });
      } else if (this.sources.has(node)) {
        const s = this.sources.get(node)!;
        steps.push(() => {
          resolve?.();
          const on = this.eff[s.onIdx] >= 0.5;
          // switching a source on starts it fresh (no stale envelope / phase from before it was off)
          if (on && !s.wasOn) s.dsp.reset();
          s.wasOn = on;
          this.ctx.clock = this.usesMidi(s.clkIdx) ? this.midiClock : this.clock;
          this.srcVals[s.srcIdx] = on ? s.dsp.update(this.ctx) : 0;
        });
      } else if (node.startsWith('route')) {
        const slot = +node.slice(5);
        const r = routeBySlot.get(slot);
        if (!r) continue;
        const di = paramIndex(`route${slot}.depth`);
        const src = r.src;
        const dests = routeDests(r.dst, r.ch);
        if (dests.length <= 2) {
          // one param or one L/R pair (the common case, kept as it was)
          const [dL, sL] = dests[0] ?? [-1, 1];
          const [dR, sR] = dests[1] ?? [-1, 1];
          steps.push(() => {
            resolve?.();
            const v = this.srcVals[src] * this.eff[di];
            if (dL >= 0) this.offset[dL] += sL * v;
            if (dR >= 0) this.offset[dR] += sR * v;
          });
        } else {
          // band group: the same offset on every band of the group
          const idx = Int32Array.from(dests.map((d) => d[0]));
          const sgn = Float32Array.from(dests.map((d) => d[1]));
          steps.push(() => {
            resolve?.();
            const v = this.srcVals[src] * this.eff[di];
            for (let k = 0; k < idx.length; k++) this.offset[idx[k]] += sgn[k] * v;
          });
        }
      } else if (resolve) {
        // audio modules (resonator, dyn, filters) and anything else with modulated params
        steps.push(resolve);
      }
    }
    return steps;
  }

  /** true if the source with clock choice `clkIdx` (-1 = none: INT) follows the MIDI clock now */
  private usesMidi(clkIdx: number): boolean {
    return followsMidi(clkIdx >= 0 && this.eff[clkIdx] >= 0.5, this.intOn, this.midiOn);
  }

  /** start the sources on one clock over (RESET of the internal clock, MIDI Start) */
  private resetSources(midi: boolean): void {
    for (const s of this.sources.values()) if (this.usesMidi(s.clkIdx) === midi) s.dsp.reset();
    if (this.usesMidi(this.scanClk) === midi) this.scan.reset();
  }

  private advanceClock(): void {
    const c = this.clock;
    c.bpm = this.eff[this.iBpm];
    c.running = this.intOn && this.eff[this.iRun] >= 0.5;
    c.beatsPrev = c.beats;
    if (c.running) c.beats += (this.ctx.dt * c.bpm) / 60;
    if (Math.floor(c.beats) !== Math.floor(c.beatsPrev)) this.ctx.fire(this.beatTrig);
    const m = this.midiClock;
    if (this.midiOn) {
      // MIDI Start: beat 1, the sources on the MIDI clock start over
      if (this.ext.advance(m, this.time, this.ctx.dt)) this.resetSources(true);
    } else {
      m.beatsPrev = m.beats;
      m.running = false;
    }
    if (Math.floor(m.beats) !== Math.floor(m.beatsPrev)) this.ctx.fire(this.midiBeatTrig);
  }

  /** which clocks are on; switching the MIDI clock on carries on from its position, at TEMPO until MIDI clock comes in */
  setClockOn(int: boolean, midi: boolean): void {
    this.intOn = int;
    if (midi === this.midiOn) return;
    this.midiOn = midi;
    if (midi) this.ext.reset(this.midiClock.beats, this.eff[this.iBpm]);
  }

  get clockOn(): { int: boolean; midi: boolean } {
    return { int: this.intOn, midi: this.midiOn };
  }

  /** a MIDI clock event (extClock.ts MIDI_TICK …) at time t on the block time line */
  pushClock(ev: number, t: number): void {
    if (this.midiOn) this.ext.push(ev, t);
  }

  /** time at the end of the last block */
  get now(): number {
    return this.time;
  }

  /**
   * run the graph for a block of n samples (before the audio pass); t0 = time of its first sample
   * (the worklet's currentTime; without it the engine counts its own time)
   */
  beginBlock(n: number, t0: number = this.time): void {
    this.ctx.n = n;
    this.ctx.dt = n / this.fs;
    this.time = (Number.isFinite(t0) ? t0 : this.time) + this.ctx.dt;
    const off = this.offset;
    for (let k = 0; k < this.routeDsts.length; k++) off[this.routeDsts[k]] = 0;
    for (let k = 0; k < this.steps.length; k++) this.steps[k]();
    this.ctx.clock = this.usesMidi(this.scanClk) ? this.midiClock : this.clock;
    this.scan.update(this.ctx, this.srcVals);
    let lr = false;
    for (const f of this.efCh) if (this.eff[f.on] >= 0.5 && this.eff[f.ch] >= 0.5) lr = true;
    this.lrTaps = lr;
  }

  /** the master clock (hardware: internal or MIDI): INT, or MIDI while INT is off */
  get masterClock(): ClockState {
    return this.usesMidi(-1) ? this.midiClock : this.clock;
  }

  /** after the audio pass: analysers + UI readout */
  endBlock(): void {
    for (const s of this.sources.values()) if (s.dsp.analyse && this.eff[s.onIdx] >= 0.5) s.dsp.analyse(this.ctx);
    if (++this.readoutCount >= this.readoutEvery) {
      this.readoutCount = 0;
      const mod = new Float32Array(this.routeDsts.length * 2);
      this.routeDsts.forEach((i, k) => {
        mod[2 * k] = i;
        mod[2 * k + 1] = toNorm(PARAMS[i], this.eff[i]);
      });
      const c = this.clock;
      const m = this.midiClock;
      this.post({ type: 'mod', src: this.srcVals.slice(), mod, beats: c.beats, bpm: c.bpm, run: c.running ? 1 : 0, midiBeats: m.beats, midiBpm: m.bpm, midiRun: m.running ? 1 : 0 });
    }
  }

  /** true if any of the params [from, to) is modulated */
  anyModulated(from: number, to: number): boolean {
    for (let i = from; i < to; i++) if (this.modulated[i]) return true;
    return false;
  }

  /** RESET of the internal clock: beat 1, the sources on it start over (the MIDI clock restarts with MIDI Start) */
  resetClock(): void {
    this.clock.beats = this.clock.beatsPrev = 0;
    this.resetSources(false);
  }

  reset(): void {
    for (const s of this.sources.values()) s.dsp.reset();
    this.preFilter.reset();
    this.postFilter.reset();
    this.scan.reset();
    this.trigPending.fill(0);
  }
}

