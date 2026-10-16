/**
 * Footswitch stand-in (docs/hardware-modi-und-pools-2026-10-16.md, point 11A): the FOOT button on
 * screen, a key (Space unless chosen otherwise) and a learned MIDI note or CC (MIDI trigger 'foot')
 * press one switch. Like the hardware it has an action for a short press and one for holding it.
 * Without a hold action the short one fires on the press itself (no wait, so TAP and STEP sit on
 * the beat); with one it fires on a release before HOLD_MS. Remembered in the browser
 * (`localStorage` `resonator.foot`). Pure (no DOM).
 */
import { Emitter } from '../core/Emitter';
import type { StorageLike } from '../core/inputs';
import type { Unsubscribe } from '../core/types';

const STORE_KEY = 'resonator.foot';
export const HOLD_MS = 500;

export const FOOT_ACTIONS = ['none', 'bypass', 'panic', 'next', 'prev', 'startStop', 'step', 'stepMorph', 'tap'] as const;
export type FootAction = (typeof FOOT_ACTIONS)[number];
export const FOOT_ACTION_LABELS: Record<FootAction, string> = {
  none: 'Nothing',
  bypass: 'Bypass',
  panic: 'Panic',
  next: 'Next preset',
  prev: 'Previous preset',
  startStop: 'Pool START / STOP',
  step: 'Pool STEP',
  stepMorph: 'Pool STEP+MORPH',
  tap: 'TAP tempo',
};

export interface FootSettings {
  short: FootAction;
  hold: FootAction;
  /** KeyboardEvent.code of the key ('' = no key) */
  key: string;
}

export const DEFAULT_FOOT: FootSettings = { short: 'step', hold: 'bypass', key: 'Space' };

/** readable name of a key code ('Space', 'F', '5', 'F2') */
export function keyName(code: string): string {
  if (!code) return 'none';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

export class FootSwitch {
  private st: FootSettings;
  /** what holds it down now ('button', 'key', 'midi'), and since when */
  private down: { by: string; t: number } | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private held = false;
  private changeE = new Emitter<[]>();
  private fireE = new Emitter<[FootAction, boolean]>();

  /**
   * @param run carries out an action; `t` is the time of the press (ms, the caller's clock), for TAP
   */
  constructor(
    private run: (a: FootAction, t: number) => void,
    private storage?: StorageLike,
  ) {
    this.st = { ...DEFAULT_FOOT };
    try {
      const s = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null') as Partial<FootSettings> | null;
      if (s && typeof s === 'object') {
        if (FOOT_ACTIONS.includes(s.short as FootAction)) this.st.short = s.short as FootAction;
        if (FOOT_ACTIONS.includes(s.hold as FootAction)) this.st.hold = s.hold as FootAction;
        if (typeof s.key === 'string' && s.key.length <= 32) this.st.key = s.key;
      }
    } catch {
      /* storage unavailable or broken: defaults */
    }
  }

  get settings(): Readonly<FootSettings> {
    return this.st;
  }
  /** pressed now */
  get pressed(): boolean {
    return this.down !== null;
  }

  onChange(cb: () => void): Unsubscribe {
    return this.changeE.on(cb);
  }
  /** an action fired (hold = true for the hold action) */
  onFire(cb: (a: FootAction, hold: boolean) => void): Unsubscribe {
    return this.fireE.on(cb);
  }

  set(patch: Partial<FootSettings>): void {
    const next = { ...this.st, ...patch };
    if (!FOOT_ACTIONS.includes(next.short) || !FOOT_ACTIONS.includes(next.hold)) return;
    if (next.short === this.st.short && next.hold === this.st.hold && next.key === this.st.key) return;
    this.st = next;
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify(this.st));
    } catch {
      /* not persisted */
    }
    this.changeE.emit();
  }

  private fire(a: FootAction, hold: boolean, t: number): void {
    if (a === 'none') return;
    this.fireE.emit(a, hold);
    this.run(a, t);
  }

  /** pressed by `by` at time t (ms); a second source while it is down is ignored */
  press(by: string, t: number): void {
    if (this.down) return;
    this.down = { by, t };
    this.held = false;
    if (this.st.hold === 'none') this.fire(this.st.short, false, t);
    else
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (!this.down) return;
        this.held = true;
        this.fire(this.st.hold, true, this.down.t);
      }, HOLD_MS);
    this.changeE.emit();
  }

  /** released by `by` */
  release(by: string): void {
    const d = this.down;
    if (!d || d.by !== by) return;
    this.down = null;
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    if (this.st.hold !== 'none' && !this.held) this.fire(this.st.short, false, d.t);
    this.changeE.emit();
  }
}
