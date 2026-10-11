/**
 * Builds the tab row and the fixed panel area from the tab registry. All tabs are mounted once
 * (controls keep their subscriptions, reveal can find them); only the current one is shown.
 */
import type { EngineAPI, Unsubscribe } from '../../core/types';
import { h, toggleClass } from '../dom';
import { getTabDef, nav, NUM_SLOTS, TABS, type Notify, type TabContext, type TabId } from './tabs';

const TAB_KEY = 'resonator.tab';

function readTab(): TabId | null {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === v) ? (v as TabId) : null;
  } catch {
    return null;
  }
}
function writeTab(id: TabId): void {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

/** flash a control so the eye finds it */
export function flash(el: HTMLElement): void {
  el.classList.remove('is-reveal');
  void el.offsetWidth;
  el.classList.add('is-reveal');
  window.setTimeout(() => el.classList.remove('is-reveal'), 1400);
}

export function buildTabs(engine: EngineAPI, notify: Notify): { tabRow: HTMLElement; panels: HTMLElement } {
  const tabRow = h('div', { class: 'tabrow', role: 'tablist', 'aria-label': 'Functions' });
  const panels = h('div', { class: 'panelbox' });
  const buttons = new Map<TabId, HTMLButtonElement>();
  const roots = new Map<TabId, HTMLElement>();
  const visibleCbs = new Map<TabId, Set<(v: boolean) => void>>();

  for (const t of TABS) {
    const btn = h(
      'button',
      { type: 'button', class: 'tab', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `tabpanel-${t.id}`, 'aria-selected': 'false', tabindex: '-1', title: t.title, 'data-tab': t.id },
      h('span', { class: 'tab-led', 'aria-hidden': 'true' }),
      h('span', { class: 'tab-label' }, t.label),
    );
    btn.addEventListener('click', () => nav.show(t.id));
    buttons.set(t.id, btn);
    tabRow.append(btn);

    const status = h('div', { class: 'tp-status' });
    const viz = h('div', { class: 'tp-viz' });
    const slots = Array.from({ length: NUM_SLOTS }, (_, k) => h('div', { class: 'tp-slot', 'data-slot': String(k + 1) }));
    const knobRow = h('div', { class: 'tp-knobs' }, ...slots);
    const root = h('section', { class: `tab-panel tab-panel--${t.id}`, id: `tabpanel-${t.id}`, role: 'tabpanel', 'aria-labelledby': `tab-${t.id}`, hidden: true }, status, viz, knobRow);
    roots.set(t.id, root);
    panels.append(root);

    const cbs = new Set<(v: boolean) => void>();
    visibleCbs.set(t.id, cbs);
    let body: HTMLElement | null = null;
    const ctx: TabContext = {
      engine,
      notify,
      root,
      status,
      viz,
      knobRow,
      slots,
      get visible() {
        return nav.current === t.id;
      },
      onVisible(cb): Unsubscribe {
        cbs.add(cb);
        return () => cbs.delete(cb);
      },
      useBody() {
        if (!body) {
          body = h('div', { class: 'tp-body' });
          viz.remove();
          knobRow.remove();
          root.append(body);
        }
        return body;
      },
    };
    const def = getTabDef(t.id);
    if (!def) {
      viz.append(h('p', { class: 'tp-empty' }, `${t.label}: not built yet.`));
      continue;
    }
    try {
      def.mount(ctx);
    } catch (err) {
      console.error(`[ui] tab "${t.id}" failed to mount`, err);
      viz.replaceChildren(h('p', { class: 'tp-empty' }, `${t.label} failed to load.`));
    }
  }

  const select = (id: TabId, prev: TabId | null) => {
    for (const [tid, b] of buttons) {
      const on = tid === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      toggleClass(b, 'is-selected', on);
      roots.get(tid)!.hidden = !on;
    }
    writeTab(id);
    if (prev && prev !== id) visibleCbs.get(prev)?.forEach((cb) => cb(false));
    visibleCbs.get(id)?.forEach((cb) => cb(true));
  };

  // keyboard: arrows / Home / End move along the tab row
  tabRow.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === nav.current);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j < 0) return;
    e.preventDefault();
    nav.show(TABS[j].id);
    buttons.get(TABS[j].id)?.focus();
  });

  let shown: TabId | null = null;
  nav.onChange((id) => {
    select(id, shown);
    shown = id;
  });
  const initial = readTab() ?? 'fb';
  if (nav.current !== initial) nav.show(initial);
  else {
    select(initial, null);
    shown = initial;
  }

  nav.setRevealHook((paramId) => {
    // the current tab first, so a param shown on several tabs stays where the user is
    const order = [nav.current, ...TABS.map((t) => t.id).filter((id) => id !== nav.current)];
    for (const id of order) {
      const def = getTabDef(id);
      if (!def?.reveal?.(paramId)) continue;
      nav.show(id);
      requestAnimationFrame(() => {
        const el = [...roots.get(id)!.querySelectorAll<HTMLElement>(`[data-param="${CSS.escape(paramId)}"]`)].find((e) => e.offsetParent !== null);
        if (el) flash(el);
      });
      return true;
    }
    // faders and the global column are always visible
    const el = [...document.querySelectorAll<HTMLElement>(`.faders [data-param="${CSS.escape(paramId)}"], .globals [data-param="${CSS.escape(paramId)}"]`)].find((e) => e.offsetParent !== null);
    if (el) {
      flash(el);
      return true;
    }
    return false;
  });

  /** mark tabs whose modules are switched on / active (small LED in the tab) */
  const led = (id: TabId, on: boolean) => toggleClass(buttons.get(id)!, 'is-active', on);
  const p = engine.params;
  const anyOn = (ids: string[]) => ids.some((x) => p.get(x) >= 0.5);
  const syncLeds = () => {
    led('filter', anyOn(['filterPre.on', 'filterPost.on']));
    led('clk', anyOn(['cmod1.on', 'cmod2.on']));
    led('dyn', anyOn(['dyn.on']));
    led('env', anyOn(['ef1.on', 'ef2.on', 'ef3.on', 'ef4.on']));
    led('lfo', anyOn(['lfo1.on', 'lfo2.on', 'lfo3.on', 'lfo4.on']));
    led('fb', anyOn(['fbAllOn']) || Array.from({ length: 10 }, (_, b) => p.get(`band${b}.fb`) > 0.02).some(Boolean));
    led('macro', engine.mod.routes().some((r) => r.source.startsWith('macro')));
  };
  syncLeds();
  p.subscribeAll((id) => {
    if (/\.on$|^fbAllOn$|^band\d\.fb$/.test(id)) syncLeds();
  });
  engine.mod.onChange(syncLeds);

  return { tabRow, panels };
}
