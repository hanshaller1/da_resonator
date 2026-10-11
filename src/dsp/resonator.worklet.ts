/**
 * Erica Synths "Resonant Filterbank" emulation: AudioWorklet DSP core.
 *
 * Bundled by esbuild into one IIFE script, so it may only import from ../shared/*.
 *
 * ─── Signal flow (per channel; L and R have their own filters) ───────────────
 *   in ─► input gain (0..24 dB) ─► analog saturator ─► (+ noise floor) ─► (+ Feedback-All return)
 *      ─► 10 × [ TPT SVF bandpass with its own feedback loop ─► band dynamics ] ─► fader ─► odd/even spread ─► Σ wet
 *   Σ wet ─► Feedback-All loop: tone LP ─► DC block ─► soft clip ─► × amount ─► (back to the band inputs, 1-sample delay)
 *   out = safetyClip( (dry·cos(mix·π/2) + wet·sin(mix·π/2)) · outputGain ), crossfaded with dry by bypass.
 *
 * ─── Mappings ─────────────────────────────────────────────────────────────────
 *  Band filter : Zavalishin TPT state-variable filter, output = k·BP (k = 1/Q), i.e. unity gain at the
 *                centre for every Q (constant-peak form). 2nd-order skirts (≈ hardware's ~17 dB/dec).
 *                After the band's own loop a resonance makeup gain (Q/Q_ref)^0.7 lifts the peak like an
 *                analog resonant bandpass (shared/params.ts resonanceMakeup; 0 dB at res 0.45), so more
 *                resonance = louder, fuller ringing. The Feedback-All return takes the band sum before
 *                this makeup, so the FB All edge stays independent of resonance.
 *  Resonance   : r = clamp(band.res + resOffset, 0, 1);  Q = 0.6 · 200^r   → 0.6 … 120
 *                (r = 0.3 → Q ≈ 2.9, r = 0.5 → Q ≈ 8.5, r = 1 → Q = 120: the 29 Hz band rings ~9 s to -60 dB,
 *                 115 Hz ~2 s). The linear filter is unconditionally stable for any Q.
 *  Analog sat  : amplitude-dependent damping: k_eff = k + 0.03·analog·e²/(1 + e²/4) (e = peak envelope of
 *                the band output; output normalisation keeps the nominal k). Like a soft-limiting integrator stage it
 *                barely touches low-Q bands but makes loud high-Q ringing compress and decay faster at first,
 *                independent of the band's frequency.
 *  Band fb     : loop gain at the centre G = fb / 0.87 up to the edge of self-oscillation (fb = 0.87, G = 1);
 *                above it G rises linearly to 1.15 + 0.03·Q at fb = 1 (Q-dependent so narrow, high-Q bands
 *                still start oscillating within a second or two). fb = 1 sustains a steady sine at the band
 *                centre (measured ≈ ±0.55…0.77 peak with analog 0.5).
 *                The loop is solved delay-free (implicitly; the SVF output is linear in its input), so the
 *                oscillation pitch is exactly the band centre even at 11 kHz. The loop limiter is a gain
 *                factor 1/√(1+(G·env)²) driven by a fast peak envelope of the band output (instant attack,
 *                20 ms release; ripple at low frequencies adds a little analog-style harmonic colour). Steady
 *                self-oscillation amplitude ≈ √(G²−1)/G (≈ 0.5 at low Q … ≈ 0.97 at high Q, less with analog
 *                damping), always < 1.
 *                The SVF bandpass has zero DC gain, so the loop needs no extra DC blocker (it is DC-free by
 *                construction; the limiter is symmetric so it creates no DC either). This deliberately differs
 *                from a "one-sample-delayed, DC-blocked" loop: a unit delay detunes the oscillation by up to
 *                ~80° of phase at 11 kHz.
 *  Feedback All: loop gain = amount × (summed band response, which peaks ≈ 1.2–1.3 where neighbouring
 *                bands overlap in phase). With faders at 0 dB the loop reaches the edge of self-oscillation
 *                around amount ≈ 0.8; amount 1 self-oscillates. Bounded by a soft clipper after the gain,
 *                r/√(1+(r/0.7)²), so the return never exceeds 0.7.
 *  Spread      : per band, mid m = (L+R)/2, side d = (L−R)/2. Odd bands (1,3,5,7,9; index 0,2,…) pan m
 *                towards L, even bands towards R with centre-normalised equal-power gains
 *                gL = √2·cos θ, gR = √2·sin θ, θ = π/4 ∓ spread·π/4; the side part fades with (1−spread).
 *                spread 0 = untouched stereo, spread 1 = odd bands hard L, even hard R.
 *  Mix         : equal-power: dry·cos(mix·π/2) + wet·sin(mix·π/2). Dry = raw input (before input gain).
 *  Output      : outputGain dB, then a safety soft clip: linear up to 0.8, tanh knee to a ceiling of 1.0.
 *  Analog      : 0..1 scales input-saturator asymmetry/knee (rail level 2.5 → 1.5, bias 0.15), the damping above, fixed component tolerance
 *                (centre detune ±0.5…1.5 %, Q ±5 %, per band and per channel, deterministic seed), slow
 *                drift (≤ 0.15 %), and a noise floor of −96 dBFS (a −180 dBFS floor is always present so
 *                self-oscillation can start from silence even at analog = 0).
 *  Dynamics    : "Dynamic EQ" of the original (plan E7): per band a stereo-linked feed-forward compressor /
 *                upward expander after the band's own loop, before fader and makeup. Self-oscillation keeps
 *                its pitch (the band loop is untouched) but its level is controlled; Feedback All taps the
 *                post-fader sum, so the dynamics tame that loop too.
 *                Detector: instantaneous amplitude of the band output from the SVF's own states,
 *                A² = k²·(BP² − LP·HP). For a single sine this is exact at any frequency (|LP|·|HP| = |BP|²,
 *                LP and HP in antiphase), so there is no ripple even at 29 Hz and no extra filter. It is
 *                read from the stored states every DYN_DET samples, outside the hot filter loop. Level =
 *                louder channel, peak dBFS of the band signal (a sine of peak 0.1 reads −20 dB).
 *                Gain computer every DYN_SUB samples (0.33 ms) on the detector peak of that step: gain change
 *                c = (L − T)·(1 − 1/ratio) above the threshold, clamped to ±range (ratio > 1 cuts, < 1 boosts),
 *                smoothed in dB (attack while |c| grows, else release), scaled by the band's amount and the
 *                on/off ramp (10 ms), then the linear gain is interpolated per sample (no zipper).
 *                Off = no per-sample work and bit-identical output. GR/range → mod sources dyn1..10.
 *  Modulation  : runs in this worklet (ModEngine): once per block the modulation graph computes effective
 *                values (base + routes) for every param; the resonator smooths towards them. Modulated params
 *                use τ = 3 ms instead of 20 ms so fast LFOs are not dulled.
 *  Chain       : in ─► pre filter ─► resonator (above) ─► post filter ─► out. Tap buffers (input, every band,
 *                wet sum, output) feed the envelope followers.
 *  Smoothing   : all continuous params are smoothed per sample with a one-pole (τ = 20 ms); filter
 *                coefficients (and the smoothed resonance feeding them) are updated every 32 samples, and only
 *                when centre/Q moved by > 1e-5 relative. Toggles (fbAllOn, bypass) are linear 10 ms crossfades.
 */
import { WORKLET_NAME } from '../shared/messages';
import {
  BAND_FREQS,
  NUM_BANDS,
  NUM_RESONATOR_PARAMS,
  G,
  bandParamIndex,
  dbToGain,
  paramIndex,
  resonanceMakeup,
} from '../shared/params';
import { TAP_BAND0, TAP_IN, TAP_OUT, TAP_RES_OUT } from '../shared/paramdefs/modules';
import type { ModConfig } from '../shared/mod/rules';
import { SRC_DYN0 } from '../shared/mod/sources';
import { MAX_BLOCK, ModEngine } from './ModEngine';

/* ---------- minimal AudioWorkletGlobalScope typings ---------- */
interface WorkletPort {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
declare class AudioWorkletProcessor {
  readonly port: WorkletPort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: any) => AudioWorkletProcessor): void;
declare const sampleRate: number;

/* ---------- constants ---------- */
const NB = NUM_BANDS;
const NS = NB * 2; // band × channel filter slots, index = b*2 + ch
const SUB = 32; // coefficient / slow-param update interval (samples)
const Q_MIN = 0.6;
const Q_RANGE_LN = Math.log(200); // Q = 0.6 * 200^r
const BAND_FB_EDGE = 0.87; // fb value where the centre loop gain reaches 1
const BAND_FB_SLOPE = 1 / BAND_FB_EDGE; // loop gain per unit fb below the edge
const BAND_CLIP_L = 1.0; // per-band loop limiter level (bounds the fed-back signal)
const BAND_CLIP_INV = 1 / BAND_CLIP_L;
const NL_DAMP = 0.03; // amplitude-dependent extra damping (Δk at |y| = 1, analog = 1)
const FBALL_MAX = 1.0; // Feedback-All loop gain at amount = 1
const FBALL_CLIP_L = 0.7; // Feedback-All return limit
const FBALL_CLIP_INV = 1 / FBALL_CLIP_L;
const TOL_DETUNE = 0.01; // ±0.5…1.5 % at analog = 1
const TOL_Q = 0.05;
const DRIFT_AMT = 0.0015;
const NOISE_ANALOG = 1.6e-5 * Math.sqrt(3); // uniform noise with RMS ≈ -96 dBFS at analog = 1
const NOISE_FLOOR = 1e-9;
const SQRT2 = Math.SQRT2;
const QUARTER_PI = Math.PI / 4;
const HALF_PI = Math.PI / 2;
const DYN_SUB = 16; // band dynamics gain computer interval (samples); the gain is interpolated in between
const DYN_DET = 8; // detector sampling interval (samples, divides DYN_SUB): A² is smooth, see header
const DB_PER_LN_POW = 10 / Math.LN10; // ln(power ratio) → dB
const LN_GAIN_PER_DB = Math.LN10 / 20; // dB → ln(amplitude ratio)

function fastTanh(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** deterministic xorshift32 → [0,1) */
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/* global param slots inside the smoothed arrays */
const S_IN = 0, S_ANALOG = 1, S_RESOFF = 2, S_FBALL = 3, S_TONE = 4, S_SPREAD = 5, S_DRY = 6, S_WET = 7, S_OUT = 8;
const NUM_GS = 9;

/** smoothing time constants: unmodulated / modulated params */
const TAU_SLOW = 0.02;
const TAU_FAST = 0.003;

class ResonatorProcessor extends AudioWorkletProcessor {
  private fs = sampleRate;
  private mod: ModEngine;
  private gotParams = false;
  private appliedVersion = -1;
  // per-slot smoothing coefficients (fast for modulated params)
  private gA = new Float64Array(NUM_GS);
  private bGainA = new Float64Array(NB);
  private bFbA = new Float64Array(NB);
  private bResA = new Float64Array(NB);
  private preL = new Float32Array(MAX_BLOCK);
  private preR = new Float32Array(MAX_BLOCK);

  // smoothed globals (current / target)
  private gCur = new Float64Array(NUM_GS);
  private gTgt = new Float64Array(NUM_GS);
  // smoothed per-band: linear fader gain, fb amount, res
  private bGainCur = new Float64Array(NB);
  private bGainTgt = new Float64Array(NB);
  private bFbCur = new Float64Array(NB);
  private bFbTgt = new Float64Array(NB);
  private bResCur = new Float64Array(NB);
  private bResTgt = new Float64Array(NB);
  private bFbExcess = new Float64Array(NB); // loop gain - 1 at fb = 1 (depends on Q)
  private bMakeup = new Float64Array(NB).fill(1); // target resonance peak gain (post loop)
  private bMakeupCur = new Float64Array(NB).fill(1); // per-sample smoothed
  // toggles (ramped 0..1)
  private fbOnCur = 0;
  private fbOnTgt = 0;
  private bypCur = 0;
  private bypTgt = 0;

  private toggleStep: number;

  // filter coefficients per slot
  private cA1 = new Float64Array(NS);
  private cA2 = new Float64Array(NS);
  private cA3 = new Float64Array(NS);
  private cK = new Float64Array(NS);
  private cG = new Float64Array(NS); // prewarped integrator gain g = tan(π f / fs)
  private cLastF = new Float64Array(NS); // f, q the coefficients were computed for
  private cLastQ = new Float64Array(NS);
  // filter state per slot
  private ic1 = new Float64Array(NS);
  private ic2 = new Float64Array(NS);
  private yPrev = new Float64Array(NS);
  private env = new Float64Array(NS); // per-slot peak envelope (instant attack, 20 ms release)
  private envRel: number;

  // analog component tolerance & drift
  private tolF = new Float64Array(NS);
  private tolQ = new Float64Array(NS);
  private driftCur = new Float64Array(NS);
  private driftTgt = new Float64Array(NS);
  private driftTimer = new Float64Array(NS);
  private rng = makeRng(0x5eed1234);
  private noiseState = 0x9e3779b9 >>> 0;

  // feedback-all loop state per channel
  private faLp = new Float64Array(2);
  private faDcX = new Float64Array(2);
  private faDcY = new Float64Array(2);
  private faRet = new Float64Array(2);
  private faLpA = 0;
  private dcR: number;

  private subCount = 0;

  // meters
  private meterInterval: number;
  private meterCount = 0;
  private mInPk = new Float64Array(2);
  private mOutPk = new Float64Array(2);
  private mBandSq = new Float64Array(NB);
  private mHot = false;
  private meterBands = new Float32Array(NB);

  // band dynamics (see header). Param indices, looked up once.
  private iDynOn = paramIndex('dyn.on');
  private iDynThr = paramIndex('dyn.threshold');
  private iDynRatio = paramIndex('dyn.ratio');
  private iDynAtk = paramIndex('dyn.attack');
  private iDynRel = paramIndex('dyn.release');
  private iDynRange = paramIndex('dyn.range');
  private iDynAmt: number[] = [];
  /** true while the dynamics run (on, or ramping out); false = no per-sample work at all */
  private dynLive = false;
  private dynOnCur = 0;
  private dynOnTgt = 0;
  // smoothed at the gain-computer rate: threshold (dB), slope 1 − 1/ratio, range (dB), per-band amount
  private dThrCur = 0;
  private dThrTgt = 0;
  private dSlopeCur = 0;
  private dSlopeTgt = 0;
  private dRangeCur = 0;
  private dRangeTgt = 0;
  private dAmtCur = new Float64Array(NB);
  private dAmtTgt = new Float64Array(NB);
  private dSmA = 0; // smoothing per DYN_SUB step (threshold / ratio / range)
  private dAmtA = new Float64Array(NB);
  private dAtkA = 0; // gain change smoothing per DYN_SUB step
  private dRelA = 0;
  private dAtkMs = -1;
  private dRelMs = -1;
  private dSub = 0;
  private dPk = new Float64Array(NB); // detector: max A² of the current step
  private dGr = new Float64Array(NB); // smoothed gain change (dB, + = reduction) before amount / ramp
  private dGc = new Float64Array(NB); // applied gain change (dB)
  private dG = new Float64Array(NB).fill(1); // linear gain, interpolated per sample
  private dGTgt = new Float64Array(NB).fill(1);
  private dGStep = new Float64Array(NB);
  private mGr = new Float64Array(NB); // meter: applied gain change with the largest magnitude since the last frame

  constructor(options?: unknown) {
    super(options);
    const fs = this.fs;
    this.mod = new ModEngine(fs, (m) => this.port.postMessage(m));
    for (let b = 0; b < NB; b++) this.iDynAmt.push(paramIndex(`band${b}.dyn`));
    this.updateSmoothing();
    this.toggleStep = 1 / (0.01 * fs);
    this.dcR = 1 - (2 * Math.PI * 8) / fs;
    this.envRel = Math.exp(-1 / (0.02 * fs));
    this.meterInterval = Math.max(1, Math.round(fs / 30));

    const rng = makeRng(0xe71ca);
    for (let i = 0; i < NS; i++) {
      const sign = rng() < 0.5 ? -1 : 1;
      this.tolF[i] = sign * (0.5 + rng()) * TOL_DETUNE;
      this.tolQ[i] = (rng() * 2 - 1) * TOL_Q;
      this.driftCur[i] = this.driftTgt[i] = (rng() * 2 - 1) * DRIFT_AMT;
      this.driftTimer[i] = rng() * 2;
    }

    this.applyParams(this.mod.eff, true);
    this.updateCoefs();

    this.port.onmessage = (e) => this.onMessage(e.data as any);
    this.port.postMessage({ type: 'ready' });
  }

  private onMessage(msg: { type: string; values?: Float32Array; hz?: number; config?: ModConfig }) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'params':
        // base values; shorter arrays (resonator only, v1 senders) leave module params untouched
        if (msg.values && msg.values.length >= NUM_RESONATOR_PARAMS) {
          this.mod.setBase(msg.values);
          if (!this.gotParams) this.applyParams(this.mod.eff, true);
          this.gotParams = true;
        }
        break;
      case 'modConfig':
        if (msg.config && Array.isArray(msg.config.routes) && Array.isArray(msg.config.triggers)) {
          this.mod.setConfig(msg.config);
          this.updateSmoothing();
        }
        break;
      case 'clockReset':
        this.mod.resetClock();
        break;
      case 'reset':
        this.resetState();
        this.mod.reset();
        break;
      case 'meterRate':
        if (typeof msg.hz === 'number' && msg.hz > 0) this.meterInterval = Math.max(1, Math.round(this.fs / msg.hz));
        break;
    }
  }

  /** per-param smoothing speed: modulated params follow faster */
  private updateSmoothing() {
    const fs = this.fs;
    const slow = 1 - Math.exp(-1 / (TAU_SLOW * fs));
    const fast = 1 - Math.exp(-1 / (TAU_FAST * fs));
    const slowSub = 1 - Math.exp(-SUB / (TAU_SLOW * fs));
    const fastSub = 1 - Math.exp(-SUB / (TAU_FAST * fs));
    const m = this.mod.modulated;
    const slotParam = [G.inputGain, G.analog, G.resOffset, G.fbAll, G.fbAllTone, G.spread, G.mix, G.mix, G.outputGain];
    for (let j = 0; j < NUM_GS; j++) this.gA[j] = m[slotParam[j]] ? fast : slow;
    for (let b = 0; b < NB; b++) {
      this.bGainA[b] = m[bandParamIndex(b, 'gain')] ? fast : slow;
      this.bFbA[b] = m[bandParamIndex(b, 'fb')] ? fast : slow;
      this.bResA[b] = m[bandParamIndex(b, 'res')] ? fastSub : slowSub;
    }
    const slowDyn = 1 - Math.exp(-DYN_SUB / (TAU_SLOW * fs));
    const fastDyn = 1 - Math.exp(-DYN_SUB / (TAU_FAST * fs));
    this.dSmA = m[this.iDynThr] || m[this.iDynRatio] || m[this.iDynRange] ? fastDyn : slowDyn;
    for (let b = 0; b < NB; b++) this.dAmtA[b] = m[this.iDynAmt[b]] ? fastDyn : slowDyn;
  }

  /** band dynamics targets from the effective values; once per block (cheap, no per-sample work while off) */
  private applyDyn(p: Float32Array) {
    const on = p[this.iDynOn] >= 0.5;
    this.dynOnTgt = on ? 1 : 0;
    if (!on && !this.dynLive) return;
    this.dThrTgt = clamp(p[this.iDynThr], -60, 0);
    this.dSlopeTgt = 1 - 1 / clamp(p[this.iDynRatio], 0.5, 20);
    this.dRangeTgt = clamp(p[this.iDynRange], 0, 36);
    for (let b = 0; b < NB; b++) this.dAmtTgt[b] = clamp(p[this.iDynAmt[b]], 0, 1);
    const atk = clamp(p[this.iDynAtk], 0.1, 200);
    const rel = clamp(p[this.iDynRel], 5, 2000);
    if (atk !== this.dAtkMs) {
      this.dAtkMs = atk;
      this.dAtkA = 1 - Math.exp(-DYN_SUB / (atk * 0.001 * this.fs));
    }
    if (rel !== this.dRelMs) {
      this.dRelMs = rel;
      this.dRelA = 1 - Math.exp(-DYN_SUB / (rel * 0.001 * this.fs));
    }
    if (!this.dynLive) {
      // waking up: start from the current settings and a clean detector, no glide from stale values
      this.dynLive = true;
      this.dThrCur = this.dThrTgt;
      this.dSlopeCur = this.dSlopeTgt;
      this.dRangeCur = this.dRangeTgt;
      this.dAmtCur.set(this.dAmtTgt);
      this.dPk.fill(0);
      this.dGr.fill(0);
      this.dGc.fill(0);
      this.dG.fill(1);
      this.dGTgt.fill(1);
      this.dGStep.fill(0);
      this.dSub = 0;
    }
  }

  /**
   * Detector, every DYN_DET samples after the band loop: instantaneous amplitude² of each band output
   * y = k·BP from the TPT states alone (s1 = BP + g·HP, s2 = LP + g·BP after the update), so the hot
   * filter loop stays untouched: A² = k²·(BP² − LP·HP). Stereo-linked: the louder channel, peak-held
   * until the next gain computer step.
   */
  private dynDetect() {
    const ic1 = this.ic1, ic2 = this.ic2, yPrev = this.yPrev, cK = this.cK, cG = this.cG, dPk = this.dPk;
    for (let b = 0; b < NB; b++) {
      let pk = dPk[b];
      for (let i = b * 2; i < b * 2 + 2; i++) {
        // with BP = y/k, LP = s2 − g·BP, HP = (s1 − BP)/g:  k²·LP·HP = (k·s2 − g·y)(k·s1 − y)/g
        const y = yPrev[i], k = cK[i], g = cG[i];
        const a2 = y * y - ((k * ic2[i] - g * y) * (k * ic1[i] - y)) / g;
        if (a2 > pk) pk = a2;
      }
      dPk[b] = pk;
    }
  }

  /**
   * Gain computer, every DYN_SUB samples: detector peak of the last step → gain change (dB) →
   * attack / release smoothing → amount × on-ramp → per-sample interpolation towards the new gain.
   */
  private dynStep(onRamp: number) {
    const sa = this.dSmA;
    this.dThrCur += (this.dThrTgt - this.dThrCur) * sa;
    this.dSlopeCur += (this.dSlopeTgt - this.dSlopeCur) * sa;
    this.dRangeCur += (this.dRangeTgt - this.dRangeCur) * sa;
    const thrDb = this.dThrCur, slope = this.dSlopeCur, range = this.dRangeCur;
    const thrP = Math.exp(thrDb / DB_PER_LN_POW); // threshold as A²
    const atkA = this.dAtkA, relA = this.dRelA;
    const dPk = this.dPk, dGr = this.dGr, dGc = this.dGc, dG = this.dG, dGTgt = this.dGTgt, dGStep = this.dGStep;
    const amtCur = this.dAmtCur, amtTgt = this.dAmtTgt, amtA = this.dAmtA, mGr = this.mGr;
    for (let b = 0; b < NB; b++) {
      const pk = dPk[b];
      dPk[b] = 0;
      let tgt = 0;
      if (pk > thrP) {
        tgt = DB_PER_LN_POW * Math.log(pk / thrP) * slope;
        if (tgt > range) tgt = range;
        else if (tgt < -range) tgt = -range;
      }
      let gr = dGr[b];
      gr += (tgt - gr) * (tgt * tgt > gr * gr ? atkA : relA);
      if (gr < 1e-9 && gr > -1e-9) gr = 0;
      dGr[b] = gr;
      const amt = (amtCur[b] += (amtTgt[b] - amtCur[b]) * amtA[b]);
      const gc = gr * amt * onRamp;
      dGc[b] = gc;
      if (gc * gc > mGr[b] * mGr[b]) mGr[b] = gc;
      // land exactly on the previous target (so "no change" is exactly 1), then glide to the new one
      const g0 = dGTgt[b];
      const g1 = gc > 1e-6 || gc < -1e-6 ? Math.exp(-gc * LN_GAIN_PER_DB) : 1;
      dG[b] = g0;
      dGTgt[b] = g1;
      dGStep[b] = (g1 - g0) * (1 / DYN_SUB);
    }
  }

  /** end of block: GR → mod sources (0..1 of the range); drop to idle once ramped out */
  private dynEndBlock() {
    const src = this.mod.srcVals;
    if (!this.dynLive) return;
    const range = this.dRangeCur;
    const inv = range > 0.01 ? 1 / range : 0;
    let settled = this.dynOnCur === 0;
    for (let b = 0; b < NB; b++) {
      const gc = this.dGc[b];
      const v = (gc < 0 ? -gc : gc) * inv;
      src[SRC_DYN0 + b] = v > 1 ? 1 : v;
      if (this.dG[b] !== 1 || this.dGTgt[b] !== 1) settled = false;
    }
    if (settled && this.dynOnTgt === 0) {
      this.dynLive = false;
      for (let b = 0; b < NB; b++) src[SRC_DYN0 + b] = 0;
    }
  }

  /** compute smoothing targets from plain param values; snap = jump instead of glide */
  private applyParams(p: Float32Array, snap: boolean) {
    const t = this.gTgt;
    t[S_IN] = dbToGain(clamp(p[G.inputGain], 0, 24));
    t[S_ANALOG] = clamp(p[G.analog], 0, 1);
    t[S_RESOFF] = clamp(p[G.resOffset], -1, 1);
    t[S_FBALL] = clamp(p[G.fbAll], 0, 1) * FBALL_MAX;
    t[S_TONE] = Math.log(clamp(p[G.fbAllTone], 200, 20000));
    t[S_SPREAD] = clamp(p[G.spread], 0, 1);
    const mix = clamp(p[G.mix], 0, 1);
    t[S_DRY] = Math.cos(mix * HALF_PI);
    t[S_WET] = Math.sin(mix * HALF_PI);
    t[S_OUT] = dbToGain(clamp(p[G.outputGain], -24, 12));
    this.fbOnTgt = p[G.fbAllOn] >= 0.5 ? 1 : 0;
    this.bypTgt = p[G.bypass] >= 0.5 ? 1 : 0;
    for (let b = 0; b < NB; b++) {
      this.bGainTgt[b] = dbToGain(p[bandParamIndex(b, 'gain')]);
      this.bResTgt[b] = clamp(p[bandParamIndex(b, 'res')], 0, 1);
      this.bFbTgt[b] = clamp(p[bandParamIndex(b, 'fb')], 0, 1);
    }
    if (snap) {
      this.gCur.set(t);
      this.bGainCur.set(this.bGainTgt);
      this.bResCur.set(this.bResTgt);
      this.bFbCur.set(this.bFbTgt);
      this.fbOnCur = this.fbOnTgt;
      this.bypCur = this.bypTgt;
    }
  }

  private resetState() {
    this.ic1.fill(0);
    this.ic2.fill(0);
    this.yPrev.fill(0);
    this.env.fill(0);
    this.faLp.fill(0);
    this.faDcX.fill(0);
    this.faDcY.fill(0);
    this.faRet.fill(0);
    this.dPk.fill(0);
    this.dGr.fill(0);
  }

  private resetSlot(i: number) {
    this.ic1[i] = 0;
    this.ic2[i] = 0;
    this.yPrev[i] = 0;
    this.env[i] = 0;
  }

  /** recompute SVF + tone coefficients from smoothed values; also advance drift */
  private updateCoefs() {
    const fs = this.fs;
    const an = this.gCur[S_ANALOG];
    const resOff = this.gCur[S_RESOFF];
    const fMax = 0.45 * fs;
    const dt = SUB / fs;
    const driftSlew = 1 - Math.exp(-dt / 1.5);
    for (let b = 0; b < NB; b++) {
      let r = this.bResCur[b] + resOff;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      const qNom = Q_MIN * Math.exp(r * Q_RANGE_LN);
      this.bFbExcess[b] = 0.15 + 0.03 * qNom;
      this.bMakeup[b] = resonanceMakeup(qNom);
      for (let ch = 0; ch < 2; ch++) {
        const i = b * 2 + ch;
        // flush denormal-range state
        if (Math.abs(this.ic1[i]) < 1e-25) this.ic1[i] = 0;
        if (Math.abs(this.ic2[i]) < 1e-25) this.ic2[i] = 0;
        // slow drift: random target every 1..4 s, slewed
        this.driftTimer[i] -= dt;
        if (this.driftTimer[i] <= 0) {
          this.driftTimer[i] = 1 + 3 * this.rng();
          this.driftTgt[i] = (this.rng() * 2 - 1) * DRIFT_AMT;
        }
        this.driftCur[i] += (this.driftTgt[i] - this.driftCur[i]) * driftSlew;

        let f = BAND_FREQS[b] * (1 + an * (this.tolF[i] + this.driftCur[i]));
        if (f > fMax) f = fMax;
        const q = qNom * (1 + an * this.tolQ[i]);
        // skip when nothing moved meaningfully (< 1e-5 relative ≈ 0.02 cent)
        if (Math.abs(f - this.cLastF[i]) < 1e-5 * f && Math.abs(q - this.cLastQ[i]) < 1e-5 * q) continue;
        this.cLastF[i] = f;
        this.cLastQ[i] = q;
        const k = 1 / q;
        const g = Math.tan((Math.PI * f) / fs);
        const a1 = 1 / (1 + g * (g + k));
        const a2 = g * a1;
        this.cA1[i] = a1;
        this.cA2[i] = a2;
        this.cA3[i] = g * a2;
        this.cK[i] = k;
        this.cG[i] = g;
      }
    }
    const fc = Math.min(Math.exp(this.gCur[S_TONE]), fMax);
    this.faLpA = 1 - Math.exp((-2 * Math.PI * fc) / fs);
  }

  private noise(): number {
    let s = this.noiseState;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.noiseState = s;
    return s / 2147483648 - 1;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : null;
    const n = Math.min(outL.length, MAX_BLOCK);
    const inp = inputs[0];
    const rawL = inp && inp.length > 0 ? inp[0] : null;
    const rawR = inp && inp.length > 1 ? inp[1] : rawL;

    /* --- modulation graph: effective values for this block --- */
    const mod = this.mod;
    mod.beginBlock(n);
    if (mod.baseVersion !== this.appliedVersion || mod.anyModulated(0, NUM_RESONATOR_PARAMS)) {
      this.appliedVersion = mod.baseVersion;
      this.applyParams(mod.eff, false);
    }
    this.applyDyn(mod.eff);

    /* --- pre filter (on a copy: never write into the input buffers) --- */
    const preL = this.preL, preR = this.preR;
    if (rawL) preL.set(rawL.subarray(0, n)); else preL.fill(0);
    if (rawR) preR.set(rawR.subarray(0, n)); else preR.fill(0);
    mod.preFilter.process(preL, preR, n, mod.ctx);
    const inL = preL, inR = preR;
    const taps = mod.taps;
    const tapIn = taps[TAP_IN], tapRes = taps[TAP_RES_OUT], tapOut = taps[TAP_OUT];

    const gCur = this.gCur, gTgt = this.gTgt;
    const bGainCur = this.bGainCur, bGainTgt = this.bGainTgt;
    const bMakeup = this.bMakeup, bMakeupCur = this.bMakeupCur;
    const bFbCur = this.bFbCur, bFbTgt = this.bFbTgt;
    const bResCur = this.bResCur, bResTgt = this.bResTgt;
    const gA = this.gA, bGainA = this.bGainA, bFbA = this.bFbA, bResA = this.bResA;
    const tStep = this.toggleStep;
    const cA1 = this.cA1, cA2 = this.cA2, cA3 = this.cA3, cK = this.cK, cG = this.cG;
    const ic1 = this.ic1, ic2 = this.ic2, yPrev = this.yPrev, env = this.env;
    const envRel = this.envRel;
    const faLp = this.faLp, faDcX = this.faDcX, faDcY = this.faDcY, faRet = this.faRet;
    const mBandSq = this.mBandSq;
    const dcR = this.dcR;
    // hot scalars live in locals for the loop (written back at the end / before meter posts)
    const fbOnTgt = this.fbOnTgt, bypTgt = this.bypTgt;
    let fbOn = this.fbOnCur, byp = this.bypCur, sub = this.subCount, mc = this.meterCount;
    const mInPk = this.mInPk, mOutPk = this.mOutPk;
    let inPk0 = mInPk[0], inPk1 = mInPk[1], outPk0 = mOutPk[0], outPk1 = mOutPk[1];
    let mHot = this.mHot;
    let faLpA = this.faLpA;
    const meterInterval = this.meterInterval;
    // band dynamics: everything below is skipped while they are idle
    const dynAct = this.dynLive;
    const dynOnTgt = this.dynOnTgt;
    let dynOn = this.dynOnCur, dSub = this.dSub;
    const dGain = this.dG, dGStep = this.dGStep;

    for (let s = 0; s < n; s++) {
      /* --- parameter smoothing (per sample) --- */
      for (let j = 0; j < NUM_GS; j++) gCur[j] += (gTgt[j] - gCur[j]) * gA[j];
      for (let b = 0; b < NB; b++) {
        bGainCur[b] += (bGainTgt[b] - bGainCur[b]) * bGainA[b];
        bFbCur[b] += (bFbTgt[b] - bFbCur[b]) * bFbA[b];
      }
      if (fbOn !== fbOnTgt) {
        fbOn += fbOn < fbOnTgt ? tStep : -tStep;
        if (Math.abs(fbOn - fbOnTgt) < tStep) fbOn = fbOnTgt;
      }
      if (byp !== bypTgt) {
        byp += byp < bypTgt ? tStep : -tStep;
        if (Math.abs(byp - bypTgt) < tStep) byp = bypTgt;
      }
      if (++sub >= SUB) {
        sub = 0;
        // resonance only feeds the coefficients, so it is smoothed at the coefficient rate (same τ)
        for (let b = 0; b < NB; b++) bResCur[b] += (bResTgt[b] - bResCur[b]) * bResA[b];
        this.updateCoefs();
        faLpA = this.faLpA;
      }
      if (dynAct) {
        if (dynOn !== dynOnTgt) {
          dynOn += dynOn < dynOnTgt ? tStep : -tStep;
          if (Math.abs(dynOn - dynOnTgt) < tStep) dynOn = dynOnTgt;
        }
        if (dSub === 0) this.dynStep(dynOn);
      }

      const an = gCur[S_ANALOG];
      const inGain = gCur[S_IN];

      /* --- input stage (per channel) --- */
      const dryL = inL[s];
      const dryR = inR[s];
      tapIn[s] = 0.5 * (dryL + dryR);
      const aL = Math.abs(dryL), aR = Math.abs(dryR);
      if (aL > inPk0) inPk0 = aL;
      if (aR > inPk1) inPk1 = aR;

      // analog saturator: L*(tanh(u+b) - tanh(b)) / (1 - tanh²b), u = x/L
      const satL = 2.5 - an;
      const satInv = 1 / satL;
      const bias = 0.15 * an;
      const tb = fastTanh(bias);
      const satNorm = satL / (1 - tb * tb);
      const noiseAmp = NOISE_FLOOR + NOISE_ANALOG * an;
      const xL = (fastTanh(dryL * inGain * satInv + bias) - tb) * satNorm + this.noise() * noiseAmp + faRet[0];
      const xR = (fastTanh(dryR * inGain * satInv + bias) - tb) * satNorm + this.noise() * noiseAmp + faRet[1];

      /* --- spread gains (odd bands → L, even → R) --- */
      const spr = gCur[S_SPREAD];
      const th = spr * QUARTER_PI;
      const gNear = SQRT2 * Math.cos(QUARTER_PI - th); // gain on the side the band moves to
      const gFar = SQRT2 * Math.sin(QUARTER_PI - th);
      const sideG = 1 - spr;
      const nlDamp = NL_DAMP * an;

      let wetL = 0, wetR = 0;
      let faInL = 0, faInR = 0; // Feedback-All return: band sum without resonance makeup
      let hot = false;
      for (let b = 0; b < NB; b++) {
        const fbRaw = bFbCur[b];
        const fbg = fbRaw <= BAND_FB_EDGE ? fbRaw * BAND_FB_SLOPE : 1 + ((fbRaw - BAND_FB_EDGE) / (1 - BAND_FB_EDGE)) * this.bFbExcess[b];
        let yL = 0, yR = 0;
        for (let ch = 0; ch < 2; ch++) {
          const i = b * 2 + ch;
          const x = ch === 0 ? xL : xR;
          const k = cK[i];
          let a1 = cA1[i], a2 = cA2[i], a3 = cA3[i];
          const c1 = ic1[i], c2 = ic2[i];
          // peak envelope of the previous output: drives the loop limiter and the analog damping
          const ypa = Math.abs(yPrev[i]);
          let e = env[i] * envRel;
          if (ypa > e) e = ypa;
          env[i] = e;
          if (nlDamp > 0) {
            // analog: damping grows with amplitude (soft-limited op-amp/integrator stage), so loud
            // high-Q ringing compresses and decays faster at first, then rings on quietly.
            const y2 = e * e;
            const g = cG[i];
            const ke = k + (nlDamp * y2) / (1 + 0.25 * y2);
            a1 = 1 / (1 + g * (g + ke));
            a2 = g * a1;
            a3 = g * a2;
          }
          // loop clipper gain from previous output
          let ge = 0;
          if (fbg > 1e-6) {
            // limiter acts on the amplified loop signal, so the fed-back level stays ≤ BAND_CLIP_L
            const u = fbg * e * BAND_CLIP_INV;
            const cg = 1 / Math.sqrt(1 + u * u);
            if (cg < 0.8 && fbRaw > 0.5) hot = true;
            ge = fbg * cg;
          }
          // delay-free solve: y = k*v1 = P + B*v0, v0 = x + ge*y
          const B = k * a2;
          const P = k * (a1 * c1 - a2 * c2);
          const y = (P + B * x) / (1 - B * ge);
          const v0 = x + ge * y;
          const v3 = v0 - c2;
          const v1 = a1 * c1 + a2 * v3;
          const v2 = c2 + a2 * c1 + a3 * v3;
          const n1 = 2 * v1 - c1;
          const n2 = 2 * v2 - c2;
          if (!(Math.abs(n1) + Math.abs(n2) < 1e8) || !(y === y)) {
            this.resetSlot(i);
            continue;
          }
          ic1[i] = n1;
          ic2[i] = n2;
          yPrev[i] = y;
          if (ch === 0) yL = y;
          else yR = y;
        }
        let fg = bGainCur[b];
        if (dynAct) {
          // band dynamics: after the band's own loop, before makeup and the Feedback-All tap (folded into the fader gain)
          const g = dGain[b];
          dGain[b] = g + dGStep[b];
          fg *= g;
        }
        yL *= fg;
        yR *= fg;
        faInL += yL;
        faInR += yR;
        // resonance makeup (after the band's own loop, outside the Feedback-All loop so its
        // self-oscillation edge does not move with resonance)
        const mk = (bMakeupCur[b] += (bMakeup[b] - bMakeupCur[b]) * 0.002);
        yL *= mk;
        yR *= mk;
        mBandSq[b] += 0.5 * (yL * yL + yR * yR);
        taps[TAP_BAND0 + b][s] = 0.5 * (yL + yR);
        // spread: mid panned, side faded
        const m = 0.5 * (yL + yR);
        const d = 0.5 * (yL - yR) * sideG;
        if ((b & 1) === 0) {
          // odd band (1-based) → left
          wetL += gNear * m + d;
          wetR += gFar * m - d;
        } else {
          wetL += gFar * m + d;
          wetR += gNear * m - d;
        }
      }

      tapRes[s] = 0.5 * (wetL + wetR);
      if (dynAct) {
        if (++dSub >= DYN_SUB) dSub = 0;
        if (dSub % DYN_DET === 0) this.dynDetect();
      }

      /* --- Feedback All loop (one-sample delay) --- */
      const faG = gCur[S_FBALL] * fbOn;
      const lpA = faLpA;
      {
        faLp[0] += (faInL - faLp[0]) * lpA;
        faLp[1] += (faInR - faLp[1]) * lpA;
        // DC blocker
        const h0 = faLp[0] - faDcX[0] + dcR * faDcY[0];
        const h1 = faLp[1] - faDcX[1] + dcR * faDcY[1];
        faDcX[0] = faLp[0];
        faDcX[1] = faLp[1];
        faDcY[0] = h0;
        faDcY[1] = h1;
        if (faG > 1e-6) {
          // soft clip after the gain: the return never exceeds FBALL_CLIP_L
          const r0 = faG * h0, r1 = faG * h1;
          const u0 = r0 * FBALL_CLIP_INV, u1 = r1 * FBALL_CLIP_INV;
          faRet[0] = r0 / Math.sqrt(1 + u0 * u0);
          faRet[1] = r1 / Math.sqrt(1 + u1 * u1);
          if (u0 * u0 > 0.5 || u1 * u1 > 0.5) hot = true;
        } else {
          faRet[0] = 0;
          faRet[1] = 0;
        }
        if (!Number.isFinite(faLp[0] + faLp[1] + h0 + h1)) {
          faLp.fill(0); faDcX.fill(0); faDcY.fill(0); faRet.fill(0);
        }
      }
      if (hot) mHot = true;

      /* --- output stage --- */
      const dG = gCur[S_DRY], wG = gCur[S_WET], oG = gCur[S_OUT];
      let oL = safetyClip((dryL * dG + wetL * wG) * oG);
      let oR = safetyClip((dryR * dG + wetR * wG) * oG);
      if (byp > 0) {
        oL += (dryL - oL) * byp;
        oR += (dryR - oR) * byp;
      }
      if (!(oL === oL)) oL = 0;
      if (!(oR === oR)) oR = 0;
      outL[s] = oL;
      if (outR) outR[s] = oR;
    }

    /* --- post filter, output tap, output peaks --- */
    const scratchR = this.preR; // the input copy is no longer needed: reused as right channel for mono outputs
    const postR = outR ?? scratchR;
    if (!outR) scratchR.set(outL.subarray(0, n));
    const filtered = mod.postFilter.process(outL, postR, n, mod.ctx);
    for (let s = 0; s < n; s++) {
      let l = outL[s], r = postR[s];
      if (filtered) {
        // the filter may push past the ceiling again
        if (l > 0.8 || l < -0.8 || l !== l) l = outL[s] = l === l ? safetyClip(l) : 0;
        if (r > 0.8 || r < -0.8 || r !== r) r = postR[s] = r === r ? safetyClip(r) : 0;
      }
      tapOut[s] = 0.5 * (l + r);
      const pL = Math.abs(l), pR = Math.abs(r);
      if (pL > outPk0) outPk0 = pL;
      if (pR > outPk1) outPk1 = pR;
    }
    this.dynOnCur = dynOn;
    this.dSub = dSub;
    this.dynEndBlock();
    mod.endBlock();

    mc += n;
    if (mc >= meterInterval) {
      mInPk[0] = inPk0; mInPk[1] = inPk1; mOutPk[0] = outPk0; mOutPk[1] = outPk1;
      this.postMeters(mc, mHot);
      mc = 0; inPk0 = inPk1 = outPk0 = outPk1 = 0; mHot = false;
    }
    this.fbOnCur = fbOn; this.bypCur = byp; this.subCount = sub; this.meterCount = mc;
    mInPk[0] = inPk0; mInPk[1] = inPk1; mOutPk[0] = outPk0; mOutPk[1] = outPk1;
    this.mHot = mHot;
    // extra output channels (if any) mirror the left
    for (let c = 2; c < out.length; c++) out[c].set(outL);
    return true;
  }

  private postMeters(cnt: number, hot: boolean) {
    const bands = this.meterBands;
    for (let b = 0; b < NB; b++) {
      bands[b] = Math.sqrt(this.mBandSq[b] / cnt);
      this.mBandSq[b] = 0;
    }
    // copied (not reused) so every frame keeps its own values, also in offline tests
    const dynGR = new Float32Array(this.mGr);
    this.mGr.fill(0);
    this.port.postMessage({
      type: 'meters',
      inPeak: [this.mInPk[0], this.mInPk[1]],
      outPeak: [this.mOutPk[0], this.mOutPk[1]],
      bands,
      dynGR,
      hot,
    });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** linear to 0.8, then tanh knee to a ceiling of 1.0 */
function safetyClip(x: number): number {
  const a = x < 0 ? -x : x;
  if (a <= 0.8) return x;
  const y = 0.8 + 0.2 * fastTanh((a - 0.8) * 5);
  return x < 0 ? -y : y;
}

registerProcessor(WORKLET_NAME, ResonatorProcessor);
