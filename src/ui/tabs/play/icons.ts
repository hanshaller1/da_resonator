/** Small stroke icons of the preset bar and browser (not in the shared set in dom.ts). */
import { s } from '../../dom';

const PATHS: Record<string, string> = {
  prev: '<path d="m14.5 6-6 6 6 6"/>',
  next: '<path d="m9.5 6 6 6-6 6"/>',
  list: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
};

export function picon(name: keyof typeof PATHS | string, cls = 'icon'): SVGSVGElement {
  const el = s('svg', { class: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.innerHTML = PATHS[name] ?? '';
  return el;
}
