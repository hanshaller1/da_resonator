import type { ParamStoreAPI } from '../../core/types';
import { h } from '../dom';
import { ParamControl, type ParamControlOptions } from './paramControl';

export interface ParamFieldOptions extends ParamControlOptions {
  /** caption before the value (defaults to spec.short) */
  label?: string;
  /** format the shown value (default: the spec's formatValue) */
  format?: (plain: number) => string;
}

/**
 * Compact value field for status lines ("THR −18.0 dB"): same gestures as a knob (vertical drag,
 * Shift fine, wheel, arrows, double-click reset, right-click modulation, assign mode).
 * Modulation shows as an underline whose length follows the effective value.
 */
export class ParamField extends ParamControl {
  readonly el: HTMLElement;
  private valueEl: HTMLElement;
  private modEl: HTMLElement;

  constructor(params: ParamStoreAPI, id: string, private fopts: ParamFieldOptions = {}) {
    super(params, id, { dragRange: 160, ...fopts });
    this.valueEl = h('span', { class: 'pfield-value' });
    this.modEl = h('span', { class: 'pfield-mod', 'aria-hidden': 'true' });
    this.el = h('span', { class: 'pfield' }, h('span', { class: 'pfield-label' }, fopts.label ?? this.spec.short), this.valueEl, this.modEl);
    this.init();
  }

  protected render(_norm: number, plain: number): void {
    this.valueEl.textContent = this.fopts.format ? this.fopts.format(plain) : this.valueText;
  }

  protected renderMod(eff: number | null): void {
    this.modEl.style.transform = eff === null ? 'scaleX(0)' : `scaleX(${eff.toFixed(3)})`;
  }
}
