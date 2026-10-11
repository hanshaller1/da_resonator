import { NUM_TAPS } from '../../shared/paramdefs/modules';
import { paramIndex } from '../../shared/params';
import { TRIGGER_OUT_BY_ID } from '../../shared/mod/sources';
import type { BlockCtx, SourceDsp } from './types';

/** gate re-arms once the envelope fell this far below the threshold */
const GATE_HYST_DB = 3;
const GATE_HYST = Math.pow(10, -GATE_HYST_DB / 20);
/** detector floor (≈ −140 dBFS): keeps log10 finite and denormals out of the one-pole */
const ENV_FLOOR = 1e-7;
/** curve −1..1 → exponent of the shaping function (±6: clearly log / exp, still smooth) */
const CURVE_K = 6;

/**
 * Envelope follower slot (ef1..ef4).
 *
 * analyse() (after the audio pass) runs a peak detector over the selected tap: |x| × gain, then a
 * one-pole with separate attack / release on the *linear* envelope. Times are one-pole time
 * constants (63 % / 1/e convention): after a step up the envelope reaches 63 % of the new level
 * after `attack` ms; after a step down it falls to 37 % (−8.7 dB) of its level after `release` ms.
 * update() maps the latest envelope (so the value is one block late, by design: the follower may
 * then sit behind whatever it modulates without a cycle in the graph):
 *   dB in threshold..0 dBFS → 0..1 (clamped), bent by `curve` (−1 log-like, 0 linear, +1 exp-like),
 *   × `level`.
 * Trigger out `efN.gate` fires when the envelope rises above the threshold; it re-arms after the
 * envelope fell 3 dB below it (hysteresis, so a level hovering at the threshold fires once).
 */
export class EnvFollowerDsp implements SourceDsp {
  private iTap: number; private iAtk: number; private iRel: number; private iGain: number;
  private iThr: number; private iCurve: number; private iLevel: number;
  private trigGate: number;
  private env = 0;
  private armed = true;
  // cached coefficients (recomputed only when the time / gain params move)
  private atkMs = -1; private relMs = -1; private gainDb = NaN; private fs = 0;
  private atkC = 0; private relC = 0; private gain = 1;

  constructor(readonly n: number) {
    const m = `ef${n}`;
    this.iTap = paramIndex(`${m}.tap`);
    this.iAtk = paramIndex(`${m}.attack`);
    this.iRel = paramIndex(`${m}.release`);
    this.iGain = paramIndex(`${m}.gain`);
    this.iThr = paramIndex(`${m}.threshold`);
    this.iCurve = paramIndex(`${m}.curve`);
    this.iLevel = paramIndex(`${m}.level`);
    this.trigGate = TRIGGER_OUT_BY_ID[`${m}.gate`].index;
  }

  /** current detector envelope (linear, after gain); for tests and meters */
  get envelope(): number {
    return this.env;
  }

  private coefs(ctx: BlockCtx): void {
    const e = ctx.eff;
    const atk = e[this.iAtk], rel = e[this.iRel], g = e[this.iGain];
    if (atk !== this.atkMs || ctx.fs !== this.fs) {
      this.atkMs = atk;
      // 1 − exp(−1/(τ·fs)): fraction of the remaining distance covered per sample
      this.atkC = 1 - Math.exp(-1000 / (Math.max(0.01, atk) * ctx.fs));
    }
    if (rel !== this.relMs || ctx.fs !== this.fs) {
      this.relMs = rel;
      this.relC = 1 - Math.exp(-1000 / (Math.max(0.01, rel) * ctx.fs));
    }
    if (g !== this.gainDb) {
      this.gainDb = g;
      this.gain = Math.pow(10, g / 20);
    }
    this.fs = ctx.fs;
  }

  analyse(ctx: BlockCtx): void {
    this.coefs(ctx);
    let tap = Math.round(ctx.eff[this.iTap]);
    if (!(tap >= 0)) tap = 0;
    else if (tap >= NUM_TAPS) tap = NUM_TAPS - 1;
    const buf = ctx.taps[tap];
    const n = ctx.n;
    const g = this.gain, atkC = this.atkC, relC = this.relC;
    const thrLin = Math.pow(10, ctx.eff[this.iThr] / 20);
    const rearm = thrLin * GATE_HYST;
    let env = this.env;
    let armed = this.armed;
    let fire = false;
    for (let i = 0; i < n; i++) {
      let x = buf[i] * g;
      if (x < 0) x = -x;
      env += (x - env) * (x > env ? atkC : relC);
      if (armed) {
        if (env > thrLin) {
          armed = false;
          fire = true;
        }
      } else if (env < rearm) armed = true;
    }
    // NaN / Inf from a broken tap must not stick in the state
    if (!(env < 1e6)) env = 0;
    else if (env < ENV_FLOOR) env = ENV_FLOOR;
    this.env = env;
    this.armed = armed;
    if (fire) ctx.fire(this.trigGate);
  }

  update(ctx: BlockCtx): number {
    const e = ctx.eff;
    const thr = e[this.iThr];
    const db = 20 * Math.log10(this.env > ENV_FLOOR ? this.env : ENV_FLOOR);
    // threshold..0 dBFS → 0..1 (a threshold at 0 dBFS degenerates to a switch at 0 dBFS)
    let u = thr < -1e-3 ? (db - thr) / -thr : db >= 0 ? 1 : 0;
    if (!(u > 0)) return 0;
    if (u > 1) u = 1;
    const k = e[this.iCurve] * CURVE_K;
    // (e^{ku} − 1)/(e^k − 1): k > 0 bends towards exp (slow start), k < 0 towards log (fast start)
    if (k > 1e-4 || k < -1e-4) u = (Math.exp(k * u) - 1) / (Math.exp(k) - 1);
    return u * e[this.iLevel];
  }

  reset(): void {
    this.env = 0;
    this.armed = true;
  }
}
