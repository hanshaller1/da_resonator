import type { ParamStoreAPI, Unsubscribe } from '../../core/types';
import { h, toggleClass } from '../dom';

export interface ToggleOptions {
  label?: string;
  tone?: 'accent' | 'fb' | 'neutral';
  ariaLabel?: string;
  /** extra class names */
  cls?: string;
}

/** LED push button bound to a toggle parameter (curve 'toggle'). */
export class ParamToggle {
  readonly el: HTMLButtonElement;
  readonly id: string;
  private params: ParamStoreAPI;
  private unsub: Unsubscribe;

  constructor(params: ParamStoreAPI, id: string, opts: ToggleOptions = {}) {
    this.params = params;
    this.id = id;
    const spec = params.spec(id);
    this.el = h(
      'button',
      {
        type: 'button',
        class: `toggle toggle--${opts.tone ?? 'accent'} ${opts.cls ?? ''}`.trim(),
        'aria-pressed': 'false',
        'aria-label': opts.ariaLabel ?? spec.label,
        'data-param': id,
      },
      h('span', { class: 'led', 'aria-hidden': 'true' }),
      h('span', { class: 'toggle-label' }, opts.label ?? spec.short),
    );
    this.el.addEventListener('click', () => {
      params.beginGesture(id);
      params.set(id, params.get(id) >= 0.5 ? 0 : 1);
      params.endGesture(id);
    });
    this.sync(params.get(id));
    this.unsub = params.subscribe(id, (v) => this.sync(v));
  }

  get on(): boolean {
    return this.params.get(this.id) >= 0.5;
  }

  private sync(v: number): void {
    const on = v >= 0.5;
    this.el.setAttribute('aria-pressed', String(on));
    toggleClass(this.el, 'is-on', on);
  }

  destroy(): void {
    this.unsub();
  }
}
