import type { Unsubscribe } from './types';

/** Minimal typed event emitter used throughout the core. */
export class Emitter<A extends unknown[]> {
  private subs = new Set<(...a: A) => void>();
  on(cb: (...a: A) => void): Unsubscribe {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  emit(...a: A): void {
    for (const cb of this.subs) cb(...a);
  }
  get size(): number {
    return this.subs.size;
  }
}
