/**
 * Modulation assign mode: while a source is armed, clicking a control routes that source to
 * the control's param (and dragging adjusts the route depth instead of the value).
 * One global store so source chips and every ParamControl agree.
 */
import { Emitter } from '../../core/Emitter';
import type { Unsubscribe } from '../../core/types';

class AssignStore {
  private _source: string | null = null;
  private e = new Emitter<[string | null]>();

  /** armed source id ('lfo1' …) or null */
  get source(): string | null {
    return this._source;
  }
  arm(source: string | null): void {
    if (source === this._source) return;
    this._source = source;
    this.e.emit(source);
  }
  toggle(source: string): void {
    this.arm(this._source === source ? null : source);
  }
  onChange(cb: (source: string | null) => void): Unsubscribe {
    return this.e.on(cb);
  }
}

export const assign = new AssignStore();

if (typeof window !== 'undefined') {
  // Esc ends assign mode. Popovers / text fields handle their own Esc first (preventDefault);
  // preventDefault here keeps the app's Esc = panic from firing as well.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !assign.source) return;
    e.preventDefault();
    assign.arm(null);
  });
}
