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
    cont('dyn.ratio', 'Dyn Ratio', 'RATIO', 1, 20, 4, ':1', 'exp'),
    cont('dyn.attack', 'Dyn Attack', 'ATK', 0.1, 200, 5, 'ms', 'exp'),
    cont('dyn.release', 'Dyn Release', 'REL', 5, 2000, 120, 'ms', 'exp'),
    cont('dyn.range', 'Dyn Range', 'RANGE', 0, 36, 24, 'dB'),
  ];
  for (let b = 0; b < NUM_BANDS; b++) out.push(cont(`band${b}.dyn`, `Band ${b + 1} Dynamics`, 'DYN', 0, 1, 1, '%'));
  // what the detector measures (docs/hardware-modi-und-pools-2026-10-16.md, 7A): the band itself, or the
  // input / the output through analysis filters per band; the change comes delayed, on R later still (3A)
  out.push(
    fixedDef(discrete('dyn.source', 'Dyn Source', 'SRC', DYN_SOURCES, 0)),
    cont('dyn.delay', 'Dyn Delay', 'DLY', 0, DYN_DELAY_MAX_MS, 0, 'ms'),
    cont('dyn.rdly', 'Dyn R Delay', 'R DLY', 0, DYN_RDLY_MAX_MS, 0, 'ms'),
    fixedDef(discrete('dyn.filter', 'Dyn Input Filter', 'FILT', DYN_FILTERS, 0)),
    cont('dyn.filterFreq', 'Dyn Filter Freq', 'FREQ', 20, 20000, 1000, 'Hz', 'exp'),
  );
  return out;
}
/** DYN EQ sources: the band's own signal, the input, the output (the resonator's wet sum) */
export const DYN_SOURCES = ['Band', 'In', 'Out'] as const;
export const DYN_SRC_BAND = 0;
export const DYN_SRC_IN = 1;
export const DYN_SRC_OUT = 2;
/** input filter before the IN / OUT analysis: off or a bandpass at dyn.filterFreq */
export const DYN_FILTERS = ['Off', 'BP'] as const;
export const DYN_DELAY_MAX_MS = 2000;
/**
 * DYN EQ mode (2026-10-17): CUT lowers bands above the threshold (the hardware), BOOST raises bands below it
 * (upward compression), BALANCE pulls every band towards the threshold from both sides. Appended after the band
 * groups (shared/params.ts), so every older index stays; default CUT, older presets sound the same.
 */
export function dynParams2(): ParamDef[] {
  return [fixedDef(discrete('dyn.mode', 'Dyn Mode', 'MODE', DYN_MODES, 0))];
}
export const DYN_MODES = ['Cut', 'Boost', 'Balance'] as const;
export const DYN_CUT = 0;
export const DYN_BOOST = 1;
export const DYN_BALANCE = 2;
/** BOOST / BALANCE gate: no boost this far below the threshold, faded in over the DYN_GATE_FADE_DB above */
export const DYN_GATE_DB = 40;
export const DYN_GATE_FADE_DB = 12;

/**
 * Static gain change (dB, + = cut, − = boost) of a band whose level is overDb above (− below) the threshold;
 * slope = 1 − 1/ratio. The worklet computes the same in dynStep (inline, on A²).
 */
export function dynGainChange(overDb: number, slope: number, range: number, mode: number): number {
  if (overDb > 0) return mode === DYN_BOOST ? 0 : Math.min(range, overDb * slope);
  if (mode === DYN_CUT || overDb <= -DYN_GATE_DB) return 0;
  const fade = Math.min(1, (DYN_GATE_DB + overDb) / DYN_GATE_FADE_DB);
  return -Math.min(range, -overDb * slope) * fade;
}
export const DYN_RDLY_MAX_MS = 1000;

/** a param that is stored with the sound but never modulated (switches, setup choices) */
function fixedDef(d: ParamDef): ParamDef {
  return { ...d, modulatable: false };
}

/* ---------- mode layers (docs/hardware-modi-und-pools-2026-10-16.md, 1A): dB per band on top of the faders ---------- */
/** lock toggles of a mode: a locked band keeps its fader level, the mode leaves it alone */
function lockParams(m: string, L: string): ParamDef[] {
  return Array.from({ length: NUM_BANDS }, (_, b) => toggle(`${m}.lock${b}`, `${L} Lock Band ${b + 1}`, `LOCK${b + 1}`));
}

/** band filter (FILTER → BAND): a filter curve read at the band centres */
/** same order as the pre / post filter types */
export const BAND_FILTER_TYPES = ['LP', 'BP', 'HP', 'Notch'] as const;
export function bandFilterParams(): ParamDef[] {
  const L = 'Band Filter';
  return [
    toggle('filterBand.on', L, 'BAND'),
    discrete('filterBand.type', `${L} Type`, 'TYPE', BAND_FILTER_TYPES, 0),
    cont('filterBand.cutoff', `${L} Cutoff`, 'FREQ', 20, 20000, 1000, 'Hz', 'exp'),
    cont('filterBand.slope', `${L} Slope`, 'SLOPE', 6, 48, 24, 'dB/oct'),
    cont('filterBand.width', `${L} Width`, 'WIDTH', 0.25, 8, 2, 'oct', 'exp'),
    cont('filterBand.depth', `${L} Depth`, 'DEPTH', 0, 60, 60, 'dB'),
    cont('filterBand.offset', `${L} Offset`, 'OFFSET', -24, 12, 0, 'dB'),
    cont('filterBand.rofs', `${L} R Offset`, 'R OFS', -2, 2, 0, 'oct'),
    ...lockParams('filterBand', L),
  ];
}

/** band scanner (CLK MOD → SCAN): on every step a value is sampled and written into the next band */
export const SCAN_SOURCES = ['LFO', 'LFO 1', 'LFO 2', 'LFO 3', 'LFO 4', 'EF 1', 'EF 2', 'EF 3', 'EF 4', 'CM 1', 'CM 2', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'] as const;
/** mod source id of each SCAN_SOURCES entry ('' = the scanner's own LFO) */
export const SCAN_SOURCE_IDS: readonly string[] = [
  '',
  ...Array.from({ length: NUM_LFOS }, (_, i) => `lfo${i + 1}`),
  ...Array.from({ length: NUM_EFS }, (_, i) => `ef${i + 1}`),
  ...Array.from({ length: NUM_CMODS }, (_, i) => `cmod${i + 1}`),
  ...Array.from({ length: NUM_MACROS }, (_, i) => `macro${i + 1}`),
];
export const SCAN_SHAPES = ['Sine', 'Square', 'Triangle', 'Saw', 'Random'] as const;
export const SCAN_DIRS = ['Up', 'Down', 'Ping-Pong', 'Random'] as const;
/** steps per second at the top of RATE (≈ 10 000 BPM in 1/16) */
export const SCAN_RATE_MAX = 160;
/** largest R delay in steps */
export const SCAN_RDLY_MAX = 16;
export function scanParams(): ParamDef[] {
  const m = 'scan';
  const L = 'Scanner';
  return [
    toggle(`${m}.on`, L, 'SCAN'),
    fixedDef(discrete(`${m}.src`, `${L} Source`, 'SOURCE', SCAN_SOURCES, 0)),
    discrete(`${m}.shape`, `${L} LFO Shape`, 'SHAPE', SCAN_SHAPES, 0),
    cont(`${m}.lfo`, `${L} LFO Rate`, 'LFO', 0.01, 40, 0.5, 'Hz', 'exp'),
    toggle(`${m}.sync`, `${L} Sync`, 'SYNC'),
    cont(`${m}.rate`, `${L} Rate`, 'RATE', 0.1, SCAN_RATE_MAX, 8, 'Hz', 'exp'),
    discrete(`${m}.div`, `${L} Division`, 'DIV', DIVISION_LABELS, 4 /* 1/16 */),
    clockChoice(m, L),
    discrete(`${m}.dir`, `${L} Direction`, 'DIR', SCAN_DIRS, 0),
    cont(`${m}.depth`, `${L} Depth`, 'DEPTH', 0, 48, 24, 'dB'),
    cont(`${m}.offset`, `${L} Offset`, 'OFFSET', -24, 12, 0, 'dB'),
    discrete(`${m}.rdly`, `${L} R Delay`, 'R DLY', intRange(0, SCAN_RDLY_MAX), 0),
    toggle(`${m}.rinv`, `${L} R Invert`, 'R INV'),
    ...lockParams(m, L),
  ];
}

/* ---------- pre / post filter ---------- */
export const FILTER_TYPES = ['LP', 'BP', 'HP', 'Notch'] as const;
/** KEY: the cutoff comes from FREQ, from the FOCUS spot of the RESONANCE knob, or from a band's centre */
export const FILTER_KEYS = ['Off', 'Focus', ...Array.from({ length: NUM_BANDS }, (_, b) => `Band ${b + 1}`)] as const;
export const FILTER_KEY_FOCUS = 1;
export const FILTER_KEY_BAND0 = 2;
/** ENV AMT: octaves the filter's own envelope moves the cutoff at full level */
export const FILTER_ENV_OCT = 4;
/** SPREAD: octaves between L and R cutoff at the stops (L down, R up by half each) */
export const FILTER_SPREAD_OCT = 2;
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
/** KEY, ENV and SPREAD of the pre / post filter (2026-10-17; appended after the older params, see shared/params.ts) */
export function filterParams2(slot: FilterSlot): ParamDef[] {
  const name = slot === 'filterPre' ? 'Pre Filter' : 'Post Filter';
  return [
    discrete(`${slot}.key`, `${name} Key`, 'KEY', FILTER_KEYS, 0),
    cont(`${slot}.env`, `${name} Env Amount`, 'ENV AMT', -FILTER_ENV_OCT, FILTER_ENV_OCT, 0, 'oct'),
    cont(`${slot}.envRel`, `${name} Env Release`, 'ENV REL', 10, 2000, 150, 'ms', 'exp'),
    cont(`${slot}.spread`, `${name} L/R Spread`, 'SPREAD', -FILTER_SPREAD_OCT, FILTER_SPREAD_OCT, 0, 'oct'),
  ];
}

/** KEY of the band filter: like PRE / POST, plus the last MIDI note played */
export const BAND_FILTER_KEYS = [...FILTER_KEYS, 'Note'] as const;
export const BAND_FILTER_KEY_NOTE = FILTER_KEYS.length;
/** PEAK: largest lift at the cutoff; RES AMT: largest RES shift of a fully open / closed band */
export const BAND_FILTER_PEAK_MAX = 12;
export const BAND_FILTER_RES_SHIFT = 0.5;
/**
 * KEY, ENV, PEAK and RES AMT of the band filter (2026-10-17; appended after the older params, see shared/params.ts):
 * the cutoff from the FOCUS spot, a band or the last MIDI note; an envelope on the input moves it; a lift at the
 * cutoff; the curve also shifts RES (open bands ring longer, closed ones get broader).
 */
export function bandFilterParams2(): ParamDef[] {
  const L = 'Band Filter';
  return [
    discrete('filterBand.key', `${L} Key`, 'KEY', BAND_FILTER_KEYS, 0),
    cont('filterBand.env', `${L} Env Amount`, 'ENV', -FILTER_ENV_OCT, FILTER_ENV_OCT, 0, 'oct'),
    cont('filterBand.envRel', `${L} Env Release`, 'REL', 10, 2000, 150, 'ms', 'exp'),
    cont('filterBand.peak', `${L} Peak`, 'PEAK', 0, BAND_FILTER_PEAK_MAX, 0, 'dB'),
    cont('filterBand.resAmt', `${L} Res Amount`, 'RES AMT', -1, 1, 0, '%'),
  ];
}

/* ---------- clock choice of the LFOs and clock mods ---------- */
/** the clock an LFO (on DIV) or a clock mod follows: the internal clock or the MIDI clock */
export const CLOCK_SOURCES = ['INT', 'MIDI'] as const;
function clockChoice(m: string, L: string): ParamDef {
  return { ...discrete(`${m}.clk`, `${L} Clock`, 'CLOCK', CLOCK_SOURCES, 0), modulatable: false };
}
/**
 * true if a module that chose the MIDI clock (`wantMidi`) or the internal one follows the MIDI
 * clock: its choice while that clock is on, else the other one if that is on; with both off its
 * choice (which stands still)
 */
export function followsMidi(wantMidi: boolean, intOn: boolean, midiOn: boolean): boolean {
  if (wantMidi ? midiOn : intOn) return wantMidi;
  return wantMidi ? !intOn : midiOn;
}

/* ---------- LFOs ---------- */
export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'Smooth'] as const;
/** STEPS: the wave quantised to this many levels (Off = smooth) */
export const LFO_STEPS = ['Off', ...intRange(2, 16)] as const;
export function lfoParams(n: number): ParamDef[] {
  const m = `lfo${n}`;
  const L = `LFO ${n}`;
  return [
    toggle(`${m}.on`, L, `LFO${n}`),
    discrete(`${m}.shape`, `${L} Shape`, 'SHAPE', LFO_SHAPES, 0),
    cont(`${m}.rate`, `${L} Rate`, 'RATE', 0.01, 40, 0.5, 'Hz', 'exp'),
    toggle(`${m}.sync`, `${L} Sync`, 'SYNC'),
    discrete(`${m}.div`, `${L} Division`, 'DIV', DIVISION_LABELS, DIV_QUARTER),
    clockChoice(m, L),
    cont(`${m}.phase`, `${L} Phase`, 'PHASE', 0, 1, 0, '%'),
    cont(`${m}.morph`, `${L} Morph`, 'MORPH', 0, 1, 0, '%'),
    cont(`${m}.smooth`, `${L} Smooth`, 'SMTH', 0, 1, 0, '%'),
    cont(`${m}.level`, `${L} Level`, 'LEVEL', 0, 1, 1, '%'),
    toggle(`${m}.uni`, `${L} Unipolar`, 'UNI'),
  ];
}
/** STEPS and R PHASE of an LFO (2026-10-17; appended after the older params) */
export function lfoParams2(n: number): ParamDef[] {
  const m = `lfo${n}`;
  const L = `LFO ${n}`;
  return [
    discrete(`${m}.steps`, `${L} Steps`, 'STEPS', LFO_STEPS, 0),
    cont(`${m}.rphase`, `${L} R Phase`, 'R PHASE', 0, 180, 0, '°'),
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
    clockChoice(m, L),
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
/** which channel of the tap a follower listens to: both (mono sum), L or R (hardware: L IN, R IN, L OUT, R OUT) */
export const EF_CHANNELS = ['L+R', 'L', 'R'] as const;
/** delay before the follower reacts (hardware: delay before the attack) */
export const EF_DELAY_MAX_MS = 2000;
/** hold before the release starts */
export const EF_HOLD_MAX_MS = 1000;
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
    fixedDef(discrete(`${m}.ch`, `${L} Channel`, 'CH', EF_CHANNELS, 0)),
    cont(`${m}.delay`, `${L} Delay`, 'DLY', 0, EF_DELAY_MAX_MS, 0, 'ms'),
  ];
}
/** HOLD of an envelope follower (2026-10-17; appended after the older params) */
export function efParams2(n: number): ParamDef[] {
  const m = `ef${n}`;
  const L = `Env Follower ${n}`;
  return [
    cont(`${m}.hold`, `${L} Hold`, 'HOLD', 0, EF_HOLD_MAX_MS, 0, 'ms'),
  ];
}

/* ---------- macros ---------- */
export function macroParams(n: number): ParamDef[] {
  return [{ ...cont(`macro${n}.value`, `Macro ${n}`, `M${n}`, 0, 1, 0, '%'), modulatable: false }];
}
/**
 * MORPH: glides all eight macros between the two stored sets A (left) and B (right). The sets and the MORPH
 * position live in the snapshot's modules.macroMorph (the param is transient); turning MORPH writes the
 * macro values (UI side, like a hand on 8 knobs).
 */
export function macroMorphParams(): ParamDef[] {
  return [{ ...cont('macros.morph', 'Macro Morph', 'MORPH', 0, 1, 0, '%'), modulatable: false, transient: true }];
}

/* ---------- internal clock ---------- */
export function clockParams(): ParamDef[] {
  return [cont('clock.bpm', 'Tempo', 'BPM', 20, 300, 120, 'BPM'), toggle('clock.run', 'Clock Run', 'RUN', 1)];
}

/* ---------- resonance and spread setup (CONFIG page; stored with the sound, never modulated) ---------- */
/** where the per-band feedback goes: into the band itself before its fader, or after the fader into the shared input */
export const FB_ROUTES = ['Band', 'Common'] as const;
/** what the RESONANCE knob does: shift RES of all bands, or scale all feedback (centre = none, left inverts), or sweep a resonance spotlight through the bands */
export const RES_KNOB_MODES = ['Res', 'Feedback', 'Focus'] as const;
/** travel of the RESONANCE knob */
export const RES_CURVES = ['Linear', 'Log', 'Exp', 'S-Curve'] as const;
/** which bands the RESONANCE knob reaches: all alike, rising to the highs, rising to the lows */
export const RES_WEIGHTS = ['All', 'Highs', 'Lows'] as const;
/**
 * what SPREAD does (centre = neutral): ODD/EVEN pans odd bands to one side and even bands to the other
 * (right of centre odd → L, left of centre odd → R); CLASSIC raises one channel and lowers the other
 * (right of centre R up, L down; ±SPREAD_CLASSIC_DB at the stops). Default CLASSIC since 2026-10-17;
 * older snapshots and factory presets that use SPREAD keep ODD/EVEN.
 */
export const SPREAD_MODES = ['Odd/Even', 'Classic'] as const;
export const SPREAD_CLASSIC_DB = 6;
export function resoParams(): ParamDef[] {
  const fixed = (d: ParamDef): ParamDef => ({ ...d, modulatable: false });
  return [
    fixed(discrete('reso.route', 'Feedback Route', 'FB', FB_ROUTES, 0)),
    fixed(discrete('reso.knob', 'Resonance Knob', 'KNOB', RES_KNOB_MODES, 0)),
    fixed(discrete('reso.curve', 'Resonance Curve', 'CURVE', RES_CURVES, 0)),
    fixed(discrete('reso.weight', 'Resonance Bands', 'BANDS', RES_WEIGHTS, 0)),
    fixed(discrete('reso.spread', 'Spread Function', 'SPRD', SPREAD_MODES, 1)),
  ];
}

/* ---------- modulation route depths (route slots) ---------- */
export function routeParams(slot: number): ParamDef[] {
  return [cont(`route${slot}.depth`, `Route ${slot + 1} Depth`, 'DEPTH', -1, 1, 0)];
}
