/**
 * Factory presets (read-only, shipped with the app).
 * Each entry lists only what differs from the defaults; everything else is the param default.
 * Written in the current snapshot format (v3): bands default to broad (RES 0.03), so presets made
 * for the narrow bands set RES 0.45 (NARROW); Feedback All self-oscillates from amount ≈ 0.75.
 */
import type { EngineSnapshot } from '../core/types';
import { SNAPSHOT_VERSION } from '../core/state';
import { fileSlug, newReport, sanitizeSnapshot, type Preset } from './io';

export interface FactoryPresetDef {
  name: string;
  category: string;
  /** params that differ from their default, by id */
  params?: Record<string, number>;
  /** modulation routes; the depth is param `route{slot}.depth` */
  routes?: EngineSnapshot['routes'];
  triggers?: EngineSnapshot['triggers'];
  /** state of registered providers (macro names …) */
  modules?: Record<string, unknown>;
}

/** In browser order. "Init" stays first: it is what the app starts with. */
export const FACTORY_PRESETS: FactoryPresetDef[] = [
  { name: 'Init', category: 'Basic' },
  preset('Breathing Bands', 'Modulation', {
    params: { analog: 0.7, 'lfo1.on': 1, 'lfo1.rate': 0.08, 'lfo2.on': 1, 'lfo2.shape': 1, 'lfo2.rate': 0.13, ...bands({ res: [0.5, 0.55, 0.6, 0.65, 0.6, 0.55, 0.5, 0.5, 0.45, 0.4] }) },
    mods: [
      ['lfo1', 'resOffset', 0.3],
      ['lfo2', 'spread', 0.45],
      ['macro1', 'route0.depth', 0.35],
    ],
    macros: ['Breath'],
  }),
  preset('Euclid Pings', 'Rhythm', {
    params: {
      'clock.bpm': 112, mix: 0.8, ...bands({ res: [0.3, 0.4, 0.85, 0.4, 0.4, 0.8, 0.4, 0.75, 0.4, 0.3] }),
      'cmod1.on': 1, 'cmod1.mode': 2, 'cmod1.div': 4, 'cmod1.steps': 7, 'cmod1.pulses': 3,
      'cmod2.on': 1, 'cmod2.mode': 2, 'cmod2.div': 4, 'cmod2.steps': 15, 'cmod2.pulses': 5, 'cmod2.rotate': 2,
    },
    mods: [
      ['cmod1', 'band2.fb', 0.95],
      ['cmod2', 'band5.fb', 0.93],
      ['cmod1', 'band7.fb', 0.9],
    ],
  }),
  preset('Step Resonance', 'Rhythm', {
    params: {
      'clock.bpm': 124, 'cmod1.on': 1, 'cmod1.mode': 1, 'cmod1.div': 7, 'cmod1.steps': 7, 'cmod1.slew': 0.25, 'cmod1.uni': 0,
      ...steps(1, [0.9, 0.2, 0.6, 0.1, 0.8, 0.3, 0.5, 0.0]),
      'lfo1.on': 1, 'lfo1.shape': 2, 'lfo1.sync': 1, 'lfo1.div': 7,
      'filterPost.on': 1, 'filterPost.cutoff': 2500, 'filterPost.res': 0.35, ...NARROW(),
    },
    mods: [
      ['cmod1', 'resOffset', 0.35],
      ['lfo1', 'filterPost.cutoff', -0.3],
    ],
    triggers: [['cmod1.step', 'lfo1.reset']],
  }),
  preset('Drum Follower', 'Dynamics', {
    params: {
      'ef1.on': 1, 'ef1.tap': 0, 'ef1.attack': 2, 'ef1.release': 140, 'ef1.threshold': -42,
      'filterPost.on': 1, 'filterPost.cutoff': 700, 'filterPost.res': 0.3, ...bands({ res: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6] }),
    },
    mods: [
      ['ef1', 'filterPost.cutoff', 0.55],
      ['ef1', 'resOffset', -0.25],
    ],
  }),
  preset('Tamed Feedback', 'Dynamics', {
    params: {
      fbAllOn: 1, fbAll: 0.73, fbAllTone: 3800, analog: 0.8, 'dyn.on': 1, 'dyn.threshold': -30, 'dyn.ratio': 6, 'dyn.attack': 3, 'dyn.release': 250,
      ...bands({ res: [0.7, 0.7, 0.72, 0.74, 0.76, 0.76, 0.74, 0.72, 0.7, 0.68] }),
    },
  }),
  preset('Sidechain Pump', 'Dynamics', {
    params: { 'ef1.on': 1, 'ef1.tap': 1, 'ef1.attack': 3, 'ef1.release': 220, 'ef1.threshold': -36, 'ef1.curve': 0.4, ...NARROW() },
    mods: [
      ['ef1', 'band4.gain', -0.24],
      ['ef1', 'band5.gain', -0.24],
      ['ef1', 'band6.gain', -0.26],
      ['ef1', 'band7.gain', -0.26],
      ['ef1', 'band8.gain', -0.28],
      ['ef1', 'band9.gain', -0.28],
    ],
  }),
  preset('Formant Sweep', 'Filter', {
    params: {
      'filterPre.on': 1, 'filterPre.type': 1, 'filterPre.slope': 1, 'filterPre.res': 0.55, 'filterPre.cutoff': 900, 'filterPre.drive': 6,
      'lfo1.on': 1, 'lfo1.shape': 1, 'lfo1.sync': 1, 'lfo1.div': 14, 'lfo1.morph': 0.3, mix: 0.9, ...NARROW(),
    },
    mods: [['lfo1', 'filterPre.cutoff', 0.4]],
  }),
  preset('Singing Drone', 'Drone', {
    params: {
      analog: 0.85, mix: 1, outputGain: -6,
      ...bands({ gain: [-60, -16, -60, -14, -60, -18, -60, -20, -60, -60], fb: [0, 0.93, 0, 0.92, 0, 0.94, 0, 0.91, 0, 0], res: [0.4, 0.8, 0.4, 0.8, 0.4, 0.8, 0.4, 0.8, 0.4, 0.4] }),
      'lfo1.on': 1, 'lfo1.shape': 5, 'lfo1.rate': 0.15, 'lfo2.on': 1, 'lfo2.shape': 5, 'lfo2.rate': 0.11, 'lfo2.phase': 0.5,
    },
    mods: [
      ['lfo1', 'band1.gain', 0.05],
      ['lfo2', 'band5.gain', 0.05],
      ['lfo1', 'spread', 0.6],
    ],
  }),
  preset('Random Shimmer', 'Modulation', {
    params: {
      'clock.bpm': 96, spread: 0.5,
      'lfo1.on': 1, 'lfo1.shape': 4, 'lfo1.sync': 1, 'lfo1.div': 7, 'lfo1.smooth': 0.3,
      'lfo2.on': 1, 'lfo2.shape': 5, 'lfo2.rate': 1.3,
      'lfo3.on': 1, 'lfo3.shape': 4, 'lfo3.sync': 1, 'lfo3.div': 4, 'lfo3.uni': 1,
      'cmod1.on': 1, 'cmod1.mode': 3, 'cmod1.div': 10, 'cmod1.uni': 0, 'cmod1.slew': 0.6,
      ...bands({ res: [0.4, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.75] }),
    },
    mods: [
      ['lfo1', 'band7.res', 0.25],
      ['lfo2', 'band8.res', 0.25],
      ['lfo3', 'band9.gain', 0.4],
      ['cmod1', 'spread', 0.4],
    ],
  }),
  preset('Macro Morph', 'Performance', {
    params: { 'lfo1.on': 1, 'lfo1.rate': 0.4, 'lfo1.shape': 1, fbAllOn: 1, fbAll: 0.15, 'filterPost.on': 1, 'filterPost.cutoff': 1200, ...NARROW() },
    mods: [
      ['macro1', 'resOffset', 0.45],
      ['macro1', 'filterPost.cutoff', 0.55],
      ['macro1', 'fbAll', 0.46],
      ['lfo1', 'band3.res', 0],
      ['lfo1', 'band6.res', 0],
      ['macro2', 'route3.depth', 0.4],
      ['macro2', 'route4.depth', -0.4],
      ['macro2', 'lfo1.rate', 0.35],
    ],
    macros: ['Open', 'Motion'],
  }),
  preset('Tempo Gate', 'Rhythm', {
    params: {
      'clock.bpm': 128, fbAllOn: 1, fbAll: 0.23, fbAllTone: 5000,
      'cmod1.on': 1, 'cmod1.mode': 0, 'cmod1.div': 7, 'cmod1.slew': 0.1,
      'dyn.on': 1, 'dyn.threshold': -24, 'dyn.ratio': 3, ...NARROW(),
    },
    mods: [['cmod1', 'fbAll', 0.46]],
  }),
];

type ModDef = [source: string, target: string, depth: number];

/** factory preset with routes in consecutive slots (depths become `route{slot}.depth` params) */
function preset(
  name: string,
  category: string,
  d: { params?: Record<string, number>; mods?: ModDef[]; triggers?: [string, string][]; macros?: string[] },
): FactoryPresetDef {
  const params = { ...d.params };
  const routes = (d.mods ?? []).map(([source, target, depth], slot) => {
    params[`route${slot}.depth`] = depth;
    return { slot, source, target };
  });
  const names = Array.from({ length: 8 }, (_, i) => d.macros?.[i] ?? `Macro ${i + 1}`);
  return {
    name,
    category,
    params,
    routes,
    triggers: (d.triggers ?? []).map(([source, target]) => ({ source, target })),
    modules: d.macros ? { macros: { names } } : {},
  };
}

/** per-band values: bands({ res: [...10], fb: [...], gain: [...] }) → { band0.res: …, … } */
function bands(v: Partial<Record<'gain' | 'res' | 'fb', number[]>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, arr] of Object.entries(v)) arr?.forEach((x, b) => (out[`band${b}.${k}`] = x));
  return out;
}

/** all bands narrow (RES 0.45, the band default before v3) */
function NARROW(): Record<string, number> {
  return bands({ res: Array(10).fill(0.45) });
}

/** step values of clock mod n */
function steps(n: number, values: number[]): Record<string, number> {
  return Object.fromEntries(values.map((x, i) => [`cmod${n}.step${i}`, x]));
}

export const INIT_PRESET_ID = 'factory:init';

/** factory defs as presets (validated: a bad route in a def is dropped with a console warning) */
export function factoryPresets(defs: readonly FactoryPresetDef[] = FACTORY_PRESETS): Preset[] {
  const ids = new Set<string>();
  return defs.map((d) => {
    let id = `factory:${fileSlug(d.name)}`;
    for (let k = 2; ids.has(id); k++) id = `factory:${fileSlug(d.name)}-${k}`;
    ids.add(id);
    const report = newReport();
    const snapshot = sanitizeSnapshot(
      { format: 'da-resonator', version: SNAPSHOT_VERSION, params: d.params ?? {}, routes: d.routes ?? [], triggers: d.triggers ?? [], modules: d.modules ?? {} },
      report,
    );
    if (report.unknownParams.length || report.invalidParams.length || report.droppedRoutes.length) {
      console.warn(`[presets] factory preset "${d.name}":`, report);
    }
    return { id, name: d.name, category: d.category, created: 0, snapshot, factory: true };
  });
}
