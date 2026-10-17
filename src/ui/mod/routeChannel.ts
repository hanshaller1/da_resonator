/**
 * Channel of a route onto a band value (L/R per band, docs/lr-pro-band-2026-10-16.md): a small
 * button cycling L+R → L → R → INV. Only routes onto a param with an R twin or a band group get one.
 */
import type { ModAPI, RouteChannel, RouteInfo } from '../../core/types';
import { hasRouteChannel } from '../../shared/params';
import { h, toggleClass } from '../dom';

const ORDER: RouteChannel[] = ['LR', 'L', 'R', 'INV'];
const TEXT: Record<RouteChannel, [string, string]> = {
  LR: ['L+R', 'Moves both channels alike'],
  L: ['L', 'Moves the left channel only'],
  R: ['R', 'Moves the right channel only'],
  INV: ['INV', 'R moves against L (pans the band)'],
};

/** the button for route r, or null when its target has no L/R pair; it follows later changes itself */
export function routeChannelButton(mod: ModAPI, r: RouteInfo): { el: HTMLButtonElement; dispose(): void } | null {
  if (!hasRouteChannel(r.target)) return null;
  const el = h('button', { type: 'button', class: 'route-ch' });
  let ch: RouteChannel = r.ch;
  const sync = () => {
    const [text, what] = TEXT[ch];
    el.textContent = text;
    el.title = `Channel: ${what}. Click for the next.`;
    el.setAttribute('aria-label', `Channel ${text}`);
    toggleClass(el, 'is-split', ch !== 'LR');
  };
  sync();
  el.addEventListener('click', () => mod.setRouteChannel(r.slot, ORDER[(ORDER.indexOf(ch) + 1) % ORDER.length]));
  const off = mod.onChange(() => {
    const now = mod.routes().find((x) => x.slot === r.slot && x.target === r.target);
    if (now && now.ch !== ch) {
      ch = now.ch;
      sync();
    }
  });
  return { el, dispose: off };
}
