/**
 * Preset library: read-only factory presets plus user presets that persist in
 * IndexedDB, falling back to localStorage and then to memory. The published app
 * runs in a sandboxed iframe where any storage access may throw, so every access
 * is guarded and a failing backend is swapped for the next one at runtime.
 */
import type { EngineSnapshot, Unsubscribe } from '../core/types';
import { factoryPresets } from './factory';
import {
  CATEGORY_MAX,
  DEFAULT_CATEGORY,
  NAME_MAX,
  PresetImportError,
  cleanText,
  cloneSnapshot,
  parsePresetFile,
  sanitizeSnapshot,
  serializePresets,
  uniqueName,
  type Preset,
} from './io';

export type BackendKind = 'indexeddb' | 'localstorage' | 'memory';

export interface PresetBackend {
  readonly kind: BackendKind;
  loadAll(): Promise<unknown[]>;
  put(p: Preset): Promise<void>;
  remove(id: string): Promise<void>;
}

/* ---------- backends ---------- */

export function memoryBackend(seed: Preset[] = []): PresetBackend {
  const m = new Map(seed.map((p) => [p.id, p]));
  return {
    kind: 'memory',
    loadAll: async () => [...m.values()],
    put: async (p) => void m.set(p.id, p),
    remove: async (id) => void m.delete(id),
  };
}

const LS_KEY = 'resonator.presets.v1';

/** one JSON array under one key; throws right away when localStorage is unusable */
export function localStorageBackend(key = LS_KEY, storage?: Storage): PresetBackend {
  const ls = storage ?? (globalThis as { localStorage?: Storage }).localStorage; // the getter itself throws in sandboxes
  if (!ls) throw new Error('no localStorage');
  const probe = `${key}.probe`;
  ls.setItem(probe, '1');
  if (ls.getItem(probe) !== '1') throw new Error('localStorage does not keep values');
  ls.removeItem(probe);
  const read = (): Preset[] => {
    const raw = ls.getItem(key);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as Preset[]) : [];
    } catch {
      return [];
    }
  };
  return {
    kind: 'localstorage',
    loadAll: async () => read(),
    put: async (p) => {
      const all = read().filter((x) => x && x.id !== p.id);
      all.push(p);
      ls.setItem(key, JSON.stringify(all));
    },
    remove: async (id) => {
      ls.setItem(key, JSON.stringify(read().filter((x) => x && x.id !== id)));
    },
  };
}

const DB_NAME = 'da-resonator';
const DB_STORE = 'presets';

function idbRequest<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** rejects (instead of hanging) when IndexedDB is missing, blocked or slow to open */
export function indexedDbBackend(name = DB_NAME, timeoutMs = 2500): Promise<PresetBackend> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), timeoutMs);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    try {
      const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (!idb) throw new Error('no IndexedDB');
      const req = idb.open(name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => done(() => resolve(req.result));
      req.onerror = () => done(() => reject(req.error ?? new Error('IndexedDB open failed')));
      req.onblocked = () => done(() => reject(new Error('IndexedDB blocked')));
    } catch (err) {
      done(() => reject(err));
    }
  }).then((db) => {
    db.onversionchange = () => db.close();
    const store = (mode: IDBTransactionMode) => db.transaction(DB_STORE, mode).objectStore(DB_STORE);
    const write = (fn: (s: IDBObjectStore) => IDBRequest) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
      });
    const backend: PresetBackend = {
      kind: 'indexeddb',
      loadAll: () => idbRequest(store('readonly').getAll()),
      put: (p) => write((s) => s.put(p)),
      remove: (id) => write((s) => s.delete(id)),
    };
    return backend;
  });
}

/** best available backend: IndexedDB → localStorage → memory */
export async function openBestBackend(): Promise<PresetBackend> {
  try {
    const b = await indexedDbBackend();
    await b.loadAll(); // some sandboxes open fine but refuse transactions
    return b;
  } catch (err) {
    console.info('[presets] IndexedDB unavailable, trying localStorage:', err);
  }
  try {
    return localStorageBackend();
  } catch (err) {
    console.info('[presets] localStorage unavailable, presets last for this session only:', err);
  }
  return memoryBackend();
}

/* ---------- store ---------- */

export interface ImportOutcome {
  added: Preset[];
  warnings: string[];
  /** set when nothing could be imported */
  error?: string;
}

/** a stored record back into a preset (stored data may be old or damaged) */
function revive(rec: unknown): Preset | null {
  if (!rec || typeof rec !== 'object') return null;
  const r = rec as Partial<Preset>;
  if (typeof r.id !== 'string' || !r.id) return null;
  try {
    return {
      id: r.id,
      name: cleanText(r.name, NAME_MAX, 'Untitled'),
      category: cleanText(r.category, CATEGORY_MAX, DEFAULT_CATEGORY),
      created: typeof r.created === 'number' && Number.isFinite(r.created) ? r.created : Date.now(),
      snapshot: sanitizeSnapshot(r.snapshot),
    };
  } catch {
    return null;
  }
}

const byCategoryThenName = (a: Preset, b: Preset) =>
  a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

export class PresetStore {
  readonly factory: readonly Preset[];
  private users = new Map<string, Preset>();
  private backend: PresetBackend = memoryBackend();
  private listeners = new Set<() => void>();
  /** resolves once stored presets are loaded (writes wait for it) */
  readonly ready: Promise<void>;

  constructor(backend: PresetBackend | Promise<PresetBackend> = memoryBackend(), factory: readonly Preset[] = factoryPresets()) {
    this.factory = factory;
    this.ready = Promise.resolve(backend)
      .then(async (b) => {
        let records: unknown[] = [];
        try {
          records = await b.loadAll();
          this.backend = b;
        } catch (err) {
          console.warn('[presets] could not read stored presets:', err);
          await this.degrade(b.kind);
          return;
        }
        for (const rec of Array.isArray(records) ? records : []) {
          const p = revive(rec);
          if (p && !this.users.has(p.id)) this.users.set(p.id, p);
        }
      })
      .catch(async (err) => {
        console.warn('[presets] storage failed to open:', err);
        await this.degrade('indexeddb');
      })
      .finally(() => this.emit());
  }

  /** where user presets live right now */
  get storage(): BackendKind {
    return this.backend.kind;
  }
  get persistent(): boolean {
    return this.backend.kind !== 'memory';
  }

  onChange(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /** factory presets in their defined order, then user presets by category and name */
  list(): Preset[] {
    return [...this.factory, ...this.userPresets()];
  }
  userPresets(): Preset[] {
    return [...this.users.values()].sort(byCategoryThenName);
  }
  get(id: string | null | undefined): Preset | undefined {
    if (!id) return undefined;
    return this.users.get(id) ?? this.factory.find((p) => p.id === id);
  }
  /** user categories, sorted */
  categories(): string[] {
    return [...new Set(this.userPresets().map((p) => p.category))];
  }

  private newId(): string {
    let id: string;
    do id = `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    while (this.users.has(id));
    return id;
  }

  /** names already used in a category (user presets) */
  private namesIn(category: string, except?: string): string[] {
    const c = category.toLowerCase();
    return [...this.users.values()].filter((p) => p.id !== except && p.category.toLowerCase() === c).map((p) => p.name);
  }

  async add(name: string, category: string, snapshot: EngineSnapshot, created = Date.now()): Promise<Preset> {
    const cat = cleanText(category, CATEGORY_MAX, DEFAULT_CATEGORY);
    const p: Preset = { id: this.newId(), name: uniqueName(cleanText(name, NAME_MAX, 'Untitled'), this.namesIn(cat)), category: cat, created, snapshot: cloneSnapshot(snapshot) };
    this.users.set(p.id, p);
    this.emit();
    await this.persist((b) => b.put(p));
    return p;
  }

  /** replace a user preset's sound (name and category stay) */
  async overwrite(id: string, snapshot: EngineSnapshot): Promise<Preset> {
    const old = this.users.get(id);
    if (!old) throw new Error('only user presets can be overwritten');
    const p = { ...old, snapshot: cloneSnapshot(snapshot) };
    this.users.set(id, p);
    this.emit();
    await this.persist((b) => b.put(p));
    return p;
  }

  async rename(id: string, name: string, category?: string): Promise<Preset> {
    const old = this.users.get(id);
    if (!old) throw new Error('only user presets can be renamed');
    const cat = category === undefined ? old.category : cleanText(category, CATEGORY_MAX, DEFAULT_CATEGORY);
    const p = { ...old, category: cat, name: uniqueName(cleanText(name, NAME_MAX, old.name), this.namesIn(cat, id)) };
    this.users.set(id, p);
    this.emit();
    await this.persist((b) => b.put(p));
    return p;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.users.delete(id)) return false;
    this.emit();
    await this.persist((b) => b.remove(id));
    return true;
  }

  /** import a preset file's text; never throws */
  async importText(text: unknown, fileName = ''): Promise<ImportOutcome> {
    let parsed;
    try {
      parsed = parsePresetFile(text, fileName);
    } catch (err) {
      return { added: [], warnings: [], error: err instanceof PresetImportError ? err.message : 'The file could not be read.' };
    }
    await this.ready;
    const added: Preset[] = [];
    for (const d of parsed.presets) {
      const cat = cleanText(d.category, CATEGORY_MAX, DEFAULT_CATEGORY);
      const p: Preset = { id: this.newId(), name: uniqueName(d.name, this.namesIn(cat)), category: cat, created: d.created, snapshot: d.snapshot };
      this.users.set(p.id, p);
      added.push(p);
    }
    this.emit();
    for (const p of added) await this.persist((b) => b.put(p));
    return { added, warnings: parsed.warnings };
  }

  /** file text for the given presets (factory ones allowed), or all user presets */
  exportText(ids?: readonly string[]): string {
    const list = ids ? ids.map((id) => this.get(id)).filter((p): p is Preset => !!p) : this.userPresets();
    return serializePresets(list);
  }

  /* ---- persistence with runtime fallback ---- */

  private async persist(op: (b: PresetBackend) => Promise<void>): Promise<void> {
    await this.ready;
    try {
      await op(this.backend);
    } catch (err) {
      console.warn(`[presets] ${this.backend.kind} write failed:`, err);
      await this.degrade(this.backend.kind);
    }
  }

  /** move every user preset to the next backend down the chain */
  private async degrade(from: BackendKind): Promise<void> {
    const chain: (() => PresetBackend)[] = from === 'indexeddb' ? [() => localStorageBackend(), () => memoryBackend()] : [() => memoryBackend()];
    for (const make of chain) {
      try {
        const b = make();
        if (b.kind !== 'memory') {
          // keep what that backend already holds (e.g. presets saved there in an earlier session)
          for (const rec of await b.loadAll()) {
            const p = revive(rec);
            if (p && !this.users.has(p.id)) this.users.set(p.id, p);
          }
        }
        for (const p of this.users.values()) await b.put(p);
        this.backend = b;
        this.emit();
        return;
      } catch (err) {
        console.warn('[presets] fallback storage failed:', err);
      }
    }
  }
}
