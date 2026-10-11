/**
 * Header preset bar: previous / loaded preset (click shows the PLAY/LOAD tab with the browser)
 * / next. A/B slot and the modified dot ride along with the name.
 */
import '../../../styles/tabs/play.css';
import type { EngineAPI } from '../../../core/types';
import { presetSession } from '../../../presets/session';
import { h, toggleClass } from '../../dom';
import { nav } from '../../shell/tabs';
import { focusPresetBrowser, loadSafely, type Notify } from './browser';
import { picon } from './icons';

export function buildPresetBar(engine: EngineAPI, notify: Notify): HTMLElement {
  const session = presetSession(engine);

  const prev = h('button', { type: 'button', class: 'pbar-step', 'aria-label': 'Previous preset', title: 'Previous preset' }, picon('prev'));
  const next = h('button', { type: 'button', class: 'pbar-step', 'aria-label': 'Next preset', title: 'Next preset' }, picon('next'));
  const slot = h('span', { class: 'pbar-slot', 'aria-hidden': 'true' });
  const text = h('span', { class: 'pbar-text' });
  const dot = h('span', { class: 'pbar-dirty', 'aria-hidden': 'true' });
  const nameBtn = h('button', { type: 'button', class: 'pbar-name', 'aria-controls': 'tabpanel-play' }, slot, text, dot, picon('list', 'icon pbar-list'));
  const bar = h('div', { class: 'pbar', role: 'group', 'aria-label': 'Preset' }, prev, nameBtn, next);
  const wrap = h('div', { class: 'hdr-presets' }, bar);

  const open = () => {
    nav.show('play');
    focusPresetBrowser();
  };
  nameBtn.addEventListener('click', open);
  nameBtn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    open();
  });
  prev.addEventListener('click', () => loadSafely(() => session.step(-1), notify));
  next.addEventListener('click', () => loadSafely(() => session.step(1), notify));

  // lit while the browser is the shown tab
  const syncTab = () => toggleClass(wrap, 'is-open', nav.current === 'play');
  syncTab();
  nav.onChange(syncTab);

  const sync = () => {
    const mod = session.dirty ? ', modified' : '';
    text.textContent = session.name;
    toggleClass(bar, 'is-dirty', session.dirty);
    slot.textContent = session.ab;
    slot.hidden = !session.abInUse;
    nameBtn.title = `${session.name}${session.dirty ? ' (modified)' : ''}: show the preset browser (PLAY/LOAD)`;
    nameBtn.setAttribute('aria-label', `Preset ${session.name}${mod}${session.abInUse ? `, compare slot ${session.ab}` : ''}. Show preset browser`);
  };
  sync();
  session.onChange(sync);
  session.store.onChange(sync);

  return wrap;
}
