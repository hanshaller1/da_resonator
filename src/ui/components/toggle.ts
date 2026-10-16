import type { ParamStoreAPI, Unsubscribe } from '../../core/types';
import { twinId } from '../../shared/params';
import { channelSel } from '../channel';
import { h, toggleClass } from '../dom';

export interface ToggleOptions {
  label?: string;
  tone?: 'accent' | 'fb' | 'neutral';
  ariaLabel?: string;
  /** extra class names */
  cls?: string;
}

/**
 * LED push button bound to a toggle parameter (curve 'toggle').
 * A toggle with an R twin (Feedback All) follows the channel switch: L or R switches that channel;
 * L+R switches both on, or both off once both are on. Only one channel on shows a half-lit LED.
 */
export class ParamToggle {
  readonly el: HTMLButtonElement;
  readonly id: string;
  private params: ParamStoreAPI;
  private pairId: string | null;
  private unsubs: Unsubscribe[] = [];

  constructor(params: ParamStoreAPI, id: string, opts: ToggleOptions = {}) {
    this.params = params;
    this.id = id;
    this.pairId = twinId(id) ?? null;
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
      const ids = this.editIds();
      const next = ids.every((x) => params.get(x) >= 0.5) ? 0 : 1;
      for (const x of ids) params.beginGesture(x);
      for (const x of ids) params.set(x, next);
      for (const x of ids) params.endGesture(x);
    });
    this.sync();
    this.unsubs.push(params.subscribe(id, () => this.sync()));
    if (this.pairId) this.unsubs.push(params.subscribe(this.pairId, () => this.sync()), channelSel.onChange(() => this.sync()));
  }

  private editIds(): string[] {
    const pr = this.pairId;
    if (!pr) return [this.id];
    const c = channelSel.get();
    return c === 'L' ? [this.id] : c === 'R' ? [pr] : [this.id, pr];
  }

  /** the shown state is on (L+R: at least one channel on) */
  get on(): boolean {
    return this.editIds().some((x) => this.params.get(x) >= 0.5);
  }

  private sync(): void {
    const states = this.editIds().map((x) => this.params.get(x) >= 0.5);
    const on = states.some(Boolean);
    const mixed = on && !states.every(Boolean);
    this.el.setAttribute('aria-pressed', mixed ? 'mixed' : String(on));
    toggleClass(this.el, 'is-on', on && !mixed);
    toggleClass(this.el, 'is-mixed', mixed);
    // which half of the LED is lit: L left, R right
    if (mixed) this.el.dataset.on = states[0] ? 'L' : 'R';
    else delete this.el.dataset.on;
  }

  destroy(): void {
    this.unsubs.forEach((u) => u());
  }
}
