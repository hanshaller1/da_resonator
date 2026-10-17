import { generateTheme, newSeed, type GeneratedTheme } from './themeGen';

/**
 * 'auto' = a generated theme (ui/themeGen.ts), new every time AUTO is picked: light (brighter) when
 * picked from DARK, dark when picked from LIGHT, the same brightness when picked again from AUTO
 */
export type ThemePref = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'resonator.theme';
const SEED_KEY = 'resonator.themeSeed';
const MODE_KEY = 'resonator.themeMode';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; /* storage unavailable */
  }
}

function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Theme controller: dark by default; light/dark pin the hand-made themes, 'auto' applies a
 * generated theme (same one after a reload, a new one each time AUTO is picked).
 * Writes data-theme (the base the generated colours sit on) and data-theme-seed on <html>.
 */
export class ThemeController {
  pref: ThemePref = 'dark';
  /** the generated theme while pref === 'auto' */
  generated: GeneratedTheme | null = null;
  private listeners = new Set<(pref: ThemePref, resolved: ResolvedTheme) => void>();

  constructor() {
    const p = read(KEY);
    const seed = Number(read(SEED_KEY));
    if (p === 'light' || p === 'dark') this.pref = p;
    // 'auto' used to mean "follow the system"; without a stored seed it falls back to dark
    else if (p === 'auto' && read(SEED_KEY) !== null && Number.isFinite(seed)) {
      this.pref = 'auto';
      this.generated = generateTheme(seed >>> 0, read(MODE_KEY) === 'light' ? 'light' : 'dark');
    }
    this.apply();
  }

  get resolved(): ResolvedTheme {
    return this.pref === 'auto' && this.generated ? this.generated.mode : this.pref === 'light' ? 'light' : 'dark';
  }

  /** header button: DARK → AUTO (light) → LIGHT → AUTO (dark) → DARK */
  cycle(): void {
    if (this.pref !== 'auto') this.set('auto');
    else this.set(this.resolved);
  }

  /** picking 'auto' always makes a new theme, also when it is already selected */
  set(p: ThemePref): void {
    // from DARK brighter, from LIGHT darker, from AUTO the same brightness again
    const from = this.resolved;
    const flip = this.pref !== 'auto';
    this.pref = p;
    write(KEY, p);
    if (p === 'auto') {
      this.generated = generateTheme(newSeed(), flip ? (from === 'dark' ? 'light' : 'dark') : from);
      write(SEED_KEY, String(this.generated.seed));
      write(MODE_KEY, this.generated.mode);
    } else this.generated = null;
    this.apply();
  }

  onChange(cb: (pref: ThemePref, resolved: ResolvedTheme) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private apply(): void {
    const root = document.documentElement;
    for (const name of [...root.style].filter((n) => n.startsWith('--c-'))) root.style.removeProperty(name);
    if (this.generated) for (const [k, v] of Object.entries(this.generated.vars)) root.style.setProperty(k, v);
    root.dataset.theme = this.resolved;
    root.dataset.themePref = this.pref;
    if (this.generated) root.dataset.themeSeed = String(this.generated.seed);
    else delete root.dataset.themeSeed;
    for (const l of this.listeners) l(this.pref, this.resolved);
  }
}

let shared: ThemeController | null = null;
/** the app's one theme controller (header button and CONFIG share it) */
export function getTheme(): ThemeController {
  return (shared ??= new ThemeController());
}
