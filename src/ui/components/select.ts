import type { ParamStoreAPI, Unsubscribe } from '../../core/types';
import { formatValue } from '../../shared/params';
import { h, toggleClass } from '../dom';
import { formatDepth } from '../mod/labels';
import { AssignBinding, type AssignHost } from '../mod/targets';

export interface SelectOptions {
  /** caption above the value (defaults to spec.short) */
  label?: string;
  ariaLabel?: string;
}

/**
 * Stepper for a discrete param (curve 'discrete'): ‹ value ›, wheel / arrow keys step,
 * click on the value opens a native <select>. Shows modulation (stepped) as an underline.
 * Takes part in modulation assign mode like the knobs (drag = route depth).
 */
export class ParamSelect implements AssignHost {
  readonly el: HTMLElement;
  private select: HTMLSelectElement;
  private unsub: Unsubscribe;
  private assignB: AssignBinding;
  private depthEl: HTMLElement;

  constructor(
    params: ParamStoreAPI,
    readonly id: string,
    opts: SelectOptions = {},
  ) {
    const spec = params.spec(id);
    if (spec.curve !== 'discrete') throw new Error(`${id} is not discrete`);
    const options = spec.options ?? [];
    this.select = h(
      'select',
      { class: 'pselect-native', 'aria-label': opts.ariaLabel ?? spec.label, 'data-param': id },
      ...options.map((o, i) => h('option', { value: String(i) }, o)),
    );
    const step = (d: number) => {
      const v = Math.min(spec.max, Math.max(spec.min, Math.round(params.get(id)) + d));
      params.beginGesture(id);
      params.set(id, v);
      params.endGesture(id);
    };
    const prev = h('button', { type: 'button', class: 'pselect-step', 'aria-label': 'Previous', tabindex: '-1' }, '‹');
    const next = h('button', { type: 'button', class: 'pselect-step', 'aria-label': 'Next', tabindex: '-1' }, '›');
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    this.select.addEventListener('change', () => {
      params.beginGesture(id);
      params.set(id, Number(this.select.value));
      params.endGesture(id);
    });
    this.depthEl = h('span', { class: 'pselect-depth', hidden: true });
    this.el = h(
      'div',
      { class: 'pselect', 'data-param': id },
      h('span', { class: 'pselect-label micro-label' }, opts.label ?? spec.short, this.depthEl),
      h('div', { class: 'pselect-row' }, prev, this.select, next),
    );
    this.el.addEventListener(
      'wheel',
      (e) => {
        if (this.assignB.wheel(e)) return;
        e.preventDefault();
        step(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
    // assign mode: the binding takes pointer / double-click / keys before the stepper and the native select
    this.el.addEventListener('pointerdown', (e) => this.assignB.pointerDown(e, { dragRange: 160 }), true);
    this.el.addEventListener('dblclick', (e) => this.assignB.dblclick(e) && e.stopPropagation(), true);
    this.el.addEventListener('keydown', (e) => this.assignB.keydown(e) && e.stopPropagation(), true);
    const sync = (v: number) => {
      this.select.value = String(Math.round(v));
      this.select.title = formatValue(spec, v);
    };
    sync(params.get(id));
    this.unsub = params.subscribe(id, sync);
    const modSync = () => toggleClass(this.el, 'is-modulated', params.isModulated(id));
    modSync();
    this.modTimer = window.setInterval(modSync, 250);
    this.assignB = new AssignBinding(this, params);
  }
  private modTimer: number;

  /** AssignHost: show the armed source's route depth as a badge */
  showDepth(depth: number | null): void {
    this.depthEl.hidden = depth === null;
    if (depth !== null) this.depthEl.textContent = formatDepth(depth);
  }

  destroy(): void {
    this.unsub();
    clearInterval(this.modTimer);
    this.assignB.destroy();
  }
}
