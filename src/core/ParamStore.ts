import { PARAMS, PARAM_BY_ID, NUM_PARAMS, fromNorm, toNorm, type ParamSpec } from '../shared/params';
import { Emitter } from './Emitter';
import type { ParamStoreAPI, Unsubscribe } from './types';

/**
 * Holds the *base* value of every parameter (what the user set).
 * Modulation never writes here: it runs in the worklet, and its effective values
 * come back as readouts (`applyReadout`) for the UI's modulation rings.
 */
export class ParamStore implements ParamStoreAPI {
  readonly specs = PARAMS;
  private base = new Float32Array(NUM_PARAMS);
  /** effective normalized value per modulated param (from the worklet readout), NaN = none yet */
  private effNorm = new Float32Array(NUM_PARAMS).fill(NaN);
  private modulated = new Uint8Array(NUM_PARAMS);
  private perParam = new Map<string, Emitter<[number]>>();
  private any = new Emitter<[string, number]>();
  private gestures = new Emitter<[string, 'begin' | 'end']>();
  /** bumped on every base change so the control loop knows to resend */
  version = 0;

  constructor() {
    for (const p of PARAMS) this.base[p.index] = p.def;
  }

  spec(id: string): ParamSpec {
    const s = PARAM_BY_ID[id];
    if (!s) throw new Error(`unknown param ${id}`);
    return s;
  }
  get(id: string): number {
    return this.base[this.spec(id).index];
  }
  getNorm(id: string): number {
    const s = this.spec(id);
    return toNorm(s, this.base[s.index]);
  }
  set(id: string, plain: number): void {
    const s = this.spec(id);
    const v =
      s.curve === 'toggle' ? (plain >= 0.5 ? 1 : 0)
      : s.curve === 'discrete' ? Math.min(s.max, Math.max(s.min, Math.round(plain)))
      : Math.min(s.max, Math.max(s.min, plain));
    if (this.base[s.index] === v) return;
    this.base[s.index] = v;
    this.version++;
    this.perParam.get(id)?.emit(this.base[s.index]);
    this.any.emit(id, this.base[s.index]);
  }
  setNorm(id: string, norm: number): void {
    this.set(id, fromNorm(this.spec(id), norm));
  }
  reset(id: string): void {
    this.set(id, this.spec(id).def);
  }
  getEffectiveNorm(id: string): number {
    const s = this.spec(id);
    const e = this.effNorm[s.index];
    return this.modulated[s.index] && e === e ? e : toNorm(s, this.base[s.index]);
  }
  isModulated(id: string): boolean {
    return this.modulated[this.spec(id).index] === 1;
  }
  subscribe(id: string, cb: (plain: number) => void): Unsubscribe {
    let e = this.perParam.get(id);
    if (!e) this.perParam.set(id, (e = new Emitter()));
    return e.on(cb);
  }
  subscribeAll(cb: (id: string, plain: number) => void): Unsubscribe {
    return this.any.on(cb);
  }
  beginGesture(id: string): void {
    this.gestures.emit(id, 'begin');
  }
  endGesture(id: string): void {
    this.gestures.emit(id, 'end');
  }
  /** for undo / automation recording later */
  onGesture(cb: (id: string, phase: 'begin' | 'end') => void): Unsubscribe {
    return this.gestures.on(cb);
  }

  /* ---- used by the modulation controller ---- */

  /** which params have a modulation route (immediately, before the first readout) */
  setModulated(mask: Uint8Array): void {
    this.modulated.set(mask);
    for (let i = 0; i < NUM_PARAMS; i++) if (!mask[i]) this.effNorm[i] = NaN;
  }

  /** pairs [index, effective norm] from the worklet readout */
  applyReadout(pairs: Float32Array): void {
    for (let k = 0; k + 1 < pairs.length; k += 2) this.effNorm[pairs[k]] = pairs[k + 1];
  }

  /** base plain values of every param, ordered by index (sent to the worklet) */
  baseValues(): Float32Array {
    return this.base.slice();
  }

  getState(): Record<string, number> {
    const s: Record<string, number> = {};
    for (const p of PARAMS) s[p.id] = this.base[p.index];
    return s;
  }
  setState(s: Record<string, number>): void {
    for (const [id, v] of Object.entries(s)) if (PARAM_BY_ID[id] && Number.isFinite(v)) this.set(id, v);
  }
}
