/**
 * Preset data: validation, migration and the JSON file format.
 * Pure (no DOM, no storage) so the offline tests can run it.
 */
import { isSnapshot, migrateSnapshot } from '../core/state';
import type { EngineSnapshot, TriggerRouteInfo } from '../core/types';
import { ModRouting, routeDepthId } from '../shared/mod/routing';
import { ROUTE_CHANNELS, type RouteChannel } from '../shared/mod/rules';
import { NUM_ROUTES } from '../shared/paramdefs/modules';
import { PARAM_BY_ID, type ParamSpec } from '../shared/params';

export const PRESET_FILE_FORMAT = 'da-resonator-presets';
export const PRESET_FILE_VERSION = 1;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT = 500;
export const NAME_MAX = 48;
export const CATEGORY_MAX = 24;
export const DEFAULT_CATEGORY = 'User';
export const IMPORT_CATEGORY = 'Imported';

export interface PresetData {
  name: string;
  category: string;
  /** ms since epoch (0 for factory presets) */
  created: number;
  snapshot: EngineSnapshot;
}

export interface Preset extends PresetData {
  id: string;
  /** factory presets are read-only */
  factory?: boolean;
}

/** a file or record we can't use; the message is shown to the user */
export class PresetImportError extends Error {}

export interface SanitizeReport {
  unknownParams: string[];
  invalidParams: string[];
  clamped: number;
  droppedRoutes: string[];
}

export const newReport = (): SanitizeReport => ({ unknownParams: [], invalidParams: [], clamped: 0, droppedRoutes: [] });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** printable single-line text, trimmed to `max` chars, or the fallback */
export function cleanText(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || fallback;
}

/** same rules as ParamStore.set, so a stored preset equals what the engine ends up with */
export function clampParam(spec: ParamSpec, v: number): number {
  if (spec.curve === 'toggle') return v >= 0.5 ? 1 : 0;
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return spec.curve === 'discrete' ? Math.round(c) : c;
}

/**
 * Give every route a unique slot (its depth lives in param `route{slot}.depth`).
 * Routes without a usable slot move to a free one and take their depth along.
 */
function assignSlots(list: { slot?: unknown; source: string; target: string; ch?: unknown }[], params: Record<string, number>, report: SanitizeReport) {
  const valid = (s: unknown): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < NUM_ROUTES;
  const taken = new Set<number>();
  const slots: (number | null)[] = list.map((r) => {
    if (valid(r.slot) && !taken.has(r.slot)) {
      taken.add(r.slot);
      return r.slot;
    }
    return null;
  });
  const out: { slot: number; source: string; target: string; ch?: RouteChannel }[] = [];
  list.forEach((r, i) => {
    let slot = slots[i];
    if (slot === null) {
      slot = 0;
      while (taken.has(slot)) slot++;
      if (slot >= NUM_ROUTES) {
        report.droppedRoutes.push(`${r.source} → ${r.target}`);
        return;
      }
      taken.add(slot);
      const from = valid(r.slot) ? params[routeDepthId(r.slot)] : undefined;
      params[routeDepthId(slot)] = from ?? 0.5;
    }
    const ch = ROUTE_CHANNELS.find((c) => c === r.ch);
    out.push(ch ? { slot, source: r.source, target: r.target, ch } : { slot, source: r.source, target: r.target });
  });
  return out;
}

/**
 * Validate and migrate anything that claims to be a snapshot: v2, a partial v2
 * ({ params, routes … } without `format`) or v1 (flat { paramId: value }).
 * Unknown params are ignored, values clamped, unknown / looping routes dropped.
 * Throws PresetImportError when nothing usable is left.
 */
export function sanitizeSnapshot(input: unknown, report: SanitizeReport = newReport()): EngineSnapshot {
  if (!isObj(input)) throw new PresetImportError('not a resonator snapshot');
  const structured = isSnapshot(input) || isObj(input.params);
  const rawParams: Obj = structured ? (isObj(input.params) ? input.params : {}) : input;

  const params: Record<string, number> = {};
  let known = 0;
  for (const [id, v] of Object.entries(rawParams)) {
    const spec = PARAM_BY_ID[id];
    if (!spec) {
      report.unknownParams.push(id);
      continue;
    }
    known++;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      report.invalidParams.push(id);
      continue;
    }
    const c = clampParam(spec, v);
    if (c !== v) report.clamped++;
    params[id] = c;
  }
  if (!structured && known === 0) throw new PresetImportError('no resonator parameters found');

  const shapeOk = (r: unknown): r is { slot?: unknown; source: string; target: string; ch?: unknown } =>
    isObj(r) && typeof r.source === 'string' && typeof r.target === 'string';
  const rawRoutes = structured && Array.isArray(input.routes) ? input.routes : [];
  const rawTrig = structured && Array.isArray(input.triggers) ? input.triggers : [];
  const badShapes = rawRoutes.filter((r) => !shapeOk(r)).length + rawTrig.filter((t) => !shapeOk(t)).length;
  for (let i = 0; i < badShapes; i++) report.droppedRoutes.push('(malformed route)');

  const routesIn = assignSlots(rawRoutes.filter(shapeOk), params, report);
  const trigIn: TriggerRouteInfo[] = rawTrig.filter(shapeOk).map((t) => ({ source: t.source, target: t.target }));
  // the same loader the engine uses: unknown ports and anything that would close a loop are dropped
  const routing = new ModRouting();
  report.droppedRoutes.push(...routing.load(routesIn, trigIn));

  let modules: Record<string, unknown> = {};
  if (structured && isObj(input.modules)) {
    try {
      modules = JSON.parse(JSON.stringify(input.modules)) as Record<string, unknown>;
    } catch {
      modules = {};
    }
  }

  return migrateSnapshot({
    format: 'da-resonator',
    // the version of the input decides how missing params and old scales are read (flat v1 = 1)
    version: structured ? (typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : 2) : 1,
    params,
    routes: routing.routes().map((r) => (r.ch === 'LR' ? { slot: r.slot, source: r.source, target: r.target } : { slot: r.slot, source: r.source, target: r.target, ch: r.ch })),
    triggers: routing.triggerRoutes(),
    modules,
  });
}

/** plain JSON copy (drops anything structured clone or JSON can't carry) */
export function cloneSnapshot(s: EngineSnapshot): EngineSnapshot {
  return JSON.parse(JSON.stringify(s)) as EngineSnapshot;
}

/** stable string form of a snapshot, for "changed since load" checks */
export function snapshotKey(s: EngineSnapshot): string {
  return JSON.stringify(s);
}

/* ---------- files ---------- */

export interface PresetFile {
  format: typeof PRESET_FILE_FORMAT;
  version: number;
  exported?: string;
  presets: PresetData[];
}

export function serializePresets(list: readonly PresetData[], now = new Date()): string {
  const file: PresetFile = {
    format: PRESET_FILE_FORMAT,
    version: PRESET_FILE_VERSION,
    exported: now.toISOString(),
    presets: list.map((p) => ({ name: p.name, category: p.category, created: p.created, snapshot: p.snapshot })),
  };
  return JSON.stringify(file, null, 1);
}

export interface ParsedFile {
  presets: PresetData[];
  /** human-readable notes: ignored params, dropped routes, skipped entries */
  warnings: string[];
}

function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/(\.resonator)?\.json$/i, '').replace(/[_-]+/g, ' ');
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Read a preset file. Accepts our export format, an array of presets, a single
 * preset, a bare v2 snapshot or a v1 flat param map. Never throws anything but
 * PresetImportError (with a message fit for the user).
 */
export function parsePresetFile(text: unknown, fileName = '', now = Date.now()): ParsedFile {
  if (typeof text !== 'string' || !text.trim()) throw new PresetImportError('The file is empty.');
  if (text.length > MAX_FILE_BYTES) throw new PresetImportError('The file is too large to be a preset file.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PresetImportError('The file is not valid JSON.');
  }

  let entries: unknown[];
  if (isObj(data) && data.format === PRESET_FILE_FORMAT) {
    if (!Array.isArray(data.presets)) throw new PresetImportError('The preset file has no preset list.');
    entries = data.presets;
  } else if (Array.isArray(data)) entries = data;
  else if (isObj(data)) entries = [data];
  else throw new PresetImportError('This is not a resonator preset file.');

  const fallback = cleanText(baseName(fileName), NAME_MAX, 'Imported');
  const presets: PresetData[] = [];
  const skipped: string[] = [];
  const total = newReport();
  entries.slice(0, MAX_IMPORT).forEach((e, i) => {
    try {
      const wrapped = isObj(e) && 'snapshot' in e;
      const report = newReport();
      const snapshot = sanitizeSnapshot(wrapped ? e.snapshot : e, report);
      const created = wrapped && typeof e.created === 'number' && Number.isFinite(e.created) && e.created > 0 ? e.created : now;
      presets.push({
        name: cleanText(wrapped ? e.name : undefined, NAME_MAX, entries.length > 1 ? `${fallback} ${i + 1}` : fallback),
        category: cleanText(wrapped ? e.category : undefined, CATEGORY_MAX, IMPORT_CATEGORY),
        created,
        snapshot,
      });
      total.unknownParams.push(...report.unknownParams);
      total.invalidParams.push(...report.invalidParams);
      total.clamped += report.clamped;
      total.droppedRoutes.push(...report.droppedRoutes);
    } catch (err) {
      skipped.push(`#${i + 1}: ${err instanceof PresetImportError ? err.message : 'unreadable'}`);
    }
  });

  if (!presets.length) {
    throw new PresetImportError(skipped.length ? `No usable presets in this file (${skipped[0].replace(/^#\d+: /, '')}).` : 'No presets in this file.');
  }
  const warnings: string[] = [];
  const unknown = new Set(total.unknownParams);
  if (unknown.size) warnings.push(`${plural(unknown.size, 'unknown parameter')} ignored`);
  if (total.invalidParams.length) warnings.push(`${plural(total.invalidParams.length, 'invalid value')} reset to default`);
  if (total.clamped) warnings.push(`${plural(total.clamped, 'value')} clamped to range`);
  if (total.droppedRoutes.length) warnings.push(`${plural(total.droppedRoutes.length, 'route')} dropped (${total.droppedRoutes.slice(0, 3).join(', ')}${total.droppedRoutes.length > 3 ? ', …' : ''})`);
  if (skipped.length) warnings.push(`${plural(skipped.length, 'entry', 'entries')} skipped`);
  if (entries.length > MAX_IMPORT) warnings.push(`only the first ${MAX_IMPORT} presets were read`);
  return { presets, warnings };
}

/** "Name", "Name 2", "Name 3" … not in `taken` (compared case-insensitively) */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const t = new Set([...taken].map((n) => n.toLowerCase()));
  if (!t.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const suffix = ` ${k}`;
    const n = name.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!t.has(n.toLowerCase())) return n;
  }
}

/** file-system friendly name */
export function fileSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'preset'
  );
}
