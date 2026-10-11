import { FADER_MAX_DB, FADER_MIN_DB } from '../../shared/params';
import { h } from '../dom';

/**
 * Law of the IN / OUT meters: −∞ … −24 … 0 … +12 dB at 0 / .25 / .75 / 1, so most of the height
 * is where signal levels live. Band meters use the fader law instead (see MeterOptions.law).
 */
export function meterDbNorm(db: number): number {
  if (db <= FADER_MIN_DB) return 0;
  if (db < -24) return ((db - FADER_MIN_DB) / (-24 - FADER_MIN_DB)) * 0.25;
  if (db < 0) return 0.25 + ((db + 24) / 24) * 0.5;
  return Math.min(1, 0.75 + (db / FADER_MAX_DB) * 0.25);
}

/** level (linear) → meter position on the IN / OUT law */
export function meterNorm(lin: number): number {
  return lin > 0 ? meterDbNorm(20 * Math.log10(lin)) : 0;
}

export interface MeterOptions {
  /** release speed in norm units per second */
  release?: number;
  /** peak hold time (ms) */
  hold?: number;
  /** dB → position (default: the IN / OUT law); a meter beside a fader uses the fader law so it lines up with its scale */
  law?: (db: number) => number;
}

/**
 * LED-style vertical meter with peak hold. Uses only transforms
 * (scaleY cover + translated peak line) so updates never trigger layout.
 * Feed it with `push(level)` and drive it with `tick(dt)` from the shared loop.
 */
export class LevelMeter {
  readonly el: HTMLDivElement;
  private cover: HTMLDivElement;
  private peak: HTMLDivElement;
  private target = 0;
  private shown = -1;
  private disp = 0;
  private peakN = 0;
  private peakAge = 0;
  private shownPeak = -1;
  private release: number;
  private hold: number;
  private law: (db: number) => number;
  // gain-change overlay (band dynamics), created on first use
  private gr: HTMLDivElement | null = null;
  private grOn = false;
  private grTarget = 0;
  private grDisp = 0;
  private grShown = -1;
  private grBoost = false;

  constructor(opts: MeterOptions = {}, cls = '') {
    this.release = opts.release ?? 1.1;
    this.hold = opts.hold ?? 1200;
    this.law = opts.law ?? meterDbNorm;
    this.cover = h('div', { class: 'meter-cover' });
    this.peak = h('div', { class: 'meter-peak' });
    this.el = h('div', { class: `meter ${cls}`.trim(), 'aria-hidden': 'true' }, h('div', { class: 'meter-lit' }), this.cover, this.peak);
  }

  push(lin: number): void {
    this.target = lin > 0 ? Math.min(1, this.law(20 * Math.log10(lin))) : 0;
  }

  /**
   * Gain change of the band dynamics in dB (+ = reduction, − = boost), drawn as a bar hanging
   * from the top on the meter's own dB scale (12 dB of reduction reaches down 12 dB of scale).
   * null hides the overlay.
   */
  setGainChange(db: number | null): void {
    const on = db !== null;
    if (on && !this.gr) {
      this.gr = h('div', { class: 'meter-gr' });
      this.el.append(this.gr);
    }
    if (on !== this.grOn) {
      this.grOn = on;
      this.el.classList.toggle('has-gr', on);
      if (!on) this.grDisp = this.grTarget = 0;
    }
    if (db === null) return;
    const boost = db < -0.05;
    if (boost !== this.grBoost && this.gr) {
      this.grBoost = boost;
      this.gr.classList.toggle('is-boost', boost);
    }
    // hangs from the top (+12 dB) down by the gain change, measured on this meter's scale
    this.grTarget = Math.min(1, Math.max(0, 1 - this.law(FADER_MAX_DB - Math.abs(db))));
  }

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    this.disp = this.target >= this.disp ? this.target : Math.max(this.target, this.disp - this.release * dt);
    if (this.disp >= this.peakN) {
      this.peakN = this.disp;
      this.peakAge = 0;
    } else {
      this.peakAge += dtMs;
      if (this.peakAge > this.hold) this.peakN = Math.max(this.disp, this.peakN - 0.6 * dt);
    }
    if (Math.abs(this.disp - this.shown) > 0.002) {
      this.shown = this.disp;
      this.cover.style.transform = `scaleY(${(1 - this.disp).toFixed(4)})`;
    }
    if (this.gr) {
      // GR attacks instantly and falls back at the level release speed
      this.grDisp = this.grTarget >= this.grDisp ? this.grTarget : Math.max(this.grTarget, this.grDisp - this.release * dt);
      if (Math.abs(this.grDisp - this.grShown) > 0.002) {
        this.grShown = this.grDisp;
        this.gr.style.transform = `scaleY(${this.grDisp.toFixed(4)})`;
      }
    }
    if (Math.abs(this.peakN - this.shownPeak) > 0.002) {
      this.shownPeak = this.peakN;
      this.peak.style.transform = `translate3d(0, ${((1 - this.peakN) * 100).toFixed(2)}%, 0)`;
      this.peak.style.opacity = this.peakN > 0.01 ? '1' : '0';
      this.peak.classList.toggle('is-over', this.peakN > this.law(0));
    }
  }
}

/** Labelled stereo pair (L/R) of meters. */
export class StereoMeter {
  readonly el: HTMLDivElement;
  readonly l = new LevelMeter({}, 'meter--wide');
  readonly r = new LevelMeter({}, 'meter--wide');
  constructor(label: string) {
    this.el = h(
      'div',
      { class: 'stereo-meter' },
      h('div', { class: 'stereo-meter-bars' }, this.l.el, this.r.el),
      h('span', { class: 'micro-label' }, label),
    );
  }
  push(pair: readonly [number, number]): void {
    this.l.push(pair[0]);
    this.r.push(pair[1]);
  }
  tick(dt: number): void {
    this.l.tick(dt);
    this.r.tick(dt);
  }
}
