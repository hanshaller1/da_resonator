/** Messages between main thread and the resonator AudioWorklet. */
import type { ModConfig } from './mod/rules';

export const WORKLET_NAME = 'erica-resonator';

/** main -> worklet */
export type ToWorklet =
  | { type: 'params'; values: Float32Array } // base (unmodulated) plain values, length NUM_PARAMS, ordered by ParamSpec.index
  | { type: 'modConfig'; config: ModConfig } // modulation routes (validated on the main thread)
  | { type: 'clockReset' } // internal clock to beat 0, phases of the LFOs / clock mods on it to 0
  | { type: 'reset' } // clear all filter / feedback state (panic)
  | { type: 'meterRate'; hz: number } // meter frames per second (default 30)
  | { type: 'clockOn'; int: boolean; midi: boolean } // which clocks are on (a clock that is off stands still)
  | { type: 'midiClock'; ev: number; t: number } // MIDI clock event (dsp/extClock.ts MIDI_TICK …) at AudioContext time t
  | { type: 'wobble'; band: number; ch: 0 | 1 | 2; on: boolean }; // FB function key held / let go (ch 0 = L and R, 1 = L, 2 = R)

/** One meter frame. All values linear amplitude (not dB). */
export interface MeterFrame {
  inPeak: [number, number];
  outPeak: [number, number];
  /** per band RMS after the fader (L/R combined), length NUM_BANDS */
  bands: Float32Array;
  /** per band RMS in L and in R after the fader and SPREAD (what each band sends to that side), length NUM_BANDS */
  bandsL: Float32Array;
  bandsR: Float32Array;
  /**
   * per band gain change of the band dynamics in dB since the last frame (largest magnitude),
   * length NUM_BANDS: positive = gain reduction, negative = boost (upward expansion), 0 while off
   */
  dynGR: Float32Array;
  /** per band the peak level the band dynamics measure (band, input or output analysis), 0 while off */
  dynLvl: Float32Array;
  /** band scanner (CLK MOD → SCAN): its layer per slot (band·2 + channel) in dB, 0 while off or locked */
  scanDb: Float32Array;
  /** band of the scanner's last step on L and R (−1 while off / before the first step) */
  scanPos: [number, number];
  /** true if a band currently exceeds unity inside a feedback loop (UI may flash) */
  hot: boolean;
}

/** Modulation readout, ~60 Hz. */
export interface ModFrame {
  /** current value of every modulation source (shared/mod/sources.ts SOURCES order) */
  src: Float32Array;
  /** pairs [paramIndex, effective normalized value] for every modulated param */
  mod: Float32Array;
  /** internal clock: position in beats, tempo, 1 while it moves (ON and RUN) */
  beats: number;
  bpm: number;
  run: number;
  /** MIDI clock: position in beats, measured tempo, 1 while it moves (ON, Start / Stop) */
  midiBeats: number;
  midiBpm: number;
  midiRun: number;
}

/** worklet -> main */
export type FromWorklet = { type: 'ready' } | ({ type: 'meters' } & MeterFrame) | ({ type: 'mod' } & ModFrame);
