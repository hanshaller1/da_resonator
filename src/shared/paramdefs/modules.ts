/**
 * Parameter sets of the modulation / processing modules (fixed slots, see docs/plan-modulation-und-module.md E4).
 * Each feature owns its function here; ids are the contract between DSP, engine, UI and presets.
 */
import { cont, discrete, toggle, intRange, DIVISION_LABELS, DIV_QUARTER, type ParamDef } from './types';
import { NUM_BANDS } from '../bands';

export const NUM_LFOS = 4;
export const NUM_CMODS = 2;
export const NUM_EFS = 4;
export const NUM_MACROS = 8;
export const NUM_ROUTES = 64;
export const CMOD_STEPS = 16;
export const FILTER_SLOTS = ['filterPre', 'filterPost'] as const;
export type FilterSlot = (typeof FILTER_SLOTS)[number];

/* ---------- band dynamics ("Dynamic EQ" on the 10 resonator bands) ---------- */
export function dynParams(): ParamDef[] {
  const out: ParamDef[] = [
    toggle('dyn.on', 'Band Dynamics', 'DYN'),
    cont('dyn.threshold', 'Dyn Threshold', 'THR', -60, 0, -18, 'dB'),
    cont('dyn.ratio', 'Dyn Ratio', 'RATIO', 0.5, 20, 4, ':1', 'exp'),
    cont('dyn.attack', 'Dyn Attack', 'ATK', 0.1, 200, 5, 'ms', 'exp'),
    cont('dyn.release', 'Dyn Release', 'REL', 5, 2000, 120, 'ms', 'exp'),
    cont('dyn.range', 'Dyn Range', 'RANGE', 0, 36, 24, 'dB'),
  ];
  for (let b = 0; b < NUM_BANDS; b++) out.push(cont(`band${b}.dyn`, `Band ${b + 1} Dynamics`, 'DYN', 0, 1, 1, '%'));
  return out;
}

/* ---------- pre / post filter ---------- */
export const FILTER_TYPES = ['LP', 'BP', 'HP', 'Notch'] as const;
export function filterParams(slot: FilterSlot): ParamDef[] {
  const pre = slot === 'filterPre';
  const name = pre ? 'Pre Filter' : 'Post Filter';
  return [
    toggle(`${slot}.on`, name, pre ? 'PRE' : 'POST'),
    discrete(`${slot}.type`, `${name} Type`, 'TYPE', FILTER_TYPES, 0),
    discrete(`${slot}.slope`, `${name} Slope`, 'SLOPE', ['12 dB', '24 dB'], 0),
    cont(`${slot}.cutoff`, `${name} Cutoff`, 'FREQ', 20, 20000, pre ? 8000 : 8000, 'Hz', 'exp'),
    cont(`${slot}.res`, `${name} Resonance`, 'RES', 0, 1, 0.1, '%'),
    cont(`${slot}.drive`, `${name} Drive`, 'DRIVE', 0, 24, 0, 'dB'),
    cont(`${slot}.mix`, `${name} Mix`, 'MIX', 0, 1, 1, '%'),
  ];
}

/* ---------- LFOs ---------- */
export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'Smooth'] as const;
export function lfoParams(n: number): ParamDef[] {
  const m = `lfo${n}`;
  const L = `LFO ${n}`;
  return [
    toggle(`${m}.on`, L, `LFO${n}`),
    discrete(`${m}.shape`, `${L} Shape`, 'SHAPE', LFO_SHAPES, 0),
    cont(`${m}.rate`, `${L} Rate`, 'RATE', 0.01, 40, 0.5, 'Hz', 'exp'),
    toggle(`${m}.sync`, `${L} Sync`, 'SYNC'),
    discrete(`${m}.div`, `${L} Division`, 'DIV', DIVISION_LABELS, DIV_QUARTER),
    cont(`${m}.phase`, `${L} Phase`, 'PHASE', 0, 1, 0, '%'),
    cont(`${m}.morph`, `${L} Morph`, 'MORPH', 0, 1, 0, '%'),
    cont(`${m}.smooth`, `${L} Smooth`, 'SMTH', 0, 1, 0, '%'),
    cont(`${m}.level`, `${L} Level`, 'LEVEL', 0, 1, 1, '%'),
    toggle(`${m}.uni`, `${L} Unipolar`, 'UNI'),
  ];
}

/* ---------- clock mods ---------- */
export const CMOD_MODES = ['Divider', 'Steps', 'Euclid', 'Random'] as const;
export function cmodParams(n: number): ParamDef[] {
  const m = `cmod${n}`;
  const L = `Clock Mod ${n}`;
  const out: ParamDef[] = [
    toggle(`${m}.on`, L, `CMOD${n}`),
    discrete(`${m}.mode`, `${L} Mode`, 'MODE', CMOD_MODES, 0),
    discrete(`${m}.div`, `${L} Division`, 'DIV', DIVISION_LABELS, 4 /* 1/16 */),
    discrete(`${m}.steps`, `${L} Steps`, 'STEPS', intRange(1, CMOD_STEPS), 7 /* 8 */),
    discrete(`${m}.pulses`, `${L} Pulses`, 'PULSES', intRange(0, CMOD_STEPS), 3),
    discrete(`${m}.rotate`, `${L} Rotate`, 'ROT', intRange(0, CMOD_STEPS - 1), 0),
    cont(`${m}.prob`, `${L} Probability`, 'PROB', 0, 1, 1, '%'),
    cont(`${m}.swing`, `${L} Swing`, 'SWING', 0, 0.75, 0, '%'),
    cont(`${m}.slew`, `${L} Slew`, 'SLEW', 0, 1, 0, '%'),
    cont(`${m}.level`, `${L} Level`, 'LEVEL', 0, 1, 1, '%'),
    toggle(`${m}.uni`, `${L} Unipolar`, 'UNI', 1),
  ];
  for (let s = 0; s < CMOD_STEPS; s++) out.push(cont(`${m}.step${s}`, `${L} Step ${s + 1}`, `S${s + 1}`, 0, 1, s % 2 ? 0.25 : 0.75, '%'));
  return out;
}

/* ---------- envelope followers ---------- */
export const EF_TAPS = ['In', ...Array.from({ length: NUM_BANDS }, (_, b) => `Band ${b + 1}`), 'Res Out', 'Out'] as const;
/** tap indices into the worklet's tap buffers (same order as EF_TAPS) */
export const TAP_IN = 0;
export const TAP_BAND0 = 1;
export const TAP_RES_OUT = 1 + NUM_BANDS;
export const TAP_OUT = 2 + NUM_BANDS;
export const NUM_TAPS = 3 + NUM_BANDS;
export function efParams(n: number): ParamDef[] {
  const m = `ef${n}`;
  const L = `Env Follower ${n}`;
  return [
    toggle(`${m}.on`, L, `EF${n}`),
    discrete(`${m}.tap`, `${L} Input`, 'INPUT', EF_TAPS, 0),
    cont(`${m}.attack`, `${L} Attack`, 'ATK', 0.1, 500, 10, 'ms', 'exp'),
    cont(`${m}.release`, `${L} Release`, 'REL', 5, 5000, 200, 'ms', 'exp'),
    cont(`${m}.gain`, `${L} Gain`, 'GAIN', -24, 24, 0, 'dB'),
    cont(`${m}.threshold`, `${L} Threshold`, 'THR', -60, 0, -60, 'dB'),
    cont(`${m}.curve`, `${L} Curve`, 'CURVE', -1, 1, 0),
    cont(`${m}.level`, `${L} Level`, 'LEVEL', 0, 1, 1, '%'),
  ];
}

/* ---------- macros ---------- */
export function macroParams(n: number): ParamDef[] {
  return [{ ...cont(`macro${n}.value`, `Macro ${n}`, `M${n}`, 0, 1, 0, '%'), modulatable: false }];
}

/* ---------- clock ---------- */
export function clockParams(): ParamDef[] {
  return [cont('clock.bpm', 'Tempo', 'BPM', 20, 300, 120, 'BPM'), toggle('clock.run', 'Clock Run', 'RUN', 1)];
}

/* ---------- modulation route depths (route slots) ---------- */
export function routeParams(slot: number): ParamDef[] {
  return [cont(`route${slot}.depth`, `Route ${slot + 1} Depth`, 'DEPTH', -1, 1, 0)];
}
