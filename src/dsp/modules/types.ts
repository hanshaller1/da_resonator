/**
 * Contracts for modules that run inside the AudioWorklet (bundled with resonator.worklet.ts).
 * Only import from ../../shared/* and siblings here: no DOM, no Web Audio nodes.
 */

export interface ClockState {
  bpm: number;
  running: boolean;
  /** position in beats at the end of the current block */
  beats: number;
  /** position in beats at the start of the current block */
  beatsPrev: number;
}

/** Everything a module sees during one audio block (128 samples). */
export interface BlockCtx {
  fs: number;
  /** samples in this block */
  n: number;
  /** seconds per block */
  dt: number;
  /**
   * Effective plain value of every param (base + modulation), indexed by ParamSpec.index.
   * Valid for the module's own params when its update() runs (the graph order guarantees it).
   */
  eff: Float32Array;
  clock: ClockState;
  /**
   * Mono tap buffers (EF_TAPS order, shared/paramdefs/modules.ts): input after the pre filter,
   * each band after its fader, resonator wet sum, final output. Filled during the audio pass,
   * so update() sees the previous block and analyse() sees the current one.
   */
  taps: Float32Array[];
  /**
   * The same taps per channel (L, R), filled only while a follower that is on listens to L or R
   * (ModEngine.lrTaps); otherwise they hold stale samples.
   */
  tapsL: Float32Array[];
  tapsR: Float32Array[];
  /** true if trigger input `inIndex` (TRIGGER_INS) fired since this module last ran */
  triggered(inIndex: number): boolean;
  /** emit trigger output `outIndex` (TRIGGER_OUTS); reaches modules later in the graph this block */
  fire(outIndex: number): void;
}

/** A modulation source (LFO, clock mod, env follower). One instance per slot. */
export interface SourceDsp {
  /**
   * Called once per block in graph order while the module is on. Returns the source value:
   * bipolar -1..1 or unipolar 0..1 (already scaled by the module's level).
   */
  update(ctx: BlockCtx): number;
  /**
   * optional: the value for the R side of L/R targets, valid after update() (LFO R PHASE);
   * without it the R side gets the same value as L
   */
  readonly valueR?: number;
  /** optional: called after the audio pass of every block (analysers read ctx.taps here) */
  analyse?(ctx: BlockCtx): void;
  /** panic / clock reset */
  reset(): void;
}

/** An audio stage processing a stereo block in place (pre / post filter). */
export interface AudioStage {
  /**
   * eff params are final for this block when process() runs.
   * Returns false if the stage left the audio untouched (off), true if it processed it.
   */
  process(l: Float32Array, r: Float32Array, n: number, ctx: BlockCtx): boolean;
  reset(): void;
}
