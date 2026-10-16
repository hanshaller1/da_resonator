/**
 * PLAY/LOAD tab: the preset browser as a page (library, search, A/B, save, files) and the pools on
 * the right (play/pools.ts). The header's preset name opens this tab; prev / next stay in the header.
 * Status line = loaded preset, modified state, A/B slot, the pool and its position, library size.
 */
import '../../styles/tabs/play.css';
import { presetSession } from '../../presets/session';
import { h, toggleClass } from '../dom';
import { registerTab } from '../shell/tabs';
import { playKit } from '../pool';
import { PresetBrowser } from './play/browser';
import { PoolPanel } from './play/pools';

const STORAGE_NAMES = { indexeddb: 'browser storage', localstorage: 'browser storage', memory: 'this session only' } as const;

registerTab({
  id: 'play',
  mount(tab) {
    const { engine } = tab;
    const session = presetSession(engine);
    const browser = new PresetBrowser(engine, session, tab.notify);
    const pool = new PoolPanel(engine, tab.notify);
    browser.el.append(pool.el);
    browser.addActionRow('Pools', ...pool.fileButtons);
    tab.useBody().append(browser.el);
    const { pools, player } = playKit(engine);

    /* ---------- status line ---------- */
    const name = h('b', { class: 'pp-st-name' });
    const meta = h('span', { class: 'pp-st-meta' });
    const state = h('b', { class: 'pp-st-state' });
    const ab = h('b');
    const lib = h('b');
    const store = h('span', { class: 'pp-st-store' });
    const poolName = h('b', { class: 'pp-st-pool' });
    const poolPos = h('span', { class: 'pp-st-meta' });
    tab.status.append(
      h('span', { class: 'pp-st-cell' }, 'Preset ', name, meta),
      h('span', null, 'State ', state),
      h('span', null, 'A/B ', ab),
      h('span', { class: 'pp-st-cell' }, 'Pool ', poolName, poolPos),
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
      const pl = pools.selected;
      poolName.textContent = pl.name;
      toggleClass(poolName, 'is-running', player.running);
      const n = pl.entries.length;
      poolPos.textContent = ` · ${player.running ? 'running' : 'stopped'} · ${player.pos >= 0 ? `${player.pos + 1}/${n}` : `${n} preset${n === 1 ? '' : 's'}`}`;
    };
    sync();
    session.onChange(sync);
    session.store.onChange(sync);
    pools.onChange(sync);
    player.onChange(sync);
  },
});
