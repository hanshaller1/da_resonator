/**
 * Settings of the FB function keys (CONFIG → GENERAL, own card under Resonance): how far WOB swings a band and
 * the range DICE draws band levels from. Remembered in the browser (`localStorage`
 * `resonator.fbkeys`), for all presets, like the footswitch.
 */
import { Emitter } from '../core/Emitter';
import { pageStorage, type StorageLike } from '../core/inputs';
import type { Unsubscribe } from '../core/types';
import { FADER_MAX_DB, FADER_MIN_DB } from '../shared/params';
import { DICE_MAX_DB, DICE_MIN_DB } from './channel';

const STORE_KEY = 'resonator.fbkeys';

/** WOB depth in % of fader travel (each way) */
export const WOBBLE_MIN = 1;
export const WOBBLE_MAX = 50;

export interface FbKeySettings {
  /** WOB: ± % of fader travel */
  wobble: number;
  /** DICE: lowest and highest level (dB); low stays at least 1 dB under high */
  diceMin: number;
  diceMax: number;
}

export const DEFAULT_FB_KEYS: FbKeySettings = { wobble: 10, diceMin: DICE_MIN_DB, diceMax: DICE_MAX_DB };

const whole = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;

export class FbKeys {
  private st: FbKeySettings = { ...DEFAULT_FB_KEYS };
  private changeE = new Emitter<[]>();

  constructor(private storage?: StorageLike) {
    try {
      const s = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null') as Partial<FbKeySettings> | null;
      if (s && typeof s === 'object') this.apply(s);
    } catch {
      /* storage unavailable or broken: defaults */
    }
  }

  get settings(): Readonly<FbKeySettings> {
    return this.st;
  }

  onChange(cb: () => void): Unsubscribe {
    return this.changeE.on(cb);
  }

  /** invalid values are ignored; DICE low and high push each other so low < high */
  set(patch: Partial<FbKeySettings>): void {
    const before = JSON.stringify(this.st);
    this.apply(patch);
    if (JSON.stringify(this.st) === before) return;
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify(this.st));
    } catch {
      /* not persisted */
    }
    this.changeE.emit();
  }

  private apply(s: Partial<FbKeySettings>): void {
    const w = whole(s.wobble, WOBBLE_MIN, WOBBLE_MAX);
    if (w !== null) this.st.wobble = w;
    const lo = whole(s.diceMin, FADER_MIN_DB, FADER_MAX_DB - 1);
    if (lo !== null) {
      this.st.diceMin = lo;
      if (this.st.diceMax <= lo) this.st.diceMax = lo + 1;
    }
    const hi = whole(s.diceMax, FADER_MIN_DB + 1, FADER_MAX_DB);
    if (hi !== null) {
      this.st.diceMax = hi;
      if (this.st.diceMin >= hi) this.st.diceMin = hi - 1;
    }
  }
}

let shared: FbKeys | null = null;
/** the app's instance (created on first use) */
export function fbKeys(): FbKeys {
  return (shared ??= new FbKeys(pageStorage()));
}
