import { generateTheme, newSeed, type GeneratedTheme, type ThemeRange } from './themeGen';

/**
 * 'auto' = a generated theme (ui/themeGen.ts), new every time AUTO is picked: dark when picked
 * from DARK, light when picked from LIGHT, the same side again from AUTO. The header button only
 * rolls AUTO themes, of any brightness.
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
      const r = read(MODE_KEY);
      this.generated = generateTheme(seed >>> 0, r === 'light' || r === 'dark' ? r : 'any');
    }
    this.apply();
  }

  get resolved(): ResolvedTheme {
    return this.pref === 'auto' && this.generated ? this.generated.mode : this.pref === 'light' ? 'light' : 'dark';
  }

  /** header button: a new AUTO theme of any brightness, dark, dim, pale or light */
  roll(): void {
    this.generate('any');
  }

  /** picking 'auto' always makes a new theme, also when it is already selected: dark or light like the theme before */
  set(p: ThemePref): void {
    if (p === 'auto') return this.generate(this.resolved);
    this.pref = p;
    write(KEY, p);
    this.generated = null;
    this.apply();
  }

  private generate(range: ThemeRange): void {
    this.pref = 'auto';
    write(KEY, 'auto');
    this.generated = generateTheme(newSeed(), range);
    write(SEED_KEY, String(this.generated.seed));
    write(MODE_KEY, range);
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
