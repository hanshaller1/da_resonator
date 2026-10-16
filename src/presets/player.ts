/**
 * Plays the selected pool (docs/hardware-modi-und-pools-2026-10-16.md, points 9A and 12A):
 * START / STOP, STEP and STEP+MORPH, RESET to the first entry, the direction (Up, Down, Ping-Pong,
 * Random), and advancing by the pool's clock every N bars or by a learned MIDI note / CC while it
 * runs. While a pool runs, Program Change n jumps to its entry n. Entries whose preset was deleted
 * are skipped. Pure (no DOM): the clock comes from the host, the offline tests drive it.
 */
import { Emitter } from '../core/Emitter';
import type { Unsubscribe } from '../core/types';
import type { Preset } from './io';
import type { Pool, PoolEntry, PoolStore } from './pools';

export interface ClockReading {
  /** position in beats */
  beats: number;
  /** tempo, 0 = unknown */
  bpm: number;
  running: boolean;
  /** the clock moves at all (on, audio running) */
  live: boolean;
}

export interface PlayerHost {
  session: { load(p: Preset): void; morphTo(p: Preset, ms: number): void };
  presets: { get(id: string): Preset | undefined };
  /** the clock a pool chose (the host lets the other one stand in while it is off) */
  clock(choice: 'int' | 'midi'): ClockReading;
  random?: () => number;
}

/** tempo for a morph time in beats while the clock's tempo is unknown */
const FALLBACK_BPM = 120;

export type JumpResult = 'jumped' | 'missing' | 'not-running';

export class PoolPlayer {
  /** the pool advances by its clock or MIDI, and Program Change jumps in it */
  running = false;
  /** index of the current entry in the selected pool, -1 = none yet */
  pos = -1;
  /** the current entry (follows it when the list is reordered) */
  private cur: PoolEntry | null = null;
  private ppDir: 1 | -1 = 1;
  private lastBar: number | null = null;
  private poolId: string;
  private changeE = new Emitter<[]>();
  private random: () => number;

  constructor(
    readonly pools: PoolStore,
    private host: PlayerHost,
  ) {
    this.poolId = pools.selected.id;
    this.random = host.random ?? Math.random;
    pools.onChange(() => this.follow());
  }

  onChange(cb: () => void): Unsubscribe {
    return this.changeE.on(cb);
  }
  private emit(): void {
    this.changeE.emit();
  }

  get pool(): Pool {
    return this.pools.selected;
  }

  /** another pool selected: stop and start over; entries moved or removed: keep the current one */
  private follow(): void {
    const p = this.pool;
    if (p.id !== this.poolId) {
      this.poolId = p.id;
      this.running = false;
      this.pos = -1;
      this.cur = null;
      this.lastBar = null;
      this.emit();
      return;
    }
    if (this.cur) {
      const i = p.entries.indexOf(this.cur);
      if (i >= 0) this.pos = i;
      else {
        // removed: the next step lands on what followed it
        this.cur = null;
        this.pos = Math.min(this.pos, p.entries.length) - 1;
      }
    } else if (this.pos >= p.entries.length) this.pos = p.entries.length - 1;
    this.emit();
  }

  /** the preset of entry i, if it still exists */
  presetAt(i: number): Preset | undefined {
    const e = this.pool.entries[i];
    return e ? this.host.presets.get(e.id) : undefined;
  }

  private playable(): number[] {
    const out: number[] = [];
    this.pool.entries.forEach((_, i) => {
      if (this.presetAt(i)) out.push(i);
    });
    return out;
  }

  /** where the pool starts: the first entry, the last one for Down */
  private firstIndex(ok: number[]): number {
    if (!ok.length) return -1;
    return this.pool.dir === 'down' ? ok[ok.length - 1] : ok[0];
  }

  private nextIndex(ok: number[]): number {
    if (!ok.length) return -1;
    const pos = this.pos;
    switch (this.pool.dir) {
      case 'down': {
        for (let k = ok.length - 1; k >= 0; k--) if (ok[k] < pos) return ok[k];
        return ok[ok.length - 1];
      }
      case 'pingpong': {
        if (ok.length === 1) return ok[0];
        if (pos < 0) return ok[0];
        const ahead = this.ppDir > 0 ? ok.filter((i) => i > pos) : ok.filter((i) => i < pos).reverse();
        if (ahead.length) return ahead[0];
        this.ppDir = this.ppDir > 0 ? -1 : 1;
        const back = this.ppDir > 0 ? ok.filter((i) => i > pos) : ok.filter((i) => i < pos).reverse();
        return back[0] ?? ok[0];
      }
      case 'random': {
        const others = ok.filter((i) => i !== pos);
        if (!others.length) return ok[0];
        return others[Math.min(others.length - 1, Math.floor(this.random() * others.length))];
      }
      default: {
        for (const i of ok) if (i > pos) return i;
        return ok[0];
      }
    }
  }

  /** morph time of the pool in ms (beats at the tempo of its clock) */
  morphMs(): number {
    const p = this.pool;
    if (p.morphUnit === 'ms') return p.morph;
    const bpm = this.host.clock(p.clock).bpm;
    return (p.morph * 60000) / (bpm > 0 ? bpm : FALLBACK_BPM);
  }

  /** load entry i (morphing or not); the preset, or undefined if it is gone */
  private go(i: number, morph: boolean): Preset | undefined {
    const preset = this.presetAt(i);
    if (!preset) return undefined;
    this.pos = i;
    this.cur = this.pool.entries[i];
    const ms = morph ? this.morphMs() : 0;
    if (ms > 0) this.host.session.morphTo(preset, ms);
    else this.host.session.load(preset);
    this.emit();
    return preset;
  }

  /** START: the pool runs from its current entry (the first one if none yet), which is loaded */
  start(): Preset | undefined {
    const ok = this.playable();
    if (!ok.length) return undefined;
    this.running = true;
    this.lastBar = null;
    if (this.pos < 0 || !this.presetAt(this.pos)) {
      this.ppDir = 1;
      return this.go(this.firstIndex(ok), false);
    }
    return this.go(this.pos, false);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.lastBar = null;
    this.emit();
  }

  toggle(): Preset | undefined {
    if (this.running) {
      this.stop();
      return undefined;
    }
    return this.start();
  }

  /** RESET: back to the first entry (loaded), the clock count starts over */
  reset(): Preset | undefined {
    this.ppDir = 1;
    this.lastBar = null;
    return this.go(this.firstIndex(this.playable()), false);
  }

  /** STEP (morph: STEP+MORPH): the next entry in the pool's direction */
  step(morph = false): Preset | undefined {
    return this.go(this.nextIndex(this.playable()), morph);
  }

  /** entry i directly (a click in the list) */
  play(i: number, morph = false): Preset | undefined {
    return this.go(i, morph);
  }

  /** Program Change n while the pool runs: entry n (0-based), morphing when the pool morphs on advance */
  jump(n: number): JumpResult {
    if (!this.running) return 'not-running';
    return this.go(n, this.pool.autoMorph) ? 'jumped' : 'missing';
  }

  /** the learned MIDI note / CC: the next entry, while the pool runs and advances by MIDI */
  midiAdvance(): Preset | undefined {
    if (!this.running || this.pool.advance !== 'midi') return undefined;
    return this.step(this.pool.autoMorph);
  }

  /** call often (every modulation readout): advances every N bars of the pool's clock while it runs */
  tick(): void {
    const p = this.pool;
    if (!this.running || p.advance !== 'clock') {
      this.lastBar = null;
      return;
    }
    const c = this.host.clock(p.clock);
    if (!c.live) {
      this.lastBar = null;
      return;
    }
    const bar = Math.floor(c.beats / (4 * p.bars) + 1e-9);
    // first reading, a restarted clock (MIDI Start, RESET) or a stopped one: only take the position
    if (this.lastBar === null || bar < this.lastBar || !c.running) {
      this.lastBar = bar;
      return;
    }
    if (bar > this.lastBar) {
      this.lastBar = bar;
      this.step(p.autoMorph);
    }
  }
}
