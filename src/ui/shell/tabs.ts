/**
 * The 10 function tabs (one above each fader column) and the fixed panel they share.
 * Every tab gets the same 1044 × 336 panel: a 24 px status line, a 240 px visualisation and a
 * 72 px control row with 10 fixed slots (slot k sits over fader k). A tab fills those areas in
 * `mount`; slots it does not use stay empty so nothing moves when switching tabs.
 * Page-like tabs (presets, config) may call `ctx.useBody()` to get the viz + control row area
 * (1044 × 312) as one free element.
 */
import type { EngineAPI, Unsubscribe } from '../../core/types';

export type TabId = 'fb' | 'filter' | 'clk' | 'dyn' | 'macro' | 'env' | 'lfo' | 'play' | 'spectr' | 'config';

export interface TabInfo {
  id: TabId;
  /** button caption, as on the device */
  label: string;
  /** accessible / tooltip description */
  title: string;
}

/** left to right, one per fader column */
export const TABS: readonly TabInfo[] = [
  { id: 'fb', label: 'FB', title: 'Bands: resonance and feedback per band' },
  { id: 'filter', label: 'FILTER', title: 'Pre and post filter' },
  { id: 'clk', label: 'CLK MOD', title: 'Clock and clock mods' },
  { id: 'dyn', label: 'DYN EQ', title: 'Band dynamics' },
  { id: 'macro', label: 'MACRO', title: 'Macros' },
  { id: 'env', label: 'ENV MOD', title: 'Envelope followers' },
  { id: 'lfo', label: 'LFO MOD', title: 'LFOs' },
  { id: 'play', label: 'PLAY/LOAD', title: 'Presets' },
  { id: 'spectr', label: 'SPECTR', title: 'Analyser' },
  { id: 'config', label: 'CONFIG', title: 'Source, analog and settings' },
];

export const NUM_SLOTS = 10;

export type Notify = (msg: string, tone?: 'error' | 'info') => void;

export interface TabContext {
  readonly engine: EngineAPI;
  readonly notify: Notify;
  /** the whole panel of this tab (1044 × 336) */
  readonly root: HTMLElement;
  /** 24 px status line (flex row; put text left, small controls right) */
  readonly status: HTMLElement;
  /** 1044 × 240 visualisation area (position: relative); band columns line up with the faders */
  readonly viz: HTMLElement;
  /** 72 px control row, a 10-column grid */
  readonly knobRow: HTMLElement;
  /** the 10 slots of the control row; slot k is over fader k */
  readonly slots: readonly HTMLElement[];
  /** true while this tab is the one shown */
  readonly visible: boolean;
  /** called with true / false when the tab is shown / hidden (not called initially) */
  onVisible(cb: (visible: boolean) => void): Unsubscribe;
  /** merge viz + control row into one free element (1044 × 312) and return it */
  useBody(): HTMLElement;
}

export interface TabDef {
  id: TabId;
  mount(ctx: TabContext): void;
  /**
   * Called when some UI wants to show param `id` (route lists, popovers). Return true if this tab
   * owns the control; select the right instance (LFO 2 …) before returning. The shell then
   * switches to the tab and flashes the control.
   */
  reveal?(paramId: string): boolean;
}

const registry = new Map<TabId, TabDef>();

export function registerTab(def: TabDef): void {
  if (registry.has(def.id)) console.warn(`[ui] tab "${def.id}" re-registered`);
  registry.set(def.id, def);
}

export function getTabDef(id: TabId): TabDef | undefined {
  return registry.get(id);
}

/* ---------- navigation ---------- */

type NavListener = (id: TabId) => void;
const navListeners = new Set<NavListener>();
let current: TabId = 'fb';
let revealHook: ((paramId: string) => boolean) | null = null;

export const nav = {
  get current(): TabId {
    return current;
  },
  show(id: TabId): void {
    if (id === current) return;
    current = id;
    for (const l of navListeners) l(id);
  },
  onChange(cb: NavListener): Unsubscribe {
    navListeners.add(cb);
    return () => navListeners.delete(cb);
  },
  /** switch to the tab that owns param `id` and flash its control; false if none does */
  reveal(paramId: string): boolean {
    return revealHook ? revealHook(paramId) : false;
  },
  /** @internal set by the app shell */
  setRevealHook(fn: (paramId: string) => boolean): void {
    revealHook = fn;
  },
};
