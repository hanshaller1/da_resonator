/**
 * Lock row of a mode picture (band filter, band scanner; docs/hardware-modi-und-pools-2026-10-16.md 4A):
 * one button per band column along the foot of the visualisation, with the band frequency and a lock.
 * A locked band keeps its fader level; the mode leaves it alone. Bound to the toggles `<module>.lock<b>`
 * (stored with the sound). The pictures also toggle a lock on a click into the band's column (toggleLock).
 */
import '../../styles/components/locks.css';
import type { ParamStoreAPI } from '../../core/types';
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';
import { h, s, toggleClass } from '../dom';
import { formatHz } from '../viz/draw';

const OPEN = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>';
const SHUT = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';

/** flip the lock of band b of a mode as one gesture */
export function toggleLock(params: ParamStoreAPI, module: string, b: number): void {
  const id = `${module}.lock${b}`;
  params.beginGesture(id);
  params.set(id, params.get(id) >= 0.5 ? 0 : 1);
  params.endGesture(id);
}

export class LockRow {
  readonly el: HTMLElement;

  /** @param name the mode in words, for titles ('band filter') */
  constructor(params: ParamStoreAPI, module: string, name: string) {
    this.el = h('div', { class: 'lock-row', role: 'group', 'aria-label': `Locked bands of the ${name}` });
    for (let b = 0; b < NUM_BANDS; b++) {
      const id = `${module}.lock${b}`;
      const icon = s('svg', { class: 'lock-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
      const f = formatHz(BAND_FREQS[b]);
      const btn = h('button', { type: 'button', class: 'lock-btn', 'data-param': id, 'aria-pressed': 'false' }, icon, h('span', null, f));
      btn.addEventListener('click', () => toggleLock(params, module, b));
      const sync = (v: number) => {
        const on = v >= 0.5;
        icon.innerHTML = on ? SHUT : OPEN;
        toggleClass(btn, 'is-locked', on);
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', `Lock band ${b + 1} (${f} Hz)`);
        btn.title = on ? `Band ${b + 1} locked: it keeps its fader level, the ${name} leaves it alone. Click to free it` : `Click to lock band ${b + 1}: it keeps its fader level`;
      };
      sync(params.get(id));
      params.subscribe(id, sync);
      this.el.append(btn);
    }
  }
}
