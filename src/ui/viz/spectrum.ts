/**
 * Spectrum sampling on the band axis (see shell/bandAxis.ts): reads two analysers (trace A in
 * dispIn, trace B in dispOut; by default the engine's input and output) into one value per drawing
 * column, with fall smoothing and optional peak hold. Without analysers (mock engine) it
 * synthesises a plausible picture from the level meters.
 */
import type { EngineAPI } from '../../core/types';
import { freqOfX } from '../shell/bandAxis';

/** analyser display range (dBFS) */
export const SPEC_TOP = -12;
export const SPEC_BOT = -108;

export interface SpectrumOptions {
  /** design px per column (default 2) */
  colPx?: number;
  /** keep a peak-hold trace that falls after `holdMs` (default off) */
  peakHold?: boolean;
  holdMs?: number;
  /** fall time constant in ms (default 140) */
  fallMs?: number;
  /** how fast the peak-hold trace drops after `holdMs`, dB per second (default 24) */
  dropDbPerSec?: number;
}

/** what a synthetic trace stands for (mock engine): input or output, of one channel or both (-1) */
export interface SynthTrace {
  kind: 'in' | 'out';
  ch: 0 | 1 | -1;
}

export class SpectrumSampler {
  readonly colPx: number;
  dispIn = new Float32Array(0);
  dispOut = new Float32Array(0);
  peakIn = new Float32Array(0);
  peakOut = new Float32Array(0);
  private peakAgeIn = new Float32Array(0);
  private peakAgeOut = new Float32Array(0);
  private freqs = new Float32Array(0);
  private bins: Float32Array<ArrayBuffer> = new Float32Array(0);
  private w = 0;
  /** optional shape (dB) for the synthetic fallback's output trace */
  synthShape: ((f: number) => number) | null = null;
  /** analysers for trace A and B (null: the engine's input and output analysers) */
  pick: (() => [AnalyserNode | null, AnalyserNode | null]) | null = null;
  /** what traces A and B stand for when there are no analysers */
  synthTraces: [SynthTrace, SynthTrace] = [
    { kind: 'in', ch: -1 },
    { kind: 'out', ch: -1 },
  ];

  constructor(
    private engine: EngineAPI,
    private opts: SpectrumOptions = {},
  ) {
    this.colPx = opts.colPx ?? 2;
  }

  get width(): number {
    return this.w;
  }

  /** number of drawing columns */
  get cols(): number {
    return this.dispOut.length;
  }

  /** x of column i */
  x(i: number): number {
    return Math.min(this.w, i * this.colPx);
  }

  /** frequency at the left edge of column i */
  freqAt(i: number): number {
    return this.freqs[i] ?? 1000;
  }

  resize(w: number): void {
    this.w = w;
    const cols = Math.ceil(w / this.colPx) + 1;
    this.freqs = new Float32Array(cols + 1);
    for (let i = 0; i <= cols; i++) this.freqs[i] = freqOfX(i * this.colPx, w);
    this.dispIn = new Float32Array(cols).fill(SPEC_BOT);
    this.dispOut = new Float32Array(cols).fill(SPEC_BOT);
    this.peakIn = new Float32Array(cols).fill(SPEC_BOT);
    this.peakOut = new Float32Array(cols).fill(SPEC_BOT);
    this.peakAgeIn = new Float32Array(cols);
    this.peakAgeOut = new Float32Array(cols);
  }

  /** forget the traces (e.g. after the audio stopped) */
  clear(): void {
    this.dispIn.fill(SPEC_BOT);
    this.dispOut.fill(SPEC_BOT);
    this.peakIn.fill(SPEC_BOT);
    this.peakOut.fill(SPEC_BOT);
  }

  /** read the analysers once; call every frame while visible and running */
  update(dt: number): void {
    if (!this.w) return;
    const decay = Math.pow(0.5, dt / (this.opts.fallMs ?? 140));
    const [inA, outA] = this.pick ? this.pick() : [this.engine.analyserIn, this.engine.analyserOut];
    if (outA || inA) {
      if (outA) this.fromAnalyser(outA, this.dispOut, decay);
      if (inA) this.fromAnalyser(inA, this.dispIn, decay);
    } else {
      this.synthesise(decay);
    }
    if (this.opts.peakHold) {
      this.hold(this.dispIn, this.peakIn, this.peakAgeIn, dt);
      this.hold(this.dispOut, this.peakOut, this.peakAgeOut, dt);
    }
  }

  /** peak-hold drop speed in dB per second */
  set dropDbPerSec(v: number) {
    this.opts.dropDbPerSec = v;
  }

  private hold(disp: Float32Array, peak: Float32Array, age: Float32Array, dt: number): void {
    const holdMs = this.opts.holdMs ?? 1500;
    const fall = (dt / 1000) * (this.opts.dropDbPerSec ?? 24); // dB per second after the hold time
    for (let i = 0; i < disp.length; i++) {
      if (disp[i] >= peak[i]) {
        peak[i] = disp[i];
        age[i] = 0;
      } else {
        age[i] += dt;
        if (age[i] > holdMs) peak[i] = Math.max(disp[i], peak[i] - fall);
      }
    }
  }

  private fromAnalyser(a: AnalyserNode, disp: Float32Array, decay: number): void {
    if (this.bins.length !== a.frequencyBinCount) this.bins = new Float32Array(a.frequencyBinCount);
    a.getFloatFrequencyData(this.bins);
    const binHz = a.context.sampleRate / a.fftSize;
    const n = this.bins.length;
    for (let i = 0; i < disp.length; i++) {
      const f0 = this.freqs[i];
      const f1 = this.freqs[i + 1];
      let b0 = Math.floor(f0 / binHz);
      const b1 = Math.min(n - 1, Math.max(b0, Math.floor(f1 / binHz)));
      b0 = Math.min(n - 1, b0);
      let v = -Infinity;
      if (b1 > b0) for (let b = b0; b <= b1; b++) v = Math.max(v, this.bins[b]);
      else {
        // interpolate between bins at low frequencies
        const fb = f0 / binHz;
        const k = Math.min(n - 2, Math.floor(fb));
        const t = fb - k;
        v = this.bins[k] * (1 - t) + this.bins[k + 1] * t;
      }
      if (!Number.isFinite(v)) v = SPEC_BOT;
      disp[i] = Math.max(v, disp[i] * decay + v * (1 - decay));
    }
  }

  private synthesise(decay: number): void {
    const fr = this.engine.meters.latest();
    const lvl = (t: SynthTrace) => {
      const pair = t.kind === 'in' ? fr?.inPeak : fr?.outPeak;
      const a = pair ? (t.ch === -1 ? Math.max(pair[0], pair[1]) : pair[t.ch]) : 0;
      return Math.max(-80, 20 * Math.log10(Math.max(1e-5, a)));
    };
    const [sA, sB] = this.synthTraces;
    const dbA = lvl(sA);
    const dbB = lvl(sB);
    const trace = (t: SynthTrace, db: number, fq: number, tilt: number, jit: number) =>
      t.kind === 'in' ? db - 46 + tilt + jit : db - 44 + tilt * 0.6 + (this.synthShape ? this.synthShape(fq) * 1.2 : 0) + jit;
    for (let i = 0; i < this.dispOut.length; i++) {
      const fq = this.freqs[i];
      const tilt = -4.5 * Math.log2(fq / 300) - (fq < 40 ? (40 - fq) * 0.6 : 0) - (fq > 14000 ? (fq - 14000) * 0.003 : 0);
      const jit = () => (Math.random() - 0.5) * 9;
      const tIn = trace(sA, dbA, fq, tilt, jit());
      const tOut = trace(sB, dbB, fq, tilt, jit());
      this.dispIn[i] = Math.max(tIn, this.dispIn[i] * decay + tIn * (1 - decay));
      this.dispOut[i] = Math.max(tOut, this.dispOut[i] * decay + tOut * (1 - decay));
    }
  }
}
