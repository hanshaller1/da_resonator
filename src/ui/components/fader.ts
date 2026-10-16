import type { ParamStoreAPI } from '../../core/types';
import { FADER_MAX_DB, toNorm } from '../../shared/params';
import { h } from '../dom';
import { ParamControl, type ParamControlOptions } from './paramControl';

export interface FaderOptions extends ParamControlOptions {
  /** scale marks (plain values) drawn beside the track */
  marks?: { value: number; label: string }[];
  /** plain value the cap snaps to while passing it (default: 0 dB on a fader-law param, none otherwise) */
  detent?: number | null;
}

export const DEFAULT_FADER_MARKS = [
  { value: FADER_MAX_DB, label: '+12' },
  { value: 6, label: '+6' },
  { value: 0, label: '0' },
  { value: -12, label: '-12' },
  { value: -24, label: '-24' },
  { value: -Infinity, label: '-∞' },
];

/** half width of the detent, in travel (≈ 2–3 px on a band fader) */
const DETENT_WIDTH = 0.015;

/**
 * Vertical fader. Grabbing the cap drags relatively; pressing elsewhere on
 * the track jumps the cap under the pointer, then drags (absolute-ish).
 * Travel is measured with a ResizeObserver; the cap moves via transform.
 */
export class Fader extends ParamControl {
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private thumb: HTMLDivElement;
  private fill: HTMLDivElement;
  private modMarker: HTMLDivElement;
  private modBar: HTMLDivElement;
  private depthBar: HTMLDivElement;
  /** L/R pairs: marks of the channel(s) the cap does not show */
  private pairMarks: HTMLDivElement[] = [];
  private pairNorms: { ch: 'L' | 'R'; norm: number }[] = [];
  private travel = 200;
  private thumbH = 40;
  private ro: ResizeObserver;
  /** detent position (norm), null = none */
  private detentN: number | null = null;

  constructor(params: ParamStoreAPI, id: string, opts: FaderOptions = {}) {
    super(params, id, opts);
    const spec = params.spec(id);
    const detent = opts.detent === undefined ? (spec.curve === 'fader' ? 0 : null) : opts.detent;
    this.detentN = detent === null ? null : toNorm(spec, detent);
    this.fill = h('div', { class: 'fader-fill' });
    this.modBar = h('div', { class: 'fader-mod-bar' });
    this.depthBar = h('div', { class: 'fader-depth', hidden: true });
    this.modMarker = h('div', { class: 'fader-mod' });
    this.thumb = h('div', { class: 'fader-thumb' }, h('span', { class: 'fader-thumb-line' }));
    if (this.pairId) this.pairMarks = [h('div', { class: 'fader-pair', hidden: true }), h('div', { class: 'fader-pair', hidden: true })];
    this.track = h(
      'div',
      { class: 'fader-track' },
      h('div', { class: 'fader-groove' }, this.fill, this.modBar),
      this.depthBar,
      ...this.pairMarks,
      this.modMarker,
      this.thumb,
    );
    this.el = h('div', { class: 'fader' }, this.track);

    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.track);
    this.init();
  }

  override destroy(): void {
    super.destroy();
    this.ro.disconnect();
  }

  private measure(): void {
    const H = this.track.clientHeight;
    this.thumbH = this.thumb.offsetHeight || 40;
    this.travel = Math.max(1, H - this.thumbH);
    this.render(this.norm);
    this.paintDepth();
    this.paintPair();
  }

  protected override dragRange(): number {
    return this.travel;
  }

  /** the cap rests at the detent while it is within reach (Shift moves through it) */
  protected override adjust(n: number, fine: boolean): number {
    const d = this.detentN;
    return d !== null && !fine && Math.abs(n - d) < DETENT_WIDTH ? d : n;
  }

  protected override jumpNormAt(e: PointerEvent): number | null {
    if (e.target instanceof Node && this.thumb.contains(e.target)) return null;
    const r = this.track.getBoundingClientRect();
    // the stage may be scaled: client px → layout px
    const k = r.height / (this.track.clientHeight || r.height || 1);
    const y = (e.clientY - r.top) / k - this.thumbH / 2;
    return 1 - Math.min(1, Math.max(0, y / this.travel));
  }

  protected render(norm: number): void {
    const y = (1 - norm) * this.travel;
    this.thumb.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    this.fill.style.transform = `scaleY(${norm.toFixed(4)})`;
  }

  protected override renderDepth(range: [number, number] | null): void {
    this.depthBar.hidden = !range;
    if (!range) return;
    // in track pixels, like the thumb: the groove runs from thumbH/2 to thumbH/2 + travel
    const top = (1 - range[1]) * this.travel + this.thumbH / 2;
    const hgt = Math.max(2, (range[1] - range[0]) * this.travel);
    this.depthBar.style.transform = `translate3d(0, ${(top - (hgt === 2 ? 1 : 0)).toFixed(2)}px, 0)`;
    this.depthBar.style.height = `${hgt.toFixed(2)}px`;
  }

  protected override renderPair(marks: { ch: 'L' | 'R'; norm: number }[]): void {
    this.pairNorms = marks;
    this.paintPair();
  }

  private paintPair(): void {
    this.pairMarks.forEach((el, k) => {
      const m = this.pairNorms[k];
      el.hidden = !m;
      if (!m) return;
      el.dataset.ch = m.ch;
      const y = (1 - m.norm) * this.travel + this.thumbH / 2;
      el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    });
  }

  protected renderMod(eff: number | null): void {
    if (eff === null) return;
    const y = (1 - eff) * this.travel + this.thumbH / 2;
    this.modMarker.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    const lo = Math.min(eff, this.norm);
    const hi = Math.max(eff, this.norm);
    this.modBar.style.transform = `translate3d(0, ${((1 - hi) * 100).toFixed(2)}%, 0) scaleY(${(hi - lo).toFixed(4)})`;
  }
}

/** Static scale (tick marks + labels) aligned to a fader's travel. */
export function faderScale(params: ParamStoreAPI, id: string, marks = DEFAULT_FADER_MARKS): HTMLDivElement {
  const spec = params.spec(id);
  const el = h('div', { class: 'fader-scale', 'aria-hidden': 'true' });
  for (const m of marks) {
    const v = Number.isFinite(m.value) ? m.value : spec.min;
    const n = toNorm(spec, v);
    const mark = h('div', { class: `fader-mark${m.value === 0 ? ' fader-mark--unity' : ''}`, style: `--n:${n}` }, h('span', null, m.label));
    el.append(mark);
  }
  return el;
}

