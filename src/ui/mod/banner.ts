/** Bar shown while a source is armed: what to do next, and a Done button. */
import type { ModAPI } from '../../core/types';
import { h } from '../dom';
import { assign } from './assign';
import { onSourceNames, sourceLabel } from './labels';

export function buildAssignBanner(mod: ModAPI): HTMLElement {
  const name = h('strong', { class: 'assign-banner-src' });
  const count = h('span', { class: 'assign-banner-count' });
  const done = h('button', { type: 'button', class: 'btn assign-banner-done' }, 'Done');
  const el = h(
    'div',
    { class: 'assign-banner', role: 'region', 'aria-label': 'Modulation assign mode', hidden: true },
    h('span', { class: 'assign-banner-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'assign-banner-text' }, 'Assigning ', name, count),
    h(
      'span',
      { class: 'assign-banner-help' },
      h('span', null, h('kbd', null, 'Drag'), ' depth'),
      h('span', null, h('kbd', null, 'Double-click'), ' remove'),
      h('span', null, h('kbd', null, 'Enter'), ' add'),
      h('span', null, h('kbd', null, 'Alt'), '-drag value'),
      h('span', null, h('kbd', null, 'Esc'), ' finish'),
    ),
    done,
  );
  done.addEventListener('click', () => assign.arm(null));
  const sync = () => {
    const src = assign.source;
    el.hidden = !src;
    if (!src) return;
    name.textContent = sourceLabel(src);
    const n = mod.routesFrom(src).length;
    count.textContent = n ? ` · ${n} target${n === 1 ? '' : 's'}` : '';
  };
  assign.onChange(sync);
  mod.onChange(sync);
  onSourceNames(sync);
  sync();
  return el;
}
