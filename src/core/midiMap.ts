/**
 * MIDI CC map (docs/midi-2026-10-16.md, points 3B, 4A, 5B, 6A): the default map, what may be
 * mapped, how a CC value becomes a param value, and the map file. No Web MIDI here.
 */
import { NUM_MACROS } from '../shared/paramdefs/modules';
import { NUM_BANDS, PARAM_BY_ID, bandParamId, toNorm, twinId, type ParamSpec } from '../shared/params';

/** CC numbers that never control a param: bank select (0, 32) and the channel mode messages (120–127) */
export function ccReserved(cc: number): boolean {
  return cc === 0 || cc === 32 || cc >= 120;
}

/**
 * Default map: band levels 20–29, RES 40–49, FB 50–59, the global knobs 70–75, macros 102–109.
 * INPUT and OUTPUT are left out (analog on the hardware); MIDI learn can still map them.
 */
export function defaultMidiMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (let b = 0; b < NUM_BANDS; b++) {
    m.set(bandParamId(b, 'gain'), 20 + b);
    m.set(bandParamId(b, 'res'), 40 + b);
    m.set(bandParamId(b, 'fb'), 50 + b);
  }
  m.set('resOffset', 70);
  m.set('spread', 71);
  m.set('mix', 72);
  m.set('fbAllOn', 73);
  m.set('fbAll', 74);
  m.set('fbAllTone', 75);
  for (let n = 1; n <= NUM_MACROS; n++) m.set(`macro${n}.value`, 101 + n);
  return m;
}

/** may this param get a CC? Every param a control shows, except R twins (IN R reaches them) and route depths */
export function midiMappable(id: string): boolean {
  const p = PARAM_BY_ID[id];
  return !!p && p.twinOf === undefined && !p.members && p.modClass !== 'route';
}

/** a stored or imported map, cleaned: known params, CC 0–127 outside the reserved ones, one CC per param and one param per CC */
export function sanitizeMidiMap(raw: unknown): Map<string, number> {
  const m = new Map<string, number>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return m;
  const used = new Set<number>();
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!midiMappable(id) || typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 127 || ccReserved(v) || used.has(v)) continue;
    m.set(id, v);
    used.add(v);
  }
  return m;
}

/**
 * Normalized value of a CC value (0–127): the same travel as the mouse (fader law included).
 * Switches turn on from 64; the CC value nearest to the default lands exactly on it (0 dB, centre).
 */
export function ccToNorm(spec: ParamSpec, v: number): number {
  if (spec.curve === 'toggle') return v >= 64 ? 1 : 0;
  const def = toNorm(spec, spec.def);
  if (Math.round(def * 127) === v) return def;
  return Math.min(1, Math.max(0, v / 127));
}

/** the part of ParamStoreAPI a CC needs */
interface ParamSink {
  spec(id: string): ParamSpec;
  setNorm(id: string, norm: number): void;
}

/**
 * A CC moves its param like a hand on the control: the base value jumps to the CC value, modulation
 * runs on top. On an L/R pair only the channels hit (IN: both, IN L / IN R: one); other params follow
 * any of the three MIDI channels.
 */
export function applyCc(p: ParamSink, id: string, v: number, left: boolean, right: boolean): void {
  if (!left && !right) return;
  const n = ccToNorm(p.spec(id), v);
  const tw = twinId(id);
  if (!tw) {
    p.setNorm(id, n);
    return;
  }
  if (left) p.setNorm(id, n);
  if (right) p.setNorm(tw, n);
}

/** MIDI channels: IN moves both sides, IN L only L, IN R only R (1–16, 0 = off) */
export interface MidiChannels {
  in: number;
  l: number;
  r: number;
}

export const DEFAULT_CHANNELS: MidiChannels = { in: 1, l: 0, r: 0 };

export function cleanChannel(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 16 ? v : fallback;
}

/** which sides a message on MIDI channel ch (1–16) reaches */
export function channelHits(ch: number, c: MidiChannels): { left: boolean; right: boolean } {
  const both = c.in !== 0 && ch === c.in;
  return { left: both || (c.l !== 0 && ch === c.l), right: both || (c.r !== 0 && ch === c.r) };
}

/* ---------- map file ---------- */

const FILE_FORMAT = 'resonator-midi';

export function serializeMidiMap(map: ReadonlyMap<string, number>, ch: MidiChannels): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, channels: { ...ch }, map: Object.fromEntries([...map].sort((a, b) => a[1] - b[1])) }, null, 2);
}

export type MidiMapFile = { ok: true; map: Map<string, number>; channels: MidiChannels | null; skipped: number } | { ok: false; reason: string };

export function parseMidiMapFile(text: string): MidiMapFile {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This is not a MIDI map file (no JSON).' };
  }
  const o = d as { format?: unknown; map?: unknown; channels?: Partial<MidiChannels> };
  if (!o || typeof o !== 'object' || o.format !== FILE_FORMAT || !o.map || typeof o.map !== 'object') return { ok: false, reason: 'This is not a MIDI map file of the Resonator.' };
  const map = sanitizeMidiMap(o.map);
  const skipped = Object.keys(o.map).length - map.size;
  const c = o.channels && typeof o.channels === 'object' ? o.channels : null;
  const channels = c ? { in: cleanChannel(c.in, DEFAULT_CHANNELS.in), l: cleanChannel(c.l, DEFAULT_CHANNELS.l), r: cleanChannel(c.r, DEFAULT_CHANNELS.r) } : null;
  return { ok: true, map, channels, skipped };
}
