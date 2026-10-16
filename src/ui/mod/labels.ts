/**
 * Display names for modulation sources and targets, shared by the mod matrix, popovers,
 * chips and the macros panel. DOM-free so the offline tests can import it.
 */
import { Emitter } from '../../core/Emitter';
import type { RouteCheck, RouteInfo, Unsubscribe } from '../../core/types';
import { NUM_MACROS } from '../../shared/paramdefs/modules';
import { SOURCES, SOURCE_BY_ID, type ModSourceSpec } from '../../shared/mod/sources';
import { PARAMS, PARAM_BY_ID, type ParamSpec } from '../../shared/params';

/* ---------- source names (macros can be renamed) ---------- */

const custom = new Map<string, string>();
const namesChanged = new Emitter<[]>();

export function sourceLabel(id: string): string {
  return custom.get(id) ?? SOURCE_BY_ID[id]?.label ?? id;
}

/** rename a source for display; null / empty / the default name clears the override */
export function setSourceName(id: string, name: string | null): void {
  const def = SOURCE_BY_ID[id]?.label ?? id;
  const n = name?.trim() || null;
  const prev = custom.get(id) ?? null;
  const next = n && n !== def ? n : null;
  if (prev === next) return;
  if (next) custom.set(id, next);
  else custom.delete(id);
  namesChanged.emit();
}

export function onSourceNames(cb: () => void): Unsubscribe {
  return namesChanged.on(cb);
}

export const SOURCE_GROUPS: { label: string; cls: ModSourceSpec['cls'] }[] = [
  { label: 'Macros', cls: 'macro' },
  { label: 'LFOs', cls: 'lfo' },
  { label: 'Clock Mods', cls: 'cmod' },
  { label: 'Env Followers', cls: 'ef' },
  { label: 'Band Gain Reduction', cls: 'dyn' },
];

export function sourcesOf(cls: ModSourceSpec['cls']): ModSourceSpec[] {
  return SOURCES.filter((s) => s.cls === cls);
}

/* ---------- macro names in snapshots ---------- */

export const MACRO_NAME_MAX = 24;
export const defaultMacroName = (n: number) => `Macro ${n}`;

/** validate the 'macros' snapshot entry; anything unusable falls back to the default names */
export function parseMacroNames(s: unknown): string[] {
  const raw = s && typeof s === 'object' && Array.isArray((s as { names?: unknown }).names) ? (s as { names: unknown[] }).names : [];
  const out: string[] = [];
  for (let i = 0; i < NUM_MACROS; i++) {
    const v = raw[i];
    const t = typeof v === 'string' ? v.trim().slice(0, MACRO_NAME_MAX) : '';
    out.push(t || defaultMacroName(i + 1));
  }
  return out;
}

/* ---------- targets ---------- */

/** minimal routing view (ModAPI and the shared ModRouting both fit) */
export interface RouteSource {
  routes(): RouteInfo[];
  canRoute(source: string, target: string): RouteCheck;
}

const MODULE_TITLES: Record<string, string> = {
  resonator: 'Resonator',
  dyn: 'Band Dynamics',
  filterPre: 'Pre Filter',
  filterPost: 'Post Filter',
  filterBand: 'Band Filter',
  scan: 'Band Scanner',
  clock: 'Clock',
};

/** group heading for a target param ('Band 3', 'LFO 2', 'Route depths' …) */
export function targetGroup(spec: ParamSpec): string {
  if (spec.group === 'band' && spec.band !== undefined) return `Band ${spec.band + 1}`;
  if (spec.modClass === 'route') return 'Route depths';
  const m = /^(lfo|cmod|ef|macro)(\d+)$/.exec(spec.module);
  if (m) return `${{ lfo: 'LFO', cmod: 'Clock Mod', ef: 'Env Follower', macro: 'Macro' }[m[1]]} ${m[2]}`;
  return MODULE_TITLES[spec.module] ?? spec.module;
}

/** readable name of a target param; route depths name their route ('Depth LFO 1 → Band 3 Resonance') */
export function targetLabel(id: string, routes?: RouteInfo[]): string {
  const spec = PARAM_BY_ID[id];
  if (!spec) return id;
  if (spec.group === 'band' && spec.band !== undefined) return `Band ${spec.band + 1} ${spec.label}`;
  if (spec.modClass === 'route' && routes) {
    const r = routes.find((x) => x.depthParam === id);
    if (r) return `Depth ${sourceLabel(r.source)} → ${targetLabel(r.target)}`;
  }
  if (/^macro\d+\.value$/.test(id)) return sourceLabel(spec.module);
  return spec.label;
}

export interface TargetOption {
  id: string;
  label: string;
  /** null = allowed */
  reason: string | null;
}
export interface TargetGroup {
  label: string;
  options: TargetOption[];
}

/**
 * Every param a route could aim at, grouped by module, with the reason when `source` may not
 * modulate it. Toggles and macros are left out (never modulatable); of the 64 route depths only
 * those of existing routes are listed.
 */
export function targetGroups(mod: RouteSource, source: string): TargetGroup[] {
  const routes = mod.routes();
  const live = new Set(routes.map((r) => r.depthParam));
  const groups = new Map<string, TargetGroup>();
  for (const p of PARAMS) {
    if (!p.modulatable || p.curve === 'toggle') continue;
    if (p.modClass === 'route' && !live.has(p.id)) continue;
    const g = targetGroup(p);
    let grp = groups.get(g);
    if (!grp) groups.set(g, (grp = { label: g, options: [] }));
    const c = mod.canRoute(source, p.id);
    grp.options.push({ id: p.id, label: targetLabel(p.id, routes), reason: c.ok ? null : c.reason });
  }
  return [...groups.values()];
}

/** is the source currently swinging both ways? (LFO / clock mod can be switched with their `uni` param) */
export function sourceBipolar(source: string, getParam: (id: string) => number): boolean {
  const uni = PARAM_BY_ID[`${source}.uni`];
  if (uni) return getParam(uni.id) < 0.5;
  return SOURCE_BY_ID[source]?.bipolar ?? false;
}

/** normalized range a route of `depth` sweeps around `norm` */
export function depthRange(norm: number, depth: number, bipolar: boolean): [number, number] {
  const c = (x: number) => Math.min(1, Math.max(0, x));
  if (bipolar) return [c(norm - Math.abs(depth)), c(norm + Math.abs(depth))];
  return [c(Math.min(norm, norm + depth)), c(Math.max(norm, norm + depth))];
}

export function formatDepth(d: number): string {
  const p = Math.round(d * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`;
}
