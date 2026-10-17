/**
 * − value + for a number kept outside the params: the buttons, the wheel and the arrow keys step it.
 * `set` gets the wanted value and clamps it itself; `sync` shows the current one.
 */
import { h } from '../dom';

export function stepper(ariaLabel: string, get: () => number, set: (v: number) => void, fmt: (v: number) => string): { el: HTMLElement; sync(): void } {
  const val = h('b', { class: 'cfg-val cfg-step-val' });
  const dec = h('button', { type: 'button', class: 'inst-btn cfg-step-btn', 'aria-label': `${ariaLabel} down` }, '−');
  const inc = h('button', { type: 'button', class: 'inst-btn cfg-step-btn', 'aria-label': `${ariaLabel} up` }, '+');
  dec.addEventListener('click', () => set(get() - 1));
  inc.addEventListener('click', () => set(get() + 1));
  const el = h('span', { class: 'inst cfg-step', role: 'group', 'aria-label': ariaLabel, tabindex: '0' }, dec, val, inc);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      set(get() + (e.deltaY > 0 ? -1 : 1));
    },
    { passive: false },
  );
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    set(get() + d);
  });
  const sync = () => (val.textContent = fmt(get()));
  sync();
  return { el, sync };
}
