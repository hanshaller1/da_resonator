/** Snapshot format (presets) and migration from older formats. */
import { FB_ALL_LOOP_MAX, FB_ALL_LOOP_MAX_V2, NUM_BANDS, PARAMS, RES_DEFAULT_V2, bandParamId, dbToGain, feedbackTapGain, resToQ } from '../shared/params';
import type { ModController } from './ModController';
import type { ParamStore } from './ParamStore';
import type { EngineSnapshot, StateProvider, Unsubscribe } from './types';

export const SNAPSHOT_VERSION = 3;

export function isSnapshot(s: unknown): s is EngineSnapshot {
  return !!s && typeof s === 'object' && (s as EngineSnapshot).format === 'da-resonator';
}

/**
 * Bring any supported input to the current format.
 * v1: flat { paramId: value } (resonator params only, no routes).
 * v2: before the DSP walkthrough of 2026-10-16 (narrow default bands, old Feedback All scale).
 * Params missing from the input fall back to the defaults of its version.
 */
export function migrateSnapshot(input: unknown): EngineSnapshot {
  let src: Partial<EngineSnapshot>;
  let version: number;
  if (isSnapshot(input)) {
    src = input;
    version = typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : SNAPSHOT_VERSION;
  } else if (input && typeof input === 'object') {
    src = { params: input as Record<string, number> };
    version = 1;
  } else throw new Error('not a resonator snapshot');
  const params: Record<string, number> = {};
  const old = version < 3;
  for (const p of PARAMS) {
    const v = src.params?.[p.id];
    const def = old && p.group === 'band' && p.id.endsWith('.res') ? RES_DEFAULT_V2 : p.def;
    params[p.id] = typeof v === 'number' && Number.isFinite(v) ? v : def;
  }
  const routes = Array.isArray(src.routes) ? src.routes.filter((r) => r && typeof r.source === 'string' && typeof r.target === 'string') : [];
  if (old) migrateFbAllV2(params, routes);
  return {
    format: 'da-resonator',
    version: SNAPSHOT_VERSION,
    params,
    routes,
    triggers: Array.isArray(src.triggers) ? src.triggers.filter((t) => t && typeof t.source === 'string' && typeof t.target === 'string') : [],
    modules: src.modules && typeof src.modules === 'object' ? { ...src.modules } : {},
  };
}

/**
 * v2 → v3: Feedback All has a new scale and its tap takes broad bands at their compensated level.
 * The amount (and the depth of routes onto it) is converted so the stored loop gain stays the same.
 */
function migrateFbAllV2(params: Record<string, number>, routes: EngineSnapshot['routes']): void {
  // tap level of the bands, weighted by their fader gain (the loop sums the bands after the faders)
  let num = 0;
  let den = 0;
  const off = params.resOffset ?? 0;
  for (let b = 0; b < NUM_BANDS; b++) {
    const a = dbToGain(params[bandParamId(b, 'gain')]);
    num += a * feedbackTapGain(resToQ(params[bandParamId(b, 'res')] + off));
    den += a;
  }
  const tap = den > 0 ? num / den : 1;
  const k = FB_ALL_LOOP_MAX_V2 / (FB_ALL_LOOP_MAX * tap);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  params.fbAll = clamp(params.fbAll * k, 0, 1);
  for (const r of routes) {
    const id = `route${r.slot}.depth`;
    if (r.target === 'fbAll' && typeof params[id] === 'number') params[id] = clamp(params[id] * k, -1, 1);
  }
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
