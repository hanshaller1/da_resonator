import type { ParamStoreAPI } from '../../core/types';
import { formatValue, twinId } from '../../shared/params';
import { h, s } from '../dom';
import { ParamControl, type ParamControlOptions } from './paramControl';

export type KnobSize = 'sm' | 'md' | 'lg';
export type KnobTone = 'accent' | 'fb' | 'neutral';

export interface KnobOptions extends ParamControlOptions {
  size?: KnobSize;
  tone?: KnobTone;
  /** visible caption under the knob (defaults to spec.short) */
  label?: string;
  /** hide the caption entirely */
  bare?: boolean;
}

const SWEEP = 270; // degrees
const START = -135;
const C = 24; // viewBox centre
const R_TRACK = 19;
const R_MOD = 22.6;
const R_DEPTH = 22.6;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(r: number, a0: number, a1: number): string {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const [x0, y0] = polar(r, lo);
  const [x1, y1] = polar(r, hi);
  const large = hi - lo > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const normToDeg = (n: number) => START + n * SWEEP;

/**
 * Rotary knob bound to a parameter. Relative vertical drag.
 * Bipolar params (min < 0 < max) draw their arc from the centre.
 */
export class Knob extends ParamControl {
  readonly el: HTMLDivElement;
  private dial: SVGSVGElement;
  private valueArc: SVGPathElement;
  private modArc: SVGPathElement;
  private modDot: SVGCircleElement;
  private depthArc: SVGPathElement;
  private pointer: SVGGElement;
  /** L/R pairs: thin pointers of the channel(s) the main pointer does not show */
  private pairPointers: SVGGElement[] = [];
  private valueEl: HTMLSpanElement;
  private nameEl: HTMLSpanElement | null = null;

  constructor(params: ParamStoreAPI, id: string, opts: KnobOptions = {}) {
    super(params, id, { dragRange: 200, ...opts });
    const size = opts.size ?? 'md';
    const tone = opts.tone ?? 'accent';

    this.valueArc = s('path', { class: 'knob-value' });
    this.modArc = s('path', { class: 'knob-mod' });
    this.depthArc = s('path', { class: 'knob-depth' });
    this.modDot = s('circle', { class: 'knob-mod-dot', r: 1.8, cx: C, cy: C });
    this.pointer = s('g', { class: 'knob-pointer' }, s('line', { x1: C, y1: C - 6.5, x2: C, y2: C - 13 }));
    if (twinId(id)) this.pairPointers = [0, 1].map(() => s('g', { class: 'knob-pair', visibility: 'hidden' }, s('line', { x1: C, y1: C - 4, x2: C, y2: C - R_TRACK - 2 })));

    const ticks = s('g', { class: 'knob-ticks' });
    const tickAt = this.bipolar ? [0, 0.5, 1] : [0, 1];
    for (const t of tickAt) {
      const [x0, y0] = polar(R_TRACK + 3.2, normToDeg(t));
      const [x1, y1] = polar(R_TRACK + 5, normToDeg(t));
      ticks.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1 }));
    }

    this.dial = s(
      'svg',
      { class: 'knob-dial', viewBox: '0 0 48 48', 'aria-hidden': 'true' },
      ticks,
      s('path', { class: 'knob-track', d: arc(R_TRACK, START, START + SWEEP) }),
      this.valueArc,
      this.depthArc,
      this.modArc,
      s('circle', { class: 'knob-cap-shadow', cx: C, cy: C + 0.8, r: 14.6 }),
      s('circle', { class: 'knob-cap', cx: C, cy: C, r: 14 }),
      s('circle', { class: 'knob-cap-sheen', cx: C, cy: C, r: 13.2 }),
      ...this.pairPointers,
      this.pointer,
      this.modDot,
    );

    this.valueEl = h('span', { class: 'knob-readout' });
    if (!opts.bare) this.nameEl = h('span', { class: 'knob-name' }, opts.label ?? this.spec.short);
    const caption = this.nameEl ? h('span', { class: 'knob-caption' }, this.nameEl, this.valueEl) : null;

    this.el = h(
      'div',
      { class: `knob knob--${size} knob--${tone}${this.bipolar ? ' knob--bipolar' : ''}` },
      h('div', { class: 'knob-hit' }, this.dial),
      caption,
    );
    this.init();
  }

  protected override hitTarget(): HTMLElement {
    return this.el;
  }

  /** change the caption (and optionally the accessible name), e.g. after renaming a macro */
  setLabel(label: string, ariaLabel?: string): void {
    if (this.nameEl) this.nameEl.textContent = label;
    if (ariaLabel) this.el.setAttribute('aria-label', ariaLabel);
  }

  protected render(norm: number): void {
    const deg = normToDeg(norm);
    const from = this.bipolar ? normToDeg(0.5) : START;
    this.valueArc.setAttribute('d', arc(R_TRACK, from, deg));
    this.pointer.setAttribute('transform', `rotate(${deg.toFixed(2)} ${C} ${C})`);
    const split = this.splitValues();
    if (split) {
      // L+R with the channels apart: L over R (the readout never changes the knob's width)
      const ln = (ch: string, v: number) => h('span', { class: 'knob-ro-line' }, h('span', { class: 'knob-ro-ch' }, ch), formatValue(this.spec, v));
      this.valueEl.replaceChildren(ln('L', split[0]), ln('R', split[1]));
    } else this.valueEl.textContent = this.valueText;
    this.valueEl.classList.toggle('is-split', !!split);
  }

  protected override renderPair(marks: { ch: 'L' | 'R'; norm: number }[]): void {
    this.pairPointers.forEach((g, k) => {
      const m = marks[k];
      g.setAttribute('visibility', m ? 'visible' : 'hidden');
      if (m) g.setAttribute('transform', `rotate(${normToDeg(m.norm).toFixed(2)} ${C} ${C})`);
    });
  }

  protected override renderDepth(range: [number, number] | null): void {
    if (!range) {
      this.depthArc.setAttribute('d', '');
      return;
    }
    const a = normToDeg(range[0]);
    const b = normToDeg(range[1]);
    // zero depth: a short tick at the value so the route is still visible
    this.depthArc.setAttribute('d', arc(R_DEPTH, a, b) || arc(R_DEPTH, a - 2, a + 2));
  }

  protected renderMod(eff: number | null): void {
    if (eff === null) {
      this.modArc.setAttribute('d', '');
      return;
    }
    const a = normToDeg(this.norm);
    const b = normToDeg(eff);
    this.modArc.setAttribute('d', arc(R_MOD, a, b) || arc(R_MOD, b - 1, b + 1));
    const [x, y] = polar(R_MOD, b);
    this.modDot.setAttribute('cx', x.toFixed(2));
    this.modDot.setAttribute('cy', y.toFixed(2));
  }
}
