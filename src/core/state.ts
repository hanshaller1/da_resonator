/** Snapshot format (presets) and migration from older formats. */
import { PARAMS } from '../shared/params';
import type { ModController } from './ModController';
import type { ParamStore } from './ParamStore';
import type { EngineSnapshot, StateProvider, Unsubscribe } from './types';

export const SNAPSHOT_VERSION = 2;

export function isSnapshot(s: unknown): s is EngineSnapshot {
  return !!s && typeof s === 'object' && (s as EngineSnapshot).format === 'da-resonator';
}

/**
 * Bring any supported input to the current format.
 * v1: flat { paramId: value } (resonator params only, no routes).
 * Params missing from the input fall back to their defaults.
 */
export function migrateSnapshot(input: unknown): EngineSnapshot {
  let src: Partial<EngineSnapshot>;
  if (isSnapshot(input)) src = input;
  else if (input && typeof input === 'object') src = { params: input as Record<string, number> };
  else throw new Error('not a resonator snapshot');
  const params: Record<string, number> = {};
  for (const p of PARAMS) {
    const v = src.params?.[p.id];
    params[p.id] = typeof v === 'number' && Number.isFinite(v) ? v : p.def;
  }
  return {
    format: 'da-resonator',
    version: SNAPSHOT_VERSION,
    params,
    routes: Array.isArray(src.routes) ? src.routes.filter((r) => r && typeof r.source === 'string' && typeof r.target === 'string') : [],
    triggers: Array.isArray(src.triggers) ? src.triggers.filter((t) => t && typeof t.source === 'string' && typeof t.target === 'string') : [],
    modules: src.modules && typeof src.modules === 'object' ? { ...src.modules } : {},
  };
}

/** Builds and restores snapshots from the param store, the routing and registered providers. */
export class StateHub {
  private providers = new Map<string, StateProvider>();

  constructor(
    private params: ParamStore,
    private mod: ModController,
  ) {}

  register(key: string, p: StateProvider): Unsubscribe {
    if (this.providers.has(key)) console.warn(`[state] provider "${key}" re-registered`);
    this.providers.set(key, p);
    return () => {
      if (this.providers.get(key) === p) this.providers.delete(key);
    };
  }

  get(): EngineSnapshot {
    const modules: Record<string, unknown> = {};
    for (const [k, p] of this.providers) modules[k] = p.getState();
    return {
      format: 'da-resonator',
      version: SNAPSHOT_VERSION,
      params: this.params.getState(),
      routes: this.mod.routes().map((r) => ({ slot: r.slot, source: r.source, target: r.target })),
      triggers: this.mod.triggerRoutes(),
      modules,
    };
  }

  set(input: unknown): void {
    const s = migrateSnapshot(input);
    this.params.setState(s.params);
    const dropped = this.mod.routing.load(s.routes, s.triggers);
    if (dropped.length) console.warn('[state] dropped invalid routes:', dropped);
    for (const [k, p] of this.providers) p.setState(s.modules[k]);
  }
}
