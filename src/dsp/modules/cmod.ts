import { DIVISIONS } from '../../shared/paramdefs/types';
import { CMOD_STEPS } from '../../shared/paramdefs/modules';
import { paramIndex } from '../../shared/params';
import { TRIGGER_IN_BY_ID, TRIGGER_OUT_BY_ID } from '../../shared/mod/sources';
import type { BlockCtx, SourceDsp } from './types';

/* CMOD_MODES order (shared/paramdefs/modules.ts); 0 = Divider */
const MODE_STEPS = 1;
const MODE_EUCLID = 2;
const MODE_RANDOM = 3;
const MAX_SWING = 0.75;
/** safety cap for steps fired in one block (normally at most 1: the shortest step is > 2 blocks) */
const MAX_STEPS_PER_BLOCK = 64;

/**
 * Euclidean rhythm E(pulses, steps) as a bit mask (bit i = step i is a pulse).
 * Bjorklund / Toussaint grouping: pair the pulse groups with the remainder groups until at most
 * one remainder group is left. Starts with a pulse: E(3,8) = x..x..x., E(5,16) = x..x..x..x..x....
 */
export function euclidMask(steps: number, pulses: number): number {
  steps = Math.max(1, Math.min(32, Math.round(steps)));
  pulses = Math.max(0, Math.min(steps, Math.round(pulses)));
  if (pulses === 0) return 0;
  if (pulses === steps) return steps === 32 ? -1 : (1 << steps) - 1;
  let a: number[][] = [];
  let b: number[][] = [];
  for (let i = 0; i < pulses; i++) a.push([1]);
  for (let i = 0; i < steps - pulses; i++) b.push([0]);
  while (b.length > 1) {
    const n = Math.min(a.length, b.length);
    const paired: number[][] = [];
    for (let i = 0; i < n; i++) paired.push(a[i].concat(b[i]));
    const rest = a.length > n ? a.slice(n) : b.slice(n);
    a = paired;
    b = rest;
  }
  let mask = 0;
  let i = 0;
  for (const g of a.concat(b)) for (const bit of g) mask |= bit << i++;
  return mask;
}

/** precomputed masks, index steps * 17 + pulses (steps 1..16, pulses 0..16) */
const EUCLID = new Int32Array((CMOD_STEPS + 1) * (CMOD_STEPS + 1));
for (let s = 1; s <= CMOD_STEPS; s++) for (let p = 0; p <= CMOD_STEPS; p++) EUCLID[s * (CMOD_STEPS + 1) + p] = euclidMask(s, p);

/** is pattern position `pos` (0..steps-1) a pulse? `rotate` shifts the pattern later by that many steps */
export function euclidHit(steps: number, pulses: number, rotate: number, pos: number): boolean {
  const s = Math.max(1, Math.min(CMOD_STEPS, steps));
  const p = Math.max(0, Math.min(s, pulses));
  const i = (((pos - rotate) % s) + s) % s;
  return ((EUCLID[s * (CMOD_STEPS + 1) + p] >> i) & 1) === 1;
}

/**
 * Index of the step that is current at grid position x (in steps since the origin). Swing delays
 * every odd step by swing/2 of a step, so an odd step starts at k + swing/2.
 */
export function swungStep(x: number, swing: number): number {
  const k = Math.floor(x);
  return (k & 1) !== 0 && x - k < swing * 0.5 ? k - 1 : k;
}

/** start of step k in grid units (see swungStep) */
export function swungStart(k: number, swing: number): number {
  return (k & 1) !== 0 ? k + swing * 0.5 : k;
}

/**
 * Clock mod slot (cmod1..cmod2). Steps advance on the clock grid (division `div`, block-granular,
 * derived from the clock's beat position so it never drifts). Modes: Divider (gate, high for the
 * first half of each step), Steps (16-step sequencer), Euclid (gate pattern E(steps, pulses)),
 * Random (sample & hold). Fires `cmodN.step` on every step that fires; `cmodN.reset` restarts the
 * grid at step 1 from the current position.
 */
export class ClockModDsp implements SourceDsp {
  private iMode: number; private iDiv: number; private iSteps: number; private iPulses: number;
  private iRotate: number; private iProb: number; private iSwing: number; private iSlew: number;
  private iLevel: number; private iUni: number;
  private iStep = new Int32Array(CMOD_STEPS);
  private trigReset: number; private trigStep: number;
  /** beat position where step 0 starts (moved by the reset trigger) */
  private origin = 0;
  /** clock position after the last update: a mismatch means skipped blocks (module was off) or a clock reset */
  private lastBeats = NaN;
  /** grid index of the last step that fired (gate modes are high only during that step) */
  private firedK = NaN;
  /** sequencer position whose value is output (Steps mode) */
  private heldPos = 0;
  /** sample & hold value 0..1 (Random mode) */
  private held = 0.5;
  /** slewed output 0..1 */
  private out = 0;
  private rng: number;

  constructor(readonly n: number) {
    const m = `cmod${n}`;
    this.iMode = paramIndex(`${m}.mode`);
    this.iDiv = paramIndex(`${m}.div`);
    this.iSteps = paramIndex(`${m}.steps`);
    this.iPulses = paramIndex(`${m}.pulses`);
    this.iRotate = paramIndex(`${m}.rotate`);
    this.iProb = paramIndex(`${m}.prob`);
    this.iSwing = paramIndex(`${m}.swing`);
    this.iSlew = paramIndex(`${m}.slew`);
    this.iLevel = paramIndex(`${m}.level`);
    this.iUni = paramIndex(`${m}.uni`);
    for (let s = 0; s < CMOD_STEPS; s++) this.iStep[s] = paramIndex(`${m}.step${s}`);
    this.trigReset = TRIGGER_IN_BY_ID[`${m}.reset`].index;
    this.trigStep = TRIGGER_OUT_BY_ID[`${m}.step`].index;
    this.rng = (0x6d2b79f5 ^ Math.imul(n, 0x9e3779b1)) >>> 0 || 1;
  }

  /** xorshift32 → [0, 1) */
  private rand(): number {
    let s = this.rng;
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    this.rng = s;
    return s / 4294967296;
  }

  update(ctx: BlockCtx): number {
    const e = ctx.eff;
    const c = ctx.clock;
    const divIdx = Math.max(0, Math.min(DIVISIONS.length - 1, Math.round(e[this.iDiv])));
    const D = DIVISIONS[divIdx].beats;
    const sw = Math.max(0, Math.min(MAX_SWING, e[this.iSwing]));
    const mode = Math.round(e[this.iMode]);

    let restart = false;
    if (ctx.triggered(this.trigReset)) {
      this.origin = c.beatsPrev;
      this.firedK = NaN;
      restart = true;
    } else if (c.beatsPrev !== this.lastBeats) {
      restart = true; // first block, back from off, clock reset: the current step fires now
    }
    this.lastBeats = c.beats;

    const x1 = (c.beats - this.origin) / D;
    const k1 = swungStep(x1, sw);
    let from = restart ? k1 : swungStep((c.beatsPrev - this.origin) / D, sw) + 1;
    if (k1 - from >= MAX_STEPS_PER_BLOCK) from = k1 - MAX_STEPS_PER_BLOCK + 1;
    for (let k = from; k <= k1; k++) this.step(k, mode, ctx);

    let target: number;
    if (mode === MODE_STEPS) target = e[this.iStep[this.heldPos]];
    else if (mode === MODE_RANDOM) target = this.held;
    else if (this.firedK !== k1) target = 0;
    else {
      // gate: high for the first half of the (swung) step
      const t0 = swungStart(k1, sw);
      target = x1 < 0.5 * (t0 + swungStart(k1 + 1, sw)) ? 1 : 0;
    }

    const slew = e[this.iSlew];
    if (slew <= 0) this.out = target;
    else {
      // one-pole glide; slew 1 ≈ one step long (τ = step / 4 → 98 % after one step)
      const tau = (slew * D * 60) / Math.max(1, c.bpm) / 4;
      this.out += (target - this.out) * (1 - Math.exp(-ctx.dt / tau));
      if (Math.abs(target - this.out) < 1e-6) this.out = target;
    }
    const v = e[this.iUni] >= 0.5 ? this.out : 2 * this.out - 1;
    return v * e[this.iLevel];
  }

  /** grid step k starts in this block: fire it unless it is a Euclid rest or loses the probability draw */
  private step(k: number, mode: number, ctx: BlockCtx): void {
    const e = ctx.eff;
    const steps = Math.max(1, Math.min(CMOD_STEPS, Math.round(e[this.iSteps]) + 1));
    const pos = ((k % steps) + steps) % steps;
    if (mode === MODE_EUCLID && !euclidHit(steps, Math.round(e[this.iPulses]), Math.round(e[this.iRotate]), pos)) return;
    const prob = e[this.iProb];
    if (prob < 1 && !(prob > 0 && this.rand() < prob)) return;
    this.firedK = k;
    if (mode === MODE_STEPS) this.heldPos = pos;
    else if (mode === MODE_RANDOM) this.held = this.rand();
    ctx.fire(this.trigStep);
  }

  reset(): void {
    this.origin = 0;
    this.lastBeats = NaN;
    this.firedK = NaN;
  }
}
