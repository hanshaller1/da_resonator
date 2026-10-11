/**
 * PLAY/LOAD tab: the preset browser as a page (library, search, A/B, save, files).
 * The header's preset name opens this tab; prev / next stay in the header.
 * Status line = loaded preset, modified state, A/B slot, library size.
 */
import '../../styles/tabs/play.css';
import { presetSession } from '../../presets/session';
import { h, toggleClass } from '../dom';
import { registerTab } from '../shell/tabs';
import { PresetBrowser } from './play/browser';

const STORAGE_NAMES = { indexeddb: 'browser storage', localstorage: 'browser storage', memory: 'this session only' } as const;

registerTab({
  id: 'play',
  mount(tab) {
    const { engine } = tab;
    const session = presetSession(engine);
    const browser = new PresetBrowser(engine, session, tab.notify);
    tab.useBody().append(browser.el);

    /* ---------- status line ---------- */
    const name = h('b', { class: 'pp-st-name' });
    const meta = h('span', { class: 'pp-st-meta' });
    const state = h('b', { class: 'pp-st-state' });
    const ab = h('b');
    const lib = h('b');
    const store = h('span', { class: 'pp-st-store' });
    tab.status.append(
      h('span', { class: 'pp-st-cell' }, 'Preset ', name, meta),
      h('span', null, 'State ', state),
      h('span', null, 'A/B ', ab),
      h('span', { class: 'tp-spacer' }),
      h('span', null, 'Library ', lib, store),
    );
    const sync = () => {
      const p = session.preset;
      name.textContent = session.name;
      meta.textContent = p ? `${p.factory ? 'Factory' : 'User'} · ${p.category}` : '';
      state.textContent = session.dirty ? 'modified' : 'saved';
      toggleClass(state, 'is-dirty', session.dirty);
      ab.textContent = session.abInUse ? `slot ${session.ab}` : `${session.ab} (B unused)`;
      const s = session.store;
      const nUser = s.userPresets().length;
      lib.textContent = `${s.factory.length} factory · ${nUser} user`;
      store.textContent = ` · ${STORAGE_NAMES[s.storage]}`;
    };
    sync();
    session.onChange(sync);
    session.store.onChange(sync);
  },
});
