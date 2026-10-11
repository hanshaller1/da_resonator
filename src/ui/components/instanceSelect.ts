/**
 * Small selector for modules with several instances (LFO 1–4, EF 1–4, clock mod 1–2, pre/post
 * filter), for a tab's status line. Each button carries an LED that follows the instance's
 * `on` param. The choice is remembered per tab in localStorage (a viewer convenience).
 */
import type { EngineAPI } from '../../core/types';
import { h, toggleClass } from '../dom';

export interface InstanceSelectOptions {
  /** remembers the choice under this key */
  key: string;
  count: number;
  label(i: number): string;
  /** param whose value ≥ 0.5 lights the LED of instance i */
  onParam?(i: number): string;
  initial?: number;
}

export class InstanceSelect {
  readonly el: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private listeners = new Set<(i: number) => void>();
  private _current = 0;

  constructor(engine: EngineAPI, private opts: InstanceSelectOptions) {
    this.el = h('div', { class: 'inst', role: 'radiogroup' });
    for (let i = 0; i < opts.count; i++) {
      const led = h('span', { class: 'inst-led', 'aria-hidden': 'true' });
      const b = h('button', { type: 'button', class: 'inst-btn', role: 'radio', 'aria-checked': 'false' }, led, h('span', null, opts.label(i)));
      b.addEventListener('click', () => this.select(i));
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const j = (this._current + d + opts.count) % opts.count;
        this.select(j);
        this.buttons[j].focus();
      });
      const onId = opts.onParam?.(i);
      if (onId) {
        const sync = (v: number) => toggleClass(led, 'is-on', v >= 0.5);
        sync(engine.params.get(onId));
        engine.params.subscribe(onId, sync);
      } else led.hidden = true;
      this.buttons.push(b);
      this.el.append(b);
    }
    let saved = opts.initial ?? 0;
    try {
      const v = Number(localStorage.getItem(`resonator.inst.${opts.key}`));
      if (Number.isInteger(v) && v >= 0 && v < opts.count && localStorage.getItem(`resonator.inst.${opts.key}`) !== null) saved = v;
    } catch {
      /* storage unavailable */
    }
    this.apply(saved);
  }

  get current(): number {
    return this._current;
  }

  /** select instance i (notifies listeners when it changes) */
  select(i: number): void {
    if (i === this._current) return;
    this.apply(i);
    try {
      localStorage.setItem(`resonator.inst.${this.opts.key}`, String(i));
    } catch {
      /* storage unavailable */
    }
    for (const l of this.listeners) l(i);
  }

  onChange(cb: (i: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private apply(i: number): void {
    this._current = i;
    this.buttons.forEach((b, k) => {
      b.setAttribute('aria-checked', String(k === i));
      b.tabIndex = k === i ? 0 : -1;
      toggleClass(b, 'is-selected', k === i);
    });
  }
}
