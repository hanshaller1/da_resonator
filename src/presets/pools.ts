/**
 * Pools (docs/hardware-modi-und-pools-2026-10-16.md, point 8A): named, ordered lists of presets,
 * played one after the other from PLAY/LOAD (presets/player.ts). A preset may sit in several pools
 * and several times in one. Each pool keeps how it is played: direction, how it advances (by hand,
 * every N bars of a clock, or by a learned MIDI note / CC), the morph time and whether advancing
 * morphs. Pools are remembered in the browser (`localStorage` `resonator.pools`) and can be saved as
 * a file. Entries keep the preset's name too, so a pool file finds user presets on another computer
 * by name. Pure (no DOM): the offline tests run it.
 */
import { Emitter } from '../core/Emitter';
import type { StorageLike } from '../core/inputs';
import type { Unsubscribe } from '../core/types';
import { NAME_MAX, cleanText } from './io';

const STORE_KEY = 'resonator.pools';
export const POOL_FILE_FORMAT = 'da-resonator-pools';
export const POOL_FILE_VERSION = 1;
export const MAX_POOLS = 64;
export const MAX_ENTRIES = 128;

export const POOL_DIRS = ['up', 'down', 'pingpong', 'random'] as const;
export type PoolDir = (typeof POOL_DIRS)[number];
export const POOL_DIR_LABELS: Record<PoolDir, string> = { up: 'Up', down: 'Down', pingpong: 'Ping-Pong', random: 'Random' };
/** HAND: STEP only · CLOCK: also every N bars · MIDI: also a learned note or CC */
export const POOL_ADVANCES = ['hand', 'clock', 'midi'] as const;
export type PoolAdvance = (typeof POOL_ADVANCES)[number];
export const POOL_BARS = [1, 2, 4, 8, 16] as const;
export type MorphUnit = 'ms' | 'beats';
export const MORPH_MS_MAX = 20000;
export const MORPH_BEATS_MAX = 64;

export interface PoolEntry {
  /** preset id ('factory:…' or a user id) */
  id: string;
  /** its name when it was added (shown if the preset is gone, matched when a file is imported) */
  name: string;
}

export interface PoolSettings {
  dir: PoolDir;
  advance: PoolAdvance;
  /** the clock of CLOCK advance (the other one stands in while it is off) */
  clock: 'int' | 'midi';
  /** CLOCK advance: every this many bars (4 beats) */
  bars: number;
  /** morph time, in ms or beats */
  morph: number;
  morphUnit: MorphUnit;
  /** advancing by clock, MIDI or Program Change morphs (STEP and STEP+MORPH choose themselves) */
  autoMorph: boolean;
}

export interface Pool extends PoolSettings {
  id: string;
  name: string;
  entries: PoolEntry[];
}

export const DEFAULT_POOL_SETTINGS: PoolSettings = { dir: 'up', advance: 'hand', clock: 'int', bars: 4, morph: 2000, morphUnit: 'ms', autoMorph: false };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);

/** morph time clamped to its unit */
export function clampMorph(v: number, unit: MorphUnit): number {
  if (!Number.isFinite(v)) return unit === 'ms' ? DEFAULT_POOL_SETTINGS.morph : 4;
  return unit === 'ms' ? Math.round(Math.min(MORPH_MS_MAX, Math.max(0, v))) : Math.round(Math.min(MORPH_BEATS_MAX, Math.max(0, v)) * 4) / 4;
}

/** settings from stored or imported data, defaults for anything missing or odd */
export function cleanSettings(s: Obj): PoolSettings {
  const d = DEFAULT_POOL_SETTINGS;
  const morphUnit = oneOf(s.morphUnit, ['ms', 'beats'] as const, d.morphUnit);
  return {
    dir: oneOf(s.dir, POOL_DIRS, d.dir),
    advance: oneOf(s.advance, POOL_ADVANCES, d.advance),
    clock: oneOf(s.clock, ['int', 'midi'] as const, d.clock),
    bars: POOL_BARS.includes(s.bars as (typeof POOL_BARS)[number]) ? (s.bars as number) : d.bars,
    morph: clampMorph(typeof s.morph === 'number' ? s.morph : morphUnit === 'ms' ? d.morph : 4, morphUnit),
    morphUnit,
    autoMorph: typeof s.autoMorph === 'boolean' ? s.autoMorph : d.autoMorph,
  };
}

function cleanEntries(v: unknown): PoolEntry[] {
  if (!Array.isArray(v)) return [];
  const out: PoolEntry[] = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id) continue;
    out.push({ id: e.id.slice(0, 64), name: cleanText(e.name, NAME_MAX, 'Preset') });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export class PoolStore {
  private list: Pool[] = [];
  private sel = '';
  private changeE = new Emitter<[]>();
  private seq = 0;

  constructor(private storage?: StorageLike) {
    this.load();
    if (!this.list.length) this.list.push(this.make('Pool 1'));
    if (!this.get(this.sel)) this.sel = this.list[0].id;
  }

  onChange(cb: () => void): Unsubscribe {
    return this.changeE.on(cb);
  }

  pools(): readonly Pool[] {
    return this.list;
  }
  get(id: string): Pool | undefined {
    return this.list.find((p) => p.id === id);
  }
  /** the pool shown in PLAY/LOAD (and played) */
  get selected(): Pool {
    return this.get(this.sel) ?? this.list[0];
  }
  select(id: string): void {
    if (id === this.sel || !this.get(id)) return;
    this.sel = id;
    this.save();
  }

  private newId(): string {
    let id: string;
    do id = `pool_${Date.now().toString(36)}${(this.seq++).toString(36)}`;
    while (this.get(id));
    return id;
  }

  private make(name: string, settings: PoolSettings = DEFAULT_POOL_SETTINGS, entries: PoolEntry[] = []): Pool {
    return { id: this.newId(), name, entries, ...settings };
  }

  /** a free name like "Pool 3" or "Live 2" */
  private freeName(base: string): string {
    const names = new Set(this.list.map((p) => p.name));
    if (!names.has(base)) return base;
    const stem = base.replace(/\s+\d+$/, '');
    for (let n = 2; ; n++) if (!names.has(`${stem} ${n}`)) return `${stem} ${n}`;
  }

  /** a new empty pool, selected; null at MAX_POOLS */
  add(name = ''): Pool | null {
    if (this.list.length >= MAX_POOLS) return null;
    const p = this.make(this.freeName(cleanText(name, NAME_MAX, '') || `Pool ${this.list.length + 1}`));
    this.list.push(p);
    this.sel = p.id;
    this.save();
    return p;
  }

  rename(id: string, name: string): void {
    const p = this.get(id);
    const n = cleanText(name, NAME_MAX, '');
    if (!p || !n || n === p.name) return;
    p.name = n;
    this.save();
  }

  /** delete a pool; the last one is emptied instead */
  remove(id: string): void {
    const i = this.list.findIndex((p) => p.id === id);
    if (i < 0) return;
    if (this.list.length === 1) {
      this.list[0].entries = [];
    } else {
      this.list.splice(i, 1);
      if (this.sel === id) this.sel = this.list[Math.min(i, this.list.length - 1)].id;
    }
    this.save();
  }

  update(id: string, patch: Partial<PoolSettings>): void {
    const p = this.get(id);
    if (!p) return;
    const merged: Obj = { ...p };
    for (const [k, v] of Object.entries(patch)) {
      // an odd value comes back as the default: the old one stays then (a morph time is clamped)
      const one = cleanSettings({ ...p, [k]: v }) as unknown as Obj;
      if (k === 'morph' || one[k] === v) merged[k] = one[k];
    }
    const next = cleanSettings(merged);
    // switching the unit keeps a sensible time (2000 ms ↔ 4 beats)
    if (next.morphUnit !== p.morphUnit && patch.morph === undefined) next.morph = next.morphUnit === 'ms' ? DEFAULT_POOL_SETTINGS.morph : 4;
    if ((Object.keys(next) as (keyof PoolSettings)[]).every((k) => next[k] === p[k])) return;
    Object.assign(p, next);
    this.save();
  }

  /** add a preset (at the end, or before index `at`); false when the pool is full */
  addEntry(id: string, preset: { id: string; name: string }, at?: number): boolean {
    const p = this.get(id);
    if (!p || p.entries.length >= MAX_ENTRIES) return false;
    const e = { id: preset.id, name: cleanText(preset.name, NAME_MAX, 'Preset') };
    if (at === undefined || at < 0 || at >= p.entries.length) p.entries.push(e);
    else p.entries.splice(at, 0, e);
    this.save();
    return true;
  }

  removeEntry(id: string, index: number): void {
    const p = this.get(id);
    if (!p || index < 0 || index >= p.entries.length) return;
    p.entries.splice(index, 1);
    this.save();
  }

  /** move entry `from` so it ends up at index `to` */
  moveEntry(id: string, from: number, to: number): void {
    const p = this.get(id);
    if (!p || from < 0 || from >= p.entries.length) return;
    const t = Math.max(0, Math.min(p.entries.length - 1, to));
    if (t === from) return;
    const [e] = p.entries.splice(from, 1);
    p.entries.splice(t, 0, e);
    this.save();
  }

  /** keep the stored names of entries in step with the library (renamed presets) */
  syncNames(nameOf: (id: string) => string | undefined): void {
    let changed = false;
    for (const p of this.list)
      for (const e of p.entries) {
        const n = nameOf(e.id);
        if (n && n !== e.name) {
          e.name = n;
          changed = true;
        }
      }
    if (changed) this.save();
  }

  /* ---------- file ---------- */

  exportText(): string {
    const pools = this.list.map(({ id: _id, ...rest }) => rest);
    return JSON.stringify({ format: POOL_FILE_FORMAT, version: POOL_FILE_VERSION, pools }, null, 2);
  }

  /**
   * Add the pools of a pool file. Entries are matched to the library by id, else by name (user
   * presets have other ids on another computer); entries found by neither are kept and shown missing.
   * A name that exists already gets a number.
   */
  importText(text: string, library: readonly { id: string; name: string }[]): { ok: true; count: number; missing: number } | { ok: false; reason: string } {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'This is not a pool file (no valid JSON).' };
    }
    if (!isObj(data) || data.format !== POOL_FILE_FORMAT || !Array.isArray(data.pools)) return { ok: false, reason: 'This is not a pool file.' };
    const byId = new Set(library.map((p) => p.id));
    const byName = new Map<string, string>();
    for (const p of library) if (!byName.has(p.name)) byName.set(p.name, p.id);
    let count = 0;
    let missing = 0;
    for (const raw of data.pools) {
      if (!isObj(raw) || this.list.length >= MAX_POOLS) continue;
      const entries = cleanEntries(raw.entries).map((e) => {
        if (byId.has(e.id)) return e;
        const id = byName.get(e.name);
        if (id) return { id, name: e.name };
        missing++;
        return e;
      });
      const p = this.make(this.freeName(cleanText(raw.name, NAME_MAX, `Pool ${this.list.length + 1}`)), cleanSettings(raw), entries);
      this.list.push(p);
      if (!count) this.sel = p.id;
      count++;
    }
    if (!count) return { ok: false, reason: 'The file holds no pools.' };
    this.save();
    return { ok: true, count, missing };
  }

  /* ---------- storage ---------- */

  private load(): void {
    try {
      const s = JSON.parse(this.storage?.getItem(STORE_KEY) ?? 'null') as unknown;
      if (!isObj(s) || !Array.isArray(s.pools)) return;
      for (const raw of s.pools) {
        if (!isObj(raw) || this.list.length >= MAX_POOLS) continue;
        const id = typeof raw.id === 'string' && raw.id && !this.get(raw.id) ? raw.id : this.newId();
        this.list.push({ id, name: cleanText(raw.name, NAME_MAX, `Pool ${this.list.length + 1}`), entries: cleanEntries(raw.entries), ...cleanSettings(raw) });
      }
      if (typeof s.selected === 'string') this.sel = s.selected;
    } catch {
      /* storage unavailable or broken: start empty */
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify({ selected: this.sel, pools: this.list }));
    } catch {
      /* not persisted */
    }
    this.changeE.emit();
  }
}
