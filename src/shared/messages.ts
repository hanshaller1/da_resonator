/** Messages between main thread and the resonator AudioWorklet. */
import type { ModConfig } from './mod/rules';

export const WORKLET_NAME = 'erica-resonator';

/** main -> worklet */
export type ToWorklet =
  | { type: 'params'; values: Float32Array } // base (unmodulated) plain values, length NUM_PARAMS, ordered by ParamSpec.index
  | { type: 'modConfig'; config: ModConfig } // modulation routes (validated on the main thread)
  | { type: 'clockReset' } // clock to beat 0, LFO / clock mod phases to 0
  | { type: 'reset' } // clear all filter / feedback state (panic)
  | { type: 'meterRate'; hz: number }; // meter frames per second (default 30)

/** One meter frame. All values linear amplitude (not dB). */
export interface MeterFrame {
  inPeak: [number, number];
  outPeak: [number, number];
  /** per band RMS after the fader (L/R combined), length NUM_BANDS */
  bands: Float32Array;
  /**
   * per band gain change of the band dynamics in dB since the last frame (largest magnitude),
   * length NUM_BANDS: positive = gain reduction, negative = boost (upward expansion), 0 while off
   */
  dynGR: Float32Array;
  /** true if a band currently exceeds unity inside a feedback loop (UI may flash) */
  hot: boolean;
}

/** Modulation readout, ~60 Hz. */
export interface ModFrame {
  /** current value of every modulation source (shared/mod/sources.ts SOURCES order) */
  src: Float32Array;
  /** pairs [paramIndex, effective normalized value] for every modulated param */
  mod: Float32Array;
  /** clock position in beats */
  beats: number;
  /** effective tempo */
  bpm: number;
}

/** worklet -> main */
export type FromWorklet = { type: 'ready' } | ({ type: 'meters' } & MeterFrame) | ({ type: 'mod' } & ModFrame);
