import { DIVISIONS } from '../../shared/paramdefs/types';
import { paramIndex } from '../../shared/params';
import { TRIGGER_IN_BY_ID, TRIGGER_OUT_BY_ID } from '../../shared/mod/sources';
import type { BlockCtx, SourceDsp } from './types';

/**
 * LFO slot (lfo1..lfo4), evaluated once per block (value = end of the block).
 *
 * Timing: a cycle position `acc` in 0..1. Free: integrated from the rate every block, so rate
 * modulation bends the speed without phase jumps. Sync: derived from the clock,
 * acc = frac((beats - anchor) / division), i.e. phase-locked to the beat grid.
 * `cycle` fires when acc wraps; the `reset` trigger restarts the cycle (sync: re-anchors the grid
 * at the current beat position) and fires `cycle` too. PHASE shifts the waveform inside the cycle,
 * not the cycle trigger.
 *
 * MORPH per shape (0 = the plain shape):
 *   Sine / Triangle  skew: rise takes 50% → 2% of the cycle (fast rise, slow fall)
 *   Saw              saw up (0) → triangle (0.5) → ramp down (1)
 *   Square           pulse width 50% → 2%
 *   S&H / Smooth     hold probability: chance a step keeps the previous value (1 = frozen)
 * Random shapes step once per waveform cycle (where PHASE puts it); values come from a seeded
 * xorshift, reseeded by reset()/clock reset, so a patch replays the same random line.
 *
 * SMOOTH: one-pole slew on the shape, time constant smooth² × 1 s (0.1 → 10 ms, 1 → 1 s).
 * LEVEL scales, UNI maps -1..1 to 0..1 (after the slew).
 */
export class LfoDsp implements SourceDsp {
  private iShape: number; private iRate: number; private iSync: number; private iDiv: number;
  private iPhase: number; private iMorph: number; private iSmooth: number; private iLevel: number; private iUni: number;
  private trigReset: number; private trigCycle: number;
  private readonly seed: number;

  /** cycle position 0..1 and completed cycles since the last restart (free mode) */
  private acc = 0;
  private cycles = 0;
  /** sync mode: beat position where cycle 0 starts */
  private anchor = 0;
  /** index of the current waveform cycle (random shapes step when it changes) */
  private seg = 0;
  /** random shapes: segment start / target value */
  private ra = 0;
  private rb = 0;
  /** last shape value before / after the slew */
  private raw = 0;
  private slewed = 0;
  /** reset() asks the next update to restart (fire `cycle`, draw a new random value) */
  private restart = true;
  private rng: number;

  constructor(readonly n: number) {
    const m = `lfo${n}`;
    this.iShape = paramIndex(`${m}.shape`);
    this.iRate = paramIndex(`${m}.rate`);
    this.iSync = paramIndex(`${m}.sync`);
    this.iDiv = paramIndex(`${m}.div`);
    this.iPhase = paramIndex(`${m}.phase`);
    this.iMorph = paramIndex(`${m}.morph`);
    this.iSmooth = paramIndex(`${m}.smooth`);
    this.iLevel = paramIndex(`${m}.level`);
    this.iUni = paramIndex(`${m}.uni`);
    this.trigReset = TRIGGER_IN_BY_ID[`${m}.reset`].index;
    this.trigCycle = TRIGGER_OUT_BY_ID[`${m}.cycle`].index;
    this.seed = (0x2545f491 ^ Math.imul(n, 0x9e3779b1)) >>> 0 || 1;
    this.rng = this.seed;
  }

  /** xorshift32 → 0..1 */
  private rand01(): number {
    let s = this.rng;
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    this.rng = s;
    return s / 4294967296;
  }

  update(ctx: BlockCtx): number {
    const e = ctx.eff;
    const c = ctx.clock;
    // always consume the trigger, also in sync mode
    const trig = ctx.triggered(this.trigReset);
    const restart = trig || this.restart;
    this.restart = false;
    const offset = e[this.iPhase];
    let wrapped = false;
    let x: number; // unwrapped cycle position (integer part = cycles since restart / anchor)

    if (e[this.iSync] >= 0.5) {
      const div = DIVISIONS[Math.round(e[this.iDiv])]?.beats ?? 1;
      if (trig) this.anchor = c.beatsPrev; // the cycle restarts where this block began
      const x0 = (c.beatsPrev - this.anchor) / div;
      x = (c.beats - this.anchor) / div;
      wrapped = Math.floor(x) > Math.floor(x0);
      this.acc = x - Math.floor(x);
      this.cycles = Math.floor(x);
    } else {
      if (restart) {
        this.acc = 0;
        this.cycles = 0;
      }
      let a = this.acc + ctx.dt * e[this.iRate];
      if (a >= 1) {
        const w = Math.floor(a);
        a -= w;
        this.cycles += w;
        wrapped = true;
      }
      this.acc = a;
      x = this.cycles + a;
    }
    if (wrapped || restart) ctx.fire(this.trigCycle);

    // waveform phase (PHASE shifts the shape) and the waveform cycle it belongs to
    const xs = x + offset;
    const seg = Math.floor(xs);
    const p = xs - seg;
    const morph = e[this.iMorph];
    const shape = Math.round(e[this.iShape]);
    if (restart || seg !== this.seg) {
      this.seg = seg;
      // Smooth glides on from where it is after a restart; S&H jumps
      this.ra = restart ? this.raw : this.rb;
      if (this.rand01() >= morph) this.rb = this.rand01() * 2 - 1;
    }

    let v: number;
    switch (shape) {
      case 0: // sine
      case 1: { // triangle; both skewed by morph, q = 0 at the trough
        const r = 0.5 - 0.48 * morph;
        let q = p + 0.25;
        if (q >= 1) q -= 1;
        if (q < r) {
          const u = q / r;
          v = shape === 0 ? -Math.cos(Math.PI * u) : 2 * u - 1;
        } else {
          const u = (q - r) / (1 - r);
          v = shape === 0 ? Math.cos(Math.PI * u) : 1 - 2 * u;
        }
        break;
      }
      case 2: { // saw up → triangle → ramp down
        const r = 1 - morph;
        v = p < r ? 2 * p / r - 1 : 1 - (2 * (p - r)) / (1 - r);
        break;
      }
      case 3:
        v = p < 0.5 - 0.48 * morph ? 1 : -1;
        break;
      case 4:
        v = this.rb;
        break;
      default: // smooth random: cosine glide from ra to rb over the waveform cycle
        v = this.ra + (this.rb - this.ra) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    }
    if (!(v >= -1 && v <= 1)) v = v > 1 ? 1 : v < -1 ? -1 : 0; // also catches NaN
    this.raw = v;

    const sm = e[this.iSmooth];
    if (sm > 0) {
      const tau = sm * sm;
      this.slewed += (v - this.slewed) * (1 - Math.exp(-ctx.dt / tau));
      v = this.slewed;
    } else {
      this.slewed = v;
    }
    if (e[this.iUni] >= 0.5) v = 0.5 + 0.5 * v;
    return v * e[this.iLevel];
  }

  reset(): void {
    // panic / clock reset: back to cycle 0 on the clock grid, replay the random line
    this.acc = 0;
    this.cycles = 0;
    this.anchor = 0;
    this.rng = this.seed;
    this.restart = true;
  }
}
