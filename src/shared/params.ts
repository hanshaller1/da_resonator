/**
 * Single source of truth for every parameter of the resonator.
 * Imported by BOTH the main thread and the AudioWorklet bundle, so keep it
 * free of DOM / Web Audio references.
 *
 * Storage convention:
 *  - ParamStore keeps *plain* values (dB, Hz, 0..1 …) as defined by min/max.
 *  - UI and modulation work in *normalized* space 0..1 via toNorm/fromNorm.
 *  - The worklet receives a Float32Array of plain values ordered by `index`.
 */

import { BAND_FREQS, NUM_BANDS } from './bands';
import type { ModClass, ParamCurve, ParamDef, ParamUnit } from './paramdefs/types';
import {
  NUM_CMODS,
  NUM_EFS,
  NUM_LFOS,
  NUM_MACROS,
  NUM_ROUTES,
  FILTER_SLOTS,
  clockParams,
  cmodParams,
  dynParams,
  dynParams2,
  efParams,
  efParams2,
  filterParams,
  filterParams2,
  lfoParams,
  lfoParams2,
  macroMorphParams,
  macroParams,
  resoParams,
  routeParams,
  bandFilterParams,
  bandFilterParams2,
  scanParams,
} from './paramdefs/modules';

export { BAND_FREQS, NUM_BANDS };
export type { ModClass, ParamCurve, ParamUnit };

/** Fader law floor: anything at or below this dB value is treated as -inf (silence). */
export const FADER_MIN_DB = -60;
export const FADER_MAX_DB = 12;

export type ParamGroup = 'global' | 'band' | 'module' | 'bandGroup';

export interface ParamSpec {
  id: string;
  label: string;
  short: string;
  group: ParamGroup;
  band?: number;
  min: number;
  max: number;
  def: number;
  unit: ParamUnit;
  curve: ParamCurve;
  /** index into the Float32Array sent to the worklet */
  index: number;
  /** false = never modulated (e.g. toggles, bypass, macros) */
  modulatable: boolean;
  /** owning module instance: 'resonator', 'dyn', 'filterPre', 'lfo2', 'route17', 'clock' … */
  module: string;
  /** module kind, decides which sources may modulate it (shared/mod/rules.ts) */
  modClass: ModClass;
  /** option labels for curve 'discrete' */
  options?: readonly string[];
  /** L/R pairs: on a left-channel param, the index of its R twin */
  twin?: number;
  /** on an R twin, the index of its left-channel param */
  twinOf?: number;
  /** band group (BAND LOW / MID / HIGH / ALL): the L params a route onto it moves; it has no value of its own */
  members?: readonly number[];
  /** not stored in the snapshot's params (a module provider keeps it) */
  transient?: boolean;
}

type Def = Omit<ParamDef, 'id'> & { id: string };

const GLOBAL_DEFS: Def[] = [
  { id: 'inputGain',  label: 'Input Gain',     short: 'GAIN',  min: 0,   max: 24,    def: 0,    unit: 'dB', curve: 'lin',    modulatable: true },
  { id: 'analog',     label: 'Analog',         short: 'ANLG',  min: 0,   max: 1,     def: 0.5,  unit: '%',  curve: 'lin',    modulatable: true },
  { id: 'resOffset',  label: 'Resonance',      short: 'RES',   min: -1,  max: 1,     def: 0,    unit: '',   curve: 'lin',    modulatable: true },
  { id: 'fbAllOn',    label: 'Feedback All',   short: 'FB ALL',min: 0,   max: 1,     def: 0,    unit: '',   curve: 'toggle', modulatable: false },
  { id: 'fbAll',      label: 'FB All Amount',  short: 'FB',    min: 0,   max: 1,     def: 0.35, unit: '%',  curve: 'lin',    modulatable: true },
  { id: 'fbAllTone',  label: 'FB All Tone',    short: 'TONE',  min: 200, max: 20000, def: 6000, unit: 'Hz', curve: 'exp',    modulatable: true },
  { id: 'spread',     label: 'Spread',         short: 'SPRD',  min: -1,  max: 1,     def: 0,    unit: '%',  curve: 'lin',    modulatable: true },
  { id: 'mix',        label: 'Dry/Wet',        short: 'MIX',   min: 0,   max: 1,     def: 1,    unit: '%',  curve: 'lin',    modulatable: true },
  { id: 'outputGain', label: 'Output',         short: 'OUT',   min: -24, max: 12,    def: 0,    unit: 'dB', curve: 'lin',    modulatable: true },
  { id: 'bypass',     label: 'Bypass',         short: 'BYP',   min: 0,   max: 1,     def: 0,    unit: '',   curve: 'toggle', modulatable: false },
];

/** Per-band params, in this order, for every band. RES default = RES_DEFAULT (broad bands, see below). */
const BAND_DEFS: Def[] = [
  { id: 'gain', label: 'Level',     short: 'LVL', min: FADER_MIN_DB, max: FADER_MAX_DB, def: 0,   unit: 'dB', curve: 'fader', modulatable: true },
  { id: 'res',  label: 'Resonance', short: 'RES', min: 0,            max: 1,            def: 0.03, unit: '%',  curve: 'lin',   modulatable: true },
  { id: 'fb',   label: 'Feedback',  short: 'FB',  min: 0,            max: 1,            def: 0,   unit: '%',  curve: 'lin',   modulatable: true },
];
export const BAND_PARAM_KEYS = ['gain', 'res', 'fb'] as const;
export type BandParamKey = (typeof BAND_PARAM_KEYS)[number];

export const NUM_GLOBAL = GLOBAL_DEFS.length;
export const PARAMS_PER_BAND = BAND_DEFS.length;
/** the resonator's own params occupy indices 0 .. NUM_RESONATOR_PARAMS-1 (layout unchanged since v1) */
export const NUM_RESONATOR_PARAMS = NUM_GLOBAL + NUM_BANDS * PARAMS_PER_BAND;

export const PARAMS: ParamSpec[] = [];
GLOBAL_DEFS.forEach((d) => PARAMS.push({ ...d, group: 'global', index: PARAMS.length, module: 'resonator', modClass: 'resonator' }));
for (let b = 0; b < NUM_BANDS; b++) {
  for (const d of BAND_DEFS) {
    PARAMS.push({ ...d, id: bandParamId(b, d.id as BandParamKey), group: 'band', band: b, index: PARAMS.length, module: 'resonator', modClass: 'resonator' });
  }
}

/* ---------- module params (fixed slots, appended after the resonator) ---------- */
function addModule(module: string, modClass: ModClass, defs: ParamDef[]): void {
  for (const d of defs) {
    const band = /^band(\d+)\./.exec(d.id);
    PARAMS.push({ ...d, group: 'module', index: PARAMS.length, module, modClass, ...(band ? { band: +band[1] } : {}) });
  }
}
addModule('dyn', 'dyn', dynParams());
for (const slot of FILTER_SLOTS) addModule(slot, 'filter', filterParams(slot));
for (let n = 1; n <= NUM_LFOS; n++) addModule(`lfo${n}`, 'lfo', lfoParams(n));
for (let n = 1; n <= NUM_CMODS; n++) addModule(`cmod${n}`, 'cmod', cmodParams(n));
for (let n = 1; n <= NUM_EFS; n++) addModule(`ef${n}`, 'ef', efParams(n));
for (let n = 1; n <= NUM_MACROS; n++) addModule(`macro${n}`, 'macro', macroParams(n));
addModule('clock', 'clock', clockParams());
for (let r = 0; r < NUM_ROUTES; r++) addModule(`route${r}`, 'route', routeParams(r));
addModule('reso', 'resonator', resoParams());
// mode layers (docs/hardware-modi-und-pools-2026-10-16.md): dB per band on top of the faders
addModule('filterBand', 'filter', bandFilterParams());
addModule('scan', 'scan', scanParams());

/* ---------- R channel (L/R per band, docs/lr-pro-band-2026-10-16.md) ----------
 * The historic ids (band0.gain …, fbAllOn, fbAll) are the left channel. Each gets an R twin with
 * the same range, appended here so every older index stays. Twins are never route targets of their
 * own: a route onto the L id carries a channel choice (L+R, L, R, INV) instead (shared/mod/rules.ts). */
/** first index of the R twins (they run up to the band groups) */
export const R_FIRST = PARAMS.length;
const STEREO_IDS = ['fbAllOn', 'fbAll'];
for (let b = 0; b < NUM_BANDS; b++) for (const k of ['gain', 'res', 'fb']) STEREO_IDS.push(`band${b}.${k}`);
for (const id of STEREO_IDS) {
  const l = PARAMS.find((p) => p.id === id)!;
  l.twin = PARAMS.length;
  PARAMS.push({ ...l, id: `${id}R`, label: `${l.label} R`, index: PARAMS.length, modulatable: false, twin: undefined, twinOf: l.index });
}

/* ---------- band groups (hardware MACRO: BAND LOW, MID, HIGH, ALL) ----------
 * Route targets only: a route onto a group moves the level faders of all its bands, like one route
 * per band (same depth, same channel choice). The group itself holds no value: it is not stored in
 * snapshots, not MIDI-mapped and never reaches the DSP. Appended last, so every older index stays. */
export const BAND_GROUPS = [
  { id: 'bands.low', label: 'Band Low', short: 'B·LOW', bands: [0, 1, 2] },
  { id: 'bands.mid', label: 'Band Mid', short: 'B·MID', bands: [3, 4, 5, 6] },
  { id: 'bands.high', label: 'Band High', short: 'B·HIGH', bands: [7, 8, 9] },
  { id: 'bands.all', label: 'Band All', short: 'B·ALL', bands: Array.from({ length: NUM_BANDS }, (_, b) => b) },
] as const;
for (const g of BAND_GROUPS) {
  const gain = BAND_DEFS[0];
  PARAMS.push({
    ...gain,
    id: g.id,
    label: g.label,
    short: g.short,
    group: 'bandGroup',
    index: PARAMS.length,
    module: 'resonator',
    modClass: 'resonator',
    members: g.bands.map((b) => NUM_GLOBAL + b * PARAMS_PER_BAND),
  });
}

/* ---------- params added on 2026-10-17, appended so every older index stays ----------
 * They join their modules (same module id), so routes, modulation and the UI treat them like the rest. */
for (const slot of FILTER_SLOTS) addModule(slot, 'filter', filterParams2(slot));
for (let n = 1; n <= NUM_LFOS; n++) addModule(`lfo${n}`, 'lfo', lfoParams2(n));
for (let n = 1; n <= NUM_EFS; n++) addModule(`ef${n}`, 'ef', efParams2(n));
addModule('morph', 'macro', macroMorphParams());
addModule('dyn', 'dyn', dynParams2());
addModule('filterBand', 'filter', bandFilterParams2());

export const NUM_PARAMS = PARAMS.length;

/** Global param indices (stable, use in the worklet). */
export const G = Object.fromEntries(GLOBAL_DEFS.map((d, i) => [d.id, i])) as Record<
  'inputGain' | 'analog' | 'resOffset' | 'fbAllOn' | 'fbAll' | 'fbAllTone' | 'spread' | 'mix' | 'outputGain' | 'bypass',
  number
>;

export function bandParamId(band: number, key: BandParamKey): string {
  return `band${band}.${key}`;
}
export function bandParamIndex(band: number, key: BandParamKey): number {
  return NUM_GLOBAL + band * PARAMS_PER_BAND + BAND_PARAM_KEYS.indexOf(key);
}
/** R twin of a band param (the plain id is L) */
export function bandParamIdR(band: number, key: BandParamKey): string {
  return `${bandParamId(band, key)}R`;
}
export function bandParamIndexR(band: number, key: BandParamKey): number {
  return PARAMS[bandParamIndex(band, key)].twin!;
}

export const PARAM_BY_ID: Record<string, ParamSpec> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

/** id of the R twin of an L param, undefined if it has none */
export function twinId(id: string): string | undefined {
  const t = PARAM_BY_ID[id]?.twin;
  return t === undefined ? undefined : PARAMS[t].id;
}

/** does a route onto this param carry a channel choice (L+R, L, R, INV)? L/R pairs and band groups do */
export function hasRouteChannel(id: string): boolean {
  const p = PARAM_BY_ID[id];
  return !!p && (p.twin !== undefined || p.members !== undefined);
}

/** index of a param id (throws on unknown ids: use at module load to cache indices) */
export function paramIndex(id: string): number {
  const p = PARAM_BY_ID[id];
  if (!p) throw new Error(`unknown param ${id}`);
  return p.index;
}

/** all params of one module instance, in definition order */
export function moduleParams(module: string): ParamSpec[] {
  return PARAMS.filter((p) => p.module === module);
}

export function defaultValues(): Float32Array {
  const v = new Float32Array(NUM_PARAMS);
  PARAMS.forEach((p) => (v[p.index] = p.def));
  return v;
}

/* ---------- normalized <-> plain mapping ---------- */

/**
 * Fader law: 0 dB in the middle of the travel. The upper half is +12 dB in even steps (the range
 * that is played); the lower half covers the cuts down to mute (0 = -inf) with the same travel.
 * Points (norm, dB), linear in dB between them.
 */
const FADER_LAW: readonly (readonly [number, number])[] = [
  [0, FADER_MIN_DB],
  [0.1, -40],
  [0.2, -24],
  [0.3, -12],
  [0.4, -6],
  [0.5, 0],
  [1, FADER_MAX_DB],
];
/** fader position of 0 dB (the detent) */
export const FADER_UNITY_NORM = 0.5;

export function faderNormToDb(n: number): number {
  if (n <= 0) return FADER_MIN_DB;
  if (n >= 1) return FADER_MAX_DB;
  for (let i = 1; i < FADER_LAW.length; i++) {
    const [n1, d1] = FADER_LAW[i];
    if (n <= n1) {
      const [n0, d0] = FADER_LAW[i - 1];
      return d0 + ((n - n0) / (n1 - n0)) * (d1 - d0);
    }
  }
  return FADER_MAX_DB;
}
export function faderDbToNorm(db: number): number {
  if (db <= FADER_MIN_DB) return 0;
  if (db >= FADER_MAX_DB) return 1;
  for (let i = 1; i < FADER_LAW.length; i++) {
    const [n1, d1] = FADER_LAW[i];
    if (db <= d1) {
      const [n0, d0] = FADER_LAW[i - 1];
      return n0 + ((db - d0) / (d1 - d0)) * (n1 - n0);
    }
  }
  return 1;
}

export function toNorm(p: ParamSpec, v: number): number {
  let n: number;
  switch (p.curve) {
    case 'exp': n = Math.log(v / p.min) / Math.log(p.max / p.min); break;
    case 'fader': n = faderDbToNorm(v); break;
    case 'toggle': n = v >= 0.5 ? 1 : 0; break;
    case 'discrete': n = p.max > p.min ? (Math.round(v) - p.min) / (p.max - p.min) : 0; break;
    default: n = (v - p.min) / (p.max - p.min);
  }
  return Math.min(1, Math.max(0, n));
}

export function fromNorm(p: ParamSpec, n: number): number {
  n = Math.min(1, Math.max(0, n));
  switch (p.curve) {
    case 'exp': return p.min * Math.pow(p.max / p.min, n);
    case 'fader': return faderNormToDb(n);
    case 'toggle': return n >= 0.5 ? 1 : 0;
    case 'discrete': return p.min + Math.round(n * (p.max - p.min));
    default: return p.min + n * (p.max - p.min);
  }
}

/** dB -> linear, with the fader floor mapped to true silence. */
export function dbToGain(db: number): number {
  return db <= FADER_MIN_DB ? 0 : Math.pow(10, db / 20);
}

export function formatValue(p: ParamSpec, v: number): string {
  if (p.curve === 'discrete') return p.options?.[Math.round(v)] ?? String(Math.round(v));
  switch (p.unit) {
    case 'dB': return v <= FADER_MIN_DB && p.curve === 'fader' ? '-∞ dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : v < 10 ? `${v.toFixed(2)} Hz` : `${Math.round(v)} Hz`;
    case '%': return `${p.min < 0 && v >= 0.005 ? '+' : ''}${Math.round(v * 100)}%`;
    case 'ms': return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`;
    case 'BPM': return `${v.toFixed(1)} BPM`;
    case ':1': return v < 1 ? `1:${(1 / v).toFixed(1)}` : `${v.toFixed(1)}:1`;
    case '°': return `${Math.round(v)}°`;
    case 'oct': return `${p.min < 0 && v >= 0.005 ? '+' : ''}${v.toFixed(2)} oct`;
    case 'dB/oct': return `${Math.round(v)} dB/oct`;
    default: return p.curve === 'toggle' ? (v >= 0.5 ? 'ON' : 'OFF') : v.toFixed(2);
  }
}

export function formatFreq(hz: number): string {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(1)}k` : `${hz}`;
}

/* ---------- resonance law (shared by DSP and the UI response curve) ---------- */

export const RES_Q_MIN = 0.6;
export const RES_Q_MAX = 120;
/** effective resonance 0..1 -> filter Q (0.6 … 120, exponential) */
export function resToQ(r: number): number {
  r = Math.min(1, Math.max(0, r));
  return RES_Q_MIN * Math.pow(RES_Q_MAX / RES_Q_MIN, r);
}
/** default band RES: broad bands like the hardware (Q 0.7, 17 dB/decade); all faders at 0 dB then sum flat */
export const RES_DEFAULT = 0.03;
/**
 * Peak gain of a band at a given Q, normalised to 0 dB at RES 0.45 (Q 6.5).
 * Above it, more resonance lifts the centre like an analog resonant bandpass (peak ∝ Q^0.7), so turning
 * resonance up sounds fuller and rings louder. Below it, broad bands overlap and add up, so they are
 * lowered less (Q^0.4): with every band at Q 0.7 and 0 dB the sum is flat at 0 dB.
 */
export const RES_MAKEUP_EXP = 0.7;
export const RES_MAKEUP_EXP_LOW = 0.4;
export const RES_Q_REF = resToQ(0.45);
export function resonanceMakeup(q: number): number {
  const x = q / RES_Q_REF;
  return Math.pow(x, x >= 1 ? RES_MAKEUP_EXP : RES_MAKEUP_EXP_LOW);
}
/**
 * Level of a band in the feedback taps (FB ALL, common feedback route): the cut of the makeup only.
 * Broad bands then feed back like one flat band, while the lift of high resonance stays out of the loops.
 */
export function feedbackTapGain(q: number): number {
  return Math.min(1, resonanceMakeup(q));
}

/**
 * Feedback All: loop gain at amount 1. With the faders at 0 dB the loop starts to oscillate at amount ≈ 0.75,
 * for any RES (the tap takes broad bands at their compensated level). Snapshots before v3 used 1.0 and an
 * uncompensated tap (core/state.ts converts them).
 */
export const FB_ALL_LOOP_MAX = 1.3;
export const FB_ALL_LOOP_MAX_V2 = 1.0;
/** band RES default of snapshots before v3 */
export const RES_DEFAULT_V2 = 0.45;

/* ---------- RESONANCE knob (CONFIG: knob, curve, bands) ---------- */

export const RES_KNOB_RES = 0;
export const RES_KNOB_FEEDBACK = 1;
export const RES_KNOB_FOCUS = 2;
/** RESONANCE knob mode from the param value (0 RES, 1 FEEDBACK, 2 FOCUS) */
export function resKnobMode(v: number): number {
  return v >= 1.5 ? RES_KNOB_FOCUS : v >= 0.5 ? RES_KNOB_FEEDBACK : 0;
}
/** FOCUS: RES added at the spotlight's centre, and its width (in bands, Gaussian sigma) */
export const FOCUS_DEPTH = 0.6;
export const FOCUS_WIDTH = 0.7;
/**
 * FOCUS knob: a resonance spotlight swept through the bands by the shaped knob value, 7:30 = band 1,
 * 4:30 = band 10, continuous in between. Returns the RES added to band b.
 */
export function resFocusShift(b: number, s: number): number {
  const x = ((Math.min(1, Math.max(-1, s)) + 1) / 2) * (NUM_BANDS - 1);
  const d = (b - x) / FOCUS_WIDTH;
  return FOCUS_DEPTH * Math.exp(-0.5 * d * d);
}
/**
 * knob travel through the curve (0 linear, 1 log: fast first, 2 exp: fine first, 3 S-curve "balanced": fine
 * around the centre and at the stops, fast in between), sign kept: -1..1 → -1..1
 */
export function resKnobShape(p: number, curve: number): number {
  const a = Math.min(1, Math.abs(p));
  const s = curve === 1 ? Math.log10(1 + 9 * a) : curve === 2 ? (Math.pow(10, a) - 1) / 9 : curve === 3 ? a * a * (3 - 2 * a) : a;
  return p < 0 ? -s : s;
}
/** share of the knob that reaches band b (0 all alike, 1 rising to the highs, 2 rising to the lows) */
export function resKnobWeight(b: number, weight: number): number {
  if (weight === 1) return b / (NUM_BANDS - 1);
  if (weight === 2) return (NUM_BANDS - 1 - b) / (NUM_BANDS - 1);
  return 1;
}
/**
 * FEEDBACK knob, like the hardware attenuverter: factor on the feedback from the shaped knob value.
 * Centre = no feedback, right up to ×1.3, left inverted. With a band's FB at 1 it starts to self-oscillate
 * at 3 o'clock (0.87 / 1.3 ≈ 0.67 on the linear curve); the band's FB acts like the hardware's on/off switch.
 */
export const FB_KNOB_SCALE = 1.3;
export function fbKnobFactor(s: number): number {
  return FB_KNOB_SCALE * s;
}
