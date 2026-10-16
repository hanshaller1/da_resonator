/**
 * Preset session: which preset is loaded, whether the sound changed since,
 * A/B compare slots, stepping through the library, morphing to a preset. Talks to the engine only
 * through getState / setState, params, routes and change events, so it runs offline too.
 */
import { migrateSnapshot } from '../core/state';
import type { EngineSnapshot, Unsubscribe } from '../core/types';
import { INIT_PRESET_ID } from './factory';
import { DEFAULT_CATEGORY, cloneSnapshot, fileSlug, serializePresets, snapshotKey, type Preset } from './io';
import { Morph, type MorphEngine } from './morph';
import { PresetStore, openBestBackend } from './store';

/** the part of EngineAPI the session needs */
export interface PresetEngine extends MorphEngine {
  readonly params: MorphEngine['params'] & { subscribeAll(cb: (id: string, plain: number) => void): Unsubscribe };
  readonly mod: MorphEngine['mod'] & { onChange(cb: () => void): Unsubscribe };
  getState(): EngineSnapshot;
  setState(s: EngineSnapshot): void;
}

/** frame interval of a morph while nothing else drives it (ms) */
const MORPH_FRAME_MS = 15;

interface Morphing {
  morph: Morph;
  preset: Preset;
  t0: number;
  ms: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export type AbSlot = 'A' | 'B';

interface SlotContent {
  snapshot: EngineSnapshot;
  presetId: string | null;
  name: string;
  category: string;
  /** reference for the dirty check, null = no stored version */
  ref: string | null;
}

export interface ExportFile {
  fileName: string;
  text: string;
}

export class PresetSession {
  /** loaded preset (null after its deletion) */
  presetId: string | null;
  /** shown name; kept when the preset is deleted */
  name: string;
  category: string;
  /** sound differs from the loaded preset */
  dirty = false;
  ab: AbSlot = 'A';
  /** content of the inactive A/B slot (null until B is first used) */
  private other: SlotContent | null = null;
  private ref: string | null = null;
  private applying = false;
  private pending = false;
  private listeners = new Set<() => void>();
  private unsubs: Unsubscribe[] = [];
  private morphing: Morphing | null = null;

  constructor(
    readonly engine: PresetEngine,
    readonly store: PresetStore,
    initial: Preset | undefined = store.get(INIT_PRESET_ID) ?? store.factory[0],
    /** time base of morphs (ms) */
    private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  ) {
    this.presetId = initial?.id ?? null;
    this.name = initial?.name ?? 'Init';
    this.category = initial?.category ?? '';
    this.unsubs.push(
      engine.params.subscribeAll(() => this.schedule()),
      engine.mod.onChange(() => this.schedule()),
      store.onChange(() => this.syncFromStore()),
    );
    // the startup sound is the reference; taken once the UI has mounted and registered its state providers
    setTimeout(() => {
      if (this.ref === null && this.presetId !== null) this.ref = snapshotKey(engine.getState());
    }, 0);
  }

  dispose(): void {
    this.stopMorph();
    this.unsubs.forEach((u) => u());
    this.listeners.clear();
  }

  onChange(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  get preset(): Preset | undefined {
    return this.store.get(this.presetId);
  }
  /** a user preset is loaded, so Save can overwrite it */
  get canSave(): boolean {
    return !!this.preset && !this.preset.factory;
  }
  /** B (or A, once switched) holds something to compare against */
  get abInUse(): boolean {
    return this.other !== null;
  }

  /* ---- dirty tracking ---- */

  private schedule(): void {
    if (this.applying || this.pending) return;
    this.pending = true;
    // coalesce bursts (knob drags, preset loads) into one comparison
    queueMicrotask(() => {
      this.pending = false;
      this.check();
    });
  }

  /** compare the live sound with the loaded preset now */
  check(): void {
    if (this.ref === null && this.presetId !== null) return; // still starting up
    const d = this.ref === null || snapshotKey(this.engine.getState()) !== this.ref;
    if (d !== this.dirty) {
      this.dirty = d;
      this.emit();
    }
  }

  private apply(s: EngineSnapshot): void {
    this.applying = true;
    try {
      this.engine.setState(cloneSnapshot(s));
    } finally {
      this.applying = false;
    }
  }

  private setCurrent(p: { id: string | null; name: string; category: string }, ref: string | null): void {
    this.presetId = p.id;
    this.name = p.name;
    this.category = p.category;
    this.ref = ref;
    this.dirty = ref === null;
  }

  /** rename / delete in the library */
  private syncFromStore(): void {
    if (!this.presetId) return;
    const p = this.store.get(this.presetId);
    if (p) {
      if (p.name === this.name && p.category === this.category) return;
      this.name = p.name;
      this.category = p.category;
    } else {
      // deleted: the sound stays, but there is no stored version any more
      this.presetId = null;
      this.ref = null;
      this.dirty = true;
    }
    this.emit();
  }

  /* ---- library ---- */

  load(p: Preset): void {
    this.stopMorph();
    this.apply(p.snapshot);
    this.setCurrent(p, snapshotKey(this.engine.getState()));
    this.emit();
  }

  /* ---- morph ---- */

  /**
   * Glide from the live sound to preset `p` over `ms` (presets/morph.ts); at the end the preset is
   * loaded exactly. 0 ms loads at once. A load, step or new morph meanwhile takes over from where it is.
   */
  morphTo(p: Preset, ms: number): void {
    this.stopMorph();
    if (!(ms > 0)) return this.load(p);
    let morph: Morph;
    this.applying = true;
    try {
      morph = new Morph(this.engine, migrateSnapshot(cloneSnapshot(p.snapshot)));
    } finally {
      this.applying = false;
    }
    this.morphing = { morph, preset: p, t0: this.now(), ms, timer: null };
    // the name changes at once; the stored version is the reference from the end on
    this.setCurrent(p, null);
    this.dirty = false;
    this.emit();
    this.morphTick();
  }

  /** progress of a running morph (0..1), or -1 */
  get morphProgress(): number {
    const m = this.morphing;
    return m ? Math.min(1, (this.now() - m.t0) / m.ms) : -1;
  }

  /** the preset a running morph goes to */
  get morphTarget(): Preset | null {
    return this.morphing?.preset ?? null;
  }

  /**
   * Move a running morph to now. Its own timer calls this; the app also calls it at every modulation
   * readout, so a morph keeps going in a background tab where timers slow down.
   */
  morphTick(): void {
    const m = this.morphing;
    if (!m) return;
    if (m.timer !== null) clearTimeout(m.timer);
    m.timer = null;
    const k = (this.now() - m.t0) / m.ms;
    if (k >= 1) {
      this.morphing = null;
      this.load(m.preset);
      return;
    }
    this.applying = true;
    try {
      m.morph.at(k);
    } finally {
      this.applying = false;
    }
    m.timer = setTimeout(() => this.morphTick(), MORPH_FRAME_MS);
  }

  /** stop a running morph where it is (the sound stays) */
  stopMorph(): void {
    const m = this.morphing;
    if (!m) return;
    if (m.timer !== null) clearTimeout(m.timer);
    this.morphing = null;
    // what was reached is not the stored preset
    this.ref = null;
    this.dirty = true;
    this.emit();
  }

  /** previous / next preset in library order (wraps); returns the loaded preset */
  step(dir: 1 | -1): Preset | undefined {
    const list = this.store.list();
    if (!list.length) return undefined;
    const i = list.findIndex((p) => p.id === this.presetId);
    const next = i < 0 ? list[dir > 0 ? 0 : list.length - 1] : list[(i + dir + list.length) % list.length];
    this.load(next);
    return next;
  }

  /** overwrite the loaded user preset with the live sound; null if a factory preset is loaded */
  async save(): Promise<Preset | null> {
    if (!this.canSave || !this.presetId) return null;
    const snap = this.engine.getState();
    const p = await this.store.overwrite(this.presetId, snap);
    this.setCurrent(p, snapshotKey(snap));
    this.emit();
    return p;
  }

  async saveAs(name: string, category: string = DEFAULT_CATEGORY): Promise<Preset> {
    const snap = this.engine.getState();
    const p = await this.store.add(name, category, snap);
    this.setCurrent(p, snapshotKey(snap));
    this.emit();
    return p;
  }

  /* ---- A/B compare ---- */

  private capture(): SlotContent {
    return { snapshot: this.engine.getState(), presetId: this.presetId, name: this.name, category: this.category, ref: this.ref };
  }

  /** switch to slot A or B (default: the other one). B starts as a copy of A. */
  switchAb(slot: AbSlot = this.ab === 'A' ? 'B' : 'A'): void {
    if (slot === this.ab) return;
    this.stopMorph();
    const live = this.capture();
    const next = this.other ?? live;
    this.other = live;
    this.ab = slot;
    if (next !== live) this.apply(next.snapshot);
    this.setCurrent({ id: next.presetId, name: next.name, category: next.category }, next.ref);
    if (next.ref !== null) this.dirty = snapshotKey(this.engine.getState()) !== next.ref;
    this.syncFromStore();
    this.emit();
  }

  /** copy the live sound into the other slot */
  copyAb(): void {
    this.other = this.capture();
    this.emit();
  }

  /* ---- export ---- */

  /** the live sound under the loaded preset's name */
  exportCurrent(): ExportFile {
    const data = { name: this.name, category: this.category || DEFAULT_CATEGORY, created: this.preset?.created || Date.now(), snapshot: this.engine.getState() };
    return { fileName: `${fileSlug(this.name)}.resonator.json`, text: serializePresets([data]) };
  }

  exportAll(): ExportFile {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { fileName: `resonator-presets-${stamp}.json`, text: this.store.exportText() };
  }
}

const sessions = new WeakMap<object, PresetSession>();

/** the app-wide session for an engine (header bar and browser share it) */
export function presetSession(engine: PresetEngine): PresetSession {
  let s = sessions.get(engine);
  if (!s) sessions.set(engine, (s = new PresetSession(engine, new PresetStore(openBestBackend()))));
  return s;
}
