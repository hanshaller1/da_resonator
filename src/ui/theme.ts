export type ThemePref = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'resonator.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

function writePref(p: ThemePref): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Theme controller: follows prefers-color-scheme while pref === 'auto',
 * otherwise pins light/dark. Writes data-theme on <html>.
 */
export class ThemeController {
  pref: ThemePref = readPref();
  private mq = window.matchMedia('(prefers-color-scheme: light)');
  private listeners = new Set<(pref: ThemePref, resolved: ResolvedTheme) => void>();

  constructor() {
    this.mq.addEventListener('change', () => this.apply());
    this.apply();
  }

  get resolved(): ResolvedTheme {
    if (this.pref === 'auto') return this.mq.matches ? 'light' : 'dark';
    return this.pref;
  }

  cycle(): void {
    const order: ThemePref[] = ['auto', 'light', 'dark'];
    this.set(order[(order.indexOf(this.pref) + 1) % order.length]);
  }

  set(p: ThemePref): void {
    this.pref = p;
    writePref(p);
    this.apply();
  }

  onChange(cb: (pref: ThemePref, resolved: ResolvedTheme) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private apply(): void {
    const root = document.documentElement;
    root.dataset.theme = this.resolved;
    root.dataset.themePref = this.pref;
    for (const l of this.listeners) l(this.pref, this.resolved);
  }
}

let shared: ThemeController | null = null;
/** the app's one theme controller (header button and CONFIG share it) */
export function getTheme(): ThemeController {
  return (shared ??= new ThemeController());
}
