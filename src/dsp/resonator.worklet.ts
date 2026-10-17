/**
 * Erica Synths "Resonant Filterbank" emulation: AudioWorklet DSP core.
 *
 * Bundled by esbuild into one IIFE script, so it may only import from ../shared/*.
 *
 * ─── Signal flow (per channel; L and R have their own filters) ───────────────
 *   in ─► input gain (0..24 dB) ─► analog saturator ─► (+ noise floor) ─► (+ Feedback-All return)
 *      ─► 10 × [ TPT SVF bandpass with its feedback ─► band dynamics ] ─► fader ─► makeup ─► spread ─► Σ wet
 *   Feedback route (CONFIG, param reso.route):
 *     BAND   : every band feeds back into its own input, before its fader.
 *     COMMON : the bands feed back after their faders (at tap level) into the shared input of all bands,
 *              like the hardware: a raised fader makes its band ring, neighbours excite each other.
 *   Σ taps (after the faders, at tap level) ─► Feedback-All loop: tone LP ─► DC block ─► soft clip ─► × amount
 *      ─► (back to the band inputs, 1-sample delay)
 *   out = safetyClip( (dry·cos(mix·π/2) + wet·sin(mix·π/2)) · outputGain ), crossfaded with dry by bypass.
 *
 * ─── L/R per band (docs/lr-pro-band-2026-10-16.md) ────────────────────────────
 *   Every filter reads its own level, RES and FB: slot i = band·2 + channel (L = the historic ids,
 *   R = their twins band<n>.gainR / .resR / .fbR, appended after R_FIRST). Feedback All has its own
 *   switch and amount per channel (fbAllOn / fbAll, fbAllOnR / fbAllR); TONE is shared. Makeup, tap
 *   level, the COMMON route and the FEEDBACK knob work per slot. Band dynamics stay linked per band.
 *   A route carries a channel (L+R, L, R, INV = R gets the negative offset); ModEngine writes it onto
 *   the L param and/or its twin.
 *
 * ─── Mappings ─────────────────────────────────────────────────────────────────
 *  Band filter : Zavalishin TPT state-variable filter, output = k·BP (k = 1/Q), i.e. unity gain at the
 *                centre for every Q (constant-peak form). 2nd-order skirts (≈ hardware's ~17 dB/dec).
 *                After the feedback a resonance makeup gain (shared/params.ts resonanceMakeup, 0 dB at res
 *                0.45): above, (Q/Q_ref)^0.7 lifts the peak like an analog resonant bandpass, so more
 *                resonance = louder, fuller ringing; below, (Q/Q_ref)^0.4 lowers broad bands just enough
 *                that all bands at 0 dB and the default RES 0.03 (Q 0.7) sum flat at 0 dB.
 *                The feedback taps take the band at tap level = min(1, makeup): broad bands feed back like
 *                one flat band, and the lift of high resonance stays out of the loops, so the FB All and
 *                common-route edges do not move with resonance.
 *  Resonance   : r = clamp(band.res + knob, 0, 1);  Q = 0.6 · 200^r   → 0.6 … 120
 *                knob = RESONANCE through its curve (lin / log / exp) × band weight (all / highs / lows);
 *                in the FEEDBACK knob mode the knob leaves r alone and scales the feedback instead.
 *                (r = 0.3 → Q ≈ 2.9, r = 0.5 → Q ≈ 8.5, r = 1 → Q = 120: the 29 Hz band rings ~9 s to -60 dB,
 *                 115 Hz ~2 s). The linear filter is unconditionally stable for any Q.
 *  Analog sat  : amplitude-dependent damping: k_eff = k + 0.03·analog·e²/(1 + e²/4) (e = peak envelope of
 *                the band output; output normalisation keeps the nominal k). Like a soft-limiting integrator stage it
 *                barely touches low-Q bands but makes loud high-Q ringing compress and decay faster at first,
 *                independent of the band's frequency.
 *  Knob FEEDBACK: per band factor 1.3·s on fb (hardware attenuverter: centre no feedback, right up to ×1.3,
 *                FB 1 rings from 3 o'clock; left inverted), s = shaped, weighted knob; Feedback All gets the
 *                unweighted factor. Negative = inverted feedback (damping).
 *  Knob FOCUS  : a RES spotlight (+0.6 at its centre, Gaussian σ 0.7 bands) swept through the bands by the
 *                shaped knob: 7:30 = band 1, 12 = between bands 5 and 6, 4:30 = band 10. Band weighting is unused.
 *  Band fb     : loop gain at the centre G = fb / 0.87 up to the edge of self-oscillation (fb = 0.87, G = 1);
 *                above it G rises linearly to 1.15 + 0.03·Q at fb = 1 (Q-dependent so narrow, high-Q bands
 *                still start oscillating within a second or two). fb = 1 sustains a steady sine at the band
 *                centre (measured ≈ ±0.55…0.77 peak with analog 0.5).
 *                fb < 0 (FEEDBACK knob left of centre) mirrors G: inverted feedback, the band gets wider and lower.
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
 *  Common route: u = x + sc·Σ w_b·y_b with w_b = G_b · fader_b · tap_b; every y_b = P_b + B_b·u is linear in u, so
 *                u = (x + sc·Σ w·P) / (1 − sc·Σ w·B), solved delay-free per sample (sc·Σ w·B is held ≤ 0.9).
 *                sc = 1/√(1+e²) from the envelope e of the unlimited return Σ w·y: the summed return stays < 1.
 *                One band at 0 dB starts oscillating at fb 0.87 (narrow) like BAND; broad bands at 0 dB need
 *                more (their tap level is lower), a fader at +12 dB a quarter.
 *  Feedback All: loop gain = 1.3 × amount × (summed band taps, ≈ 1 at the band centres for any RES).
 *                With faders at 0 dB the loop reaches the edge of self-oscillation around amount ≈ 0.75.
 *                Bounded by a soft clipper after the gain, r/√(1+(r/0.7)²), so the return never exceeds 0.7.
 *  Spread      : −1..1, centre (0) = untouched stereo. CONFIG param reso.spread chooses the function:
 *                ODD/EVEN: per band, mid m = (L+R)/2, side d = (L−R)/2. Right of centre odd bands (1,3,5,7,9;
 *                index 0,2,…) pan m towards L and even bands towards R, left of centre the other way round,
 *                with centre-normalised equal-power gains gNear = √2·cos θ, gFar = √2·sin θ,
 *                θ = π/4 − |spread|·π/4; the side part fades with (1−|spread|). ±1 = bands hard L / hard R.
 *                CLASSIC: the band sum of R × 10^(6·spread/20), of L × 10^(−6·spread/20) (±6 dB at the stops).
 *                Switching the function crossfades the two (smoothed slot S_CLASSIC).
 *  Mix         : equal-power: dry·cos(mix·π/2) + wet·sin(mix·π/2). Dry = raw input (before input gain).
 *  Output      : outputGain dB, then a safety soft clip: linear up to 0.8, tanh knee to a ceiling of 1.0.
 *  Analog      : 0..1 scales input-saturator asymmetry/knee (rail level 2.5 → 1.5, bias 0.15), the damping above, fixed component tolerance
 *                Upper half (analog 0.5 → 1, d = 0 → 1): a drive stage after the saturator. Pre-gain up to
 *                DRIVE_MAX_DB, a clipper that goes from soft (u/√(1+u²)) to hard (clamp ±1) with d and leans
 *                off-centre by DRIVE_ASYM·d (even harmonics), then a makeup that keeps a peak of DRIVE_REF at
 *                its level, so the distortion grows while the level stays about the same. First-order antiderivative anti-aliasing (ADAA);
 *                faded in over d = 0 … DRIVE_FADE, so analog ≤ 0.5 sounds as before.
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
 *                c = (L − T)·(1 − 1/ratio), clamped to range. MODE CUT: only above the threshold (cut, the
 *                hardware); BOOST: only below it (boost, upward compression); BALANCE: both, every band is
 *                pulled towards the threshold. Below the threshold a gate stops the boost DYN_GATE_DB under it
 *                (faded in over DYN_GATE_FADE_DB), so silence and the noise floor stay down. Smoothed in dB
 *                (attack while the gain goes down, release while it comes back up), scaled by the band's
 *                amount and the on/off ramp (10 ms), then the linear gain is interpolated per sample (no zipper).
 *                BOOST adds a level correction on all bands: the power the boosts add (detector level ×
 *                fader × makeup per band, ≈ 150 ms smoothing), at most range. Off = no per-sample work and bit-identical output.
 *                |change|/range → mod sources dyn1..10.
 *  Modulation  : runs in this worklet (ModEngine): once per block the modulation graph computes effective
 *                values (base + routes) for every param; the resonator smooths towards them. Modulated params
 *                use τ = 3 ms instead of 20 ms so fast LFOs are not dulled.
 *  Clocks      : the internal clock (TEMPO, RUN) and the MIDI clock run side by side; each LFO and clock mod
 *                follows one (param .clk; the other while it is off), message clockOn switches them on and
 *                off. While the MIDI clock is on the main thread forwards ticks, Start, Continue and Stop
 *                with their AudioContext time (midiClock); dsp/extClock.ts turns them into tempo, run state
 *                and beat position at the end of each block (currentTime + block length).
 *  Chain       : in ─► pre filter ─► resonator (above) ─► post filter ─► out. Tap buffers (input, every band,
 *                wet sum, output) feed the envelope followers.
 *  Smoothing   : all continuous params are smoothed per sample with a one-pole (τ = 20 ms); filter
 *                coefficients (and the smoothed resonance feeding them) are updated every 32 samples, and only
 *                when centre/Q moved by > 1e-5 relative. Toggles (fbAllOn, bypass) are linear 10 ms crossfades.
 */
import { WORKLET_NAME } from '../shared/messages';
import {
  BAND_FREQS,
  FB_ALL_LOOP_MAX,
  NUM_BANDS,
  NUM_PARAMS,
  NUM_RESONATOR_PARAMS,
  G,
  R_FIRST,
  RES_KNOB_FEEDBACK,
  RES_KNOB_FOCUS,
  resFocusShift,
  resKnobMode,
  bandParamIndex,
  bandParamIndexR,
  dbToGain,
  faderDbToNorm,
  faderNormToDb,
  fbKnobFactor,
  feedbackTapGain,
  paramIndex,
  resKnobShape,
  resKnobWeight,
  resonanceMakeup,
} from '../shared/params';
import {
  DYN_BOOST,
  DYN_CUT,
  DYN_DELAY_MAX_MS,
  DYN_GATE_DB,
  DYN_GATE_FADE_DB,
  DYN_RDLY_MAX_MS,
  BAND_FILTER_KEY_NOTE,
  BAND_FILTER_RES_SHIFT,
  DYN_SRC_BAND,
  FILTER_ENV_OCT,
  DYN_SRC_IN,
  SPREAD_CLASSIC_DB,
  TAP_BAND0,
  TAP_IN,
  TAP_OUT,
  TAP_RES_OUT,
} from '../shared/paramdefs/modules';
import { bandFilterLevels, bandFilterOpen } from './modules/bandFilter';
import { filterKeyCutoff } from './modules/filter';
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
/** AudioContext time of the first sample of the current block */
declare const currentTime: number;

/* ---------- constants ---------- */
const NB = NUM_BANDS;
const NS = NB * 2; // band × channel filter slots, index = b*2 + ch
const SETTLE_EPS = 1e-7; // a per-slot glide this close to its target has arrived (bandsSettled)
const I_FBALL_R = paramIndex('fbAllR'); // Feedback All of the right channel (L/R per band)
const I_FBALLON_R = paramIndex('fbAllOnR');
const SUB = 32; // coefficient / slow-param update interval (samples)
const Q_MIN = 0.6;
const Q_RANGE_LN = Math.log(200); // Q = 0.6 * 200^r
const BAND_FB_EDGE = 0.87; // fb value where the centre loop gain reaches 1
const BAND_FB_SLOPE = 1 / BAND_FB_EDGE; // loop gain per unit fb below the edge
const BAND_CLIP_L = 1.0; // per-band loop limiter level (bounds the fed-back signal)
const BAND_CLIP_INV = 1 / BAND_CLIP_L;
const HOT_LOOP_GAIN = 0.5 / 0.87; // loop gain above which a limiting loop lights HOT
const NL_DAMP = 0.03; // amplitude-dependent extra damping (Δk at |y| = 1, analog = 1)
const DRIVE_MAX_DB = 30; // ANALOG drive: pre-gain at analog = 1 (none up to 0.5)
const DRIVE_ASYM = 0.3; // ANALOG drive: clipper offset at analog = 1 (even harmonics)
const DRIVE_FADE = 0.2; // ANALOG drive: fade-in over the first part of the upper half
const DRIVE_REF = 0.4; // ANALOG drive: peak level that keeps its level at every drive setting
const FBALL_MAX = FB_ALL_LOOP_MAX; // Feedback-All loop gain at amount = 1 (self-oscillation from amount ≈ 0.75 with faders at 0 dB)
const FBALL_CLIP_L = 0.7; // Feedback-All return limit
const FBALL_CLIP_INV = 1 / FBALL_CLIP_L;
const COMMON_CLIP_L = 1.0; // common feedback route: limit of the summed return
const COMMON_CLIP_INV = 1 / COMMON_CLIP_L;
const COMMON_D_MAX = 0.9; // common route: largest instantaneous loop gain the delay-free solve accepts
const TOL_DETUNE = 0.01; // ±0.5…1.5 % at analog = 1
const TOL_Q = 0.05;
const DRIFT_AMT = 0.0015;
const NOISE_ANALOG = 1.6e-5 * Math.sqrt(3); // uniform noise with RMS ≈ -96 dBFS at analog = 1
const NOISE_FLOOR = 1e-9;
const SQRT2 = Math.SQRT2;
const QUARTER_PI = Math.PI / 4;
const HALF_PI = Math.PI / 2;
/** FB function keys: a held band wobbles by ± this much fader travel (default; CONFIG sets it per press), one sine per beat of the master clock */
const WOB_DEPTH = 0.1;
/** the wobble fades in on press and out on release over this time (s), so the level never steps */
const WOB_FADE_S = 0.03;
const DYN_SUB = 16; // band dynamics gain computer interval (samples); the gain is interpolated in between
const DYN_DET = 8; // detector sampling interval (samples, divides DYN_SUB): A² is smooth, see header
const DYN_ANA_Q = 1.5; // analysis bandpass per band for the IN / OUT sources (about one band wide)
const DYN_FILT_Q = 2; // input filter before the analysis
const DB_PER_LN_POW = 10 / Math.LN10; // ln(power ratio) → dB
const LN_GAIN_PER_DB = Math.LN10 / 20; // dB → ln(amplitude ratio)
const BF_ENV_ATK_SEC = 0.005; // band filter envelope: attack, and −48 … 0 dBFS is the travel of ENV
const BF_ENV_SPAN_DB = 48;
const DYN_GATE_P = Math.exp(-DYN_GATE_DB / DB_PER_LN_POW); // BOOST gate below the threshold, as an A² factor

function fastTanh(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** ANALOG drive clipper: soft (u/√(1+u²)) blended with hard (clamp ±1) by h */
function driveClip(u: number, h: number): number {
  const hard = u > 1 ? 1 : u < -1 ? -1 : u;
  return (1 - h) * (u / Math.sqrt(1 + u * u)) + h * hard;
}
/** antiderivative of driveClip (for ADAA) */
function driveClipF(u: number, h: number): number {
  const a = u < 0 ? -u : u;
  return (1 - h) * Math.sqrt(1 + u * u) + h * (a <= 1 ? 0.5 * u * u : a - 0.5);
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
const S_IN = 0, S_ANALOG = 1, S_RESOFF = 2, S_FBALL = 3, S_TONE = 4, S_SPREAD = 5, S_DRY = 6, S_WET = 7, S_OUT = 8, S_FBALLR = 9, S_CLASSIC = 10;
const NUM_GS = 11;
/** CLASSIC spread: ln-gain per unit spread (6 dB at the stops) */
const CLASSIC_K = (SPREAD_CLASSIC_DB / 20) * Math.LN10;

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
  private bGainA = new Float64Array(NS);
  private bFbA = new Float64Array(NS);
  private bResA = new Float64Array(NS);
  // param index of every slot's level, res and fb (slot b·2 = L: the historic band ids, b·2+1 = R: their twins)
  private iGain = new Int32Array(NS);
  private iRes = new Int32Array(NS);
  private iFb = new Int32Array(NS);
  private preL = new Float32Array(MAX_BLOCK);
  private preR = new Float32Array(MAX_BLOCK);

  // smoothed globals (current / target)
  private gCur = new Float64Array(NUM_GS);
  private gTgt = new Float64Array(NUM_GS);
  // smoothed per slot (band × channel): linear fader gain, fb amount, res
  private bGainCur = new Float64Array(NS);
  private bGainTgt = new Float64Array(NS);
  private bFbCur = new Float64Array(NS);
  private bFbTgt = new Float64Array(NS);
  private bResCur = new Float64Array(NS);
  private bResTgt = new Float64Array(NS);
  private bFbExcess = new Float64Array(NS); // loop gain - 1 at fb = 1 (depends on Q)
  private bMakeup = new Float64Array(NS).fill(1); // target resonance peak gain (post loop)
  private bMakeupCur = new Float64Array(NS).fill(1); // per-sample smoothed
  private bTap = new Float64Array(NS).fill(1); // target level in the feedback taps (cut part of the makeup)
  private bTapCur = new Float64Array(NS).fill(1); // per-sample smoothed
  private bFbFactor = new Float64Array(NB).fill(1); // FEEDBACK knob: factor on the band's feedback
  private fbAllFactor = 1; // FEEDBACK knob: factor on Feedback All
  // mode layers (FILTER → BAND, CLK MOD → SCAN): dB per slot on top of the fader
  private bFaderDb = new Float64Array(NS); // fader level of every slot (dB)
  private lyrDb = new Float64Array(NS); // band filter + scanner (dB, −Infinity = silent)
  private lyrLive = false; // a layer is on (or just went off: one last update back to 0 dB)
  private lyrFast = false; // the layers move (scanner, modulated band filter): the band gains glide fast
  private bfL = new Float64Array(NB);
  private bfR = new Float64Array(NB);
  // FB function keys (hold a band: it wobbles), a layer like the modes; not a param, never saved
  private wobHeld = new Uint8Array(NS); // 1 while the band's key is held, per slot
  private wobAmt = new Float64Array(NS); // depth 0..1 per slot (fades in / out)
  private wobOn = false; // a slot is held or still fading out
  private wobPhase = 0; // wobble phase (cycles); runs at the clock's TEMPO while that clock stands
  private wobDepth = WOB_DEPTH; // ± fader travel, from the last press
  private iBfOn = paramIndex('filterBand.on');
  private iBfType = paramIndex('filterBand.type');
  private iBfCut = paramIndex('filterBand.cutoff');
  private iBfSlope = paramIndex('filterBand.slope');
  private iBfWidth = paramIndex('filterBand.width');
  private iBfDepth = paramIndex('filterBand.depth');
  private iBfOffset = paramIndex('filterBand.offset');
  private iBfRofs = paramIndex('filterBand.rofs');
  private iBfKey = paramIndex('filterBand.key');
  private iBfEnv = paramIndex('filterBand.env');
  private iBfEnvRel = paramIndex('filterBand.envRel');
  private iBfPeak = paramIndex('filterBand.peak');
  private iBfResAmt = paramIndex('filterBand.resAmt');
  private bfEnv = 0; // band filter envelope on the input (peak, 5 ms attack, REL release)
  private bfNote = -1; // last MIDI note (KEY Note), −1 = none yet: FREQ
  private lyrRes = new Float64Array(NS); // band filter RES AMT: RES shift per slot (target)
  private lyrResCur = new Float64Array(NS); // … smoothed at the coefficient rate
  private lyrResA = 0;
  private iBfLock: number[] = [];
  private bfModulated = false;
  // resonance setup (CONFIG): feedback route, knob mode, curve, band weights
  private iRoute = paramIndex('reso.route');
  private iKnob = paramIndex('reso.knob');
  private iCurve = paramIndex('reso.curve');
  private iWeight = paramIndex('reso.weight');
  private iSpreadMode = paramIndex('reso.spread');
  private fbRoute = 0; // 0 = each band into itself before its fader, 1 = after the faders into the common input
  private knobMode = 0;
  private knobCurve = 0;
  private knobWeight = -1;
  private kW = new Float64Array(NB).fill(1);
  // per-sample slot values shared by the filter solve and the output mix
  private fbgA = new Float64Array(NS); // loop gain (signed)
  private fgA = new Float64Array(NS); // post-fader gain (fader × dynamics)
  private tapA = new Float64Array(NS); // smoothed tap level
  private yBuf = new Float64Array(NS); // band outputs of this sample
  // common route scratch (one channel at a time) and the envelope of its unlimited return per channel
  private tP = new Float64Array(NB);
  private tB = new Float64Array(NB);
  private tA1 = new Float64Array(NB);
  private tA2 = new Float64Array(NB);
  private tA3 = new Float64Array(NB);
  private tW = new Float64Array(NB);
  private envF = new Float64Array(2);
  // toggles (ramped 0..1); Feedback All per channel
  private fbOnCur = new Float64Array(2);
  private fbOnTgt = new Float64Array(2);
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
  // ANALOG drive (upper half of the knob): values for the current analog, previous clipper input per channel
  private drvAn = -1;
  private drvGain = 1;
  private drvMakeup = 1;
  private drvHard = 0;
  private drvBias = 0;
  private drvBiasOut = 0;
  private drvMix = 0;
  private drvU = new Float64Array(2);

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
  // per band and channel after the fader and SPREAD (the L/R meters beside the faders)
  private mBandSqL = new Float64Array(NB);
  private mBandSqR = new Float64Array(NB);
  private mHot = false;

  // band dynamics (see header). Param indices, looked up once.
  private iDynOn = paramIndex('dyn.on');
  private iDynThr = paramIndex('dyn.threshold');
  private iDynRatio = paramIndex('dyn.ratio');
  private iDynAtk = paramIndex('dyn.attack');
  private iDynRel = paramIndex('dyn.release');
  private iDynRange = paramIndex('dyn.range');
  private iDynMode = paramIndex('dyn.mode');
  private dMode = DYN_CUT;
  private dCorr = 0; // BOOST level correction (dB, + = cut on every band)
  private dCorrA = 0;
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
  private mLvl = new Float64Array(NB); // meter: largest detector A² since the last frame (what the dynamics measure)
  // R gains of the band dynamics: the same change, later by R DLY
  private dGR = new Float64Array(NB).fill(1);
  private dGRTgt = new Float64Array(NB).fill(1);
  private dGRStep = new Float64Array(NB);
  // source (BAND · IN · OUT), delay and input filter (docs/hardware-modi-und-pools-2026-10-16.md 7A)
  private iDynSrc = paramIndex('dyn.source');
  private iDynDelay = paramIndex('dyn.delay');
  private iDynRdly = paramIndex('dyn.rdly');
  private iDynFilt = paramIndex('dyn.filter');
  private iDynFiltF = paramIndex('dyn.filterFreq');
  private dynSrc = DYN_SRC_BAND;
  // analysis bandpass per band (IN / OUT): coefficients per band, state per slot
  private aA1 = new Float64Array(NB);
  private aA2 = new Float64Array(NB);
  private aA3 = new Float64Array(NB);
  private aK = new Float64Array(NB);
  private aG = new Float64Array(NB);
  private aS1 = new Float64Array(NS);
  private aS2 = new Float64Array(NS);
  private aY = new Float64Array(NS);
  // input filter before the analysis (bandpass, per channel)
  private fOn = false;
  private fHz = -1;
  private fA1 = 0;
  private fA2 = 0;
  private fA3 = 0;
  private fK = 1 / DYN_FILT_Q;
  private fS1 = new Float64Array(2);
  private fS2 = new Float64Array(2);
  // delay line of the gain change per band (dB), one entry every DYN_SUB samples; L reads dDlyL back, R dDlyR
  private dRing: Float32Array;
  private dRingLen: number;
  private dRingPos = 0;
  private dDlyL = 0;
  private dDlyR = 0;

  constructor(options?: unknown) {
    super(options);
    const fs = this.fs;
    this.mod = new ModEngine(fs, (m) => this.port.postMessage(m));
    for (let b = 0; b < NB; b++) this.iDynAmt.push(paramIndex(`band${b}.dyn`));
    for (let b = 0; b < NB; b++) this.iBfLock.push(paramIndex(`filterBand.lock${b}`));
    for (let b = 0; b < NB; b++) {
      const g = Math.tan((Math.PI * Math.min(BAND_FREQS[b], 0.45 * fs)) / fs);
      const k = 1 / DYN_ANA_Q;
      this.aA1[b] = 1 / (1 + g * (g + k));
      this.aA2[b] = g * this.aA1[b];
      this.aA3[b] = g * this.aA2[b];
      this.aK[b] = k;
      this.aG[b] = g;
    }
    this.dRingLen = Math.ceil(((DYN_DELAY_MAX_MS + DYN_RDLY_MAX_MS) * 0.001 * fs) / DYN_SUB) + 2;
    this.dRing = new Float32Array(this.dRingLen * NB);
    for (let b = 0; b < NB; b++) {
      this.iGain[b * 2] = bandParamIndex(b, 'gain');
      this.iGain[b * 2 + 1] = bandParamIndexR(b, 'gain');
      this.iRes[b * 2] = bandParamIndex(b, 'res');
      this.iRes[b * 2 + 1] = bandParamIndexR(b, 'res');
      this.iFb[b * 2] = bandParamIndex(b, 'fb');
      this.iFb[b * 2 + 1] = bandParamIndexR(b, 'fb');
    }
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
    this.bTapCur.set(this.bTap);

    this.port.onmessage = (e) => this.onMessage(e.data as any);
    this.port.postMessage({ type: 'ready' });
  }

  private onMessage(msg: { type: string; values?: Float32Array; hz?: number; config?: ModConfig; int?: boolean; midi?: boolean; ev?: number; t?: number; band?: number; ch?: number; on?: boolean; depth?: number; note?: number }) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'params':
        // base values; shorter arrays (resonator only, v1 senders) leave module params untouched
        if (msg.values && msg.values.length >= NUM_RESONATOR_PARAMS) {
          this.mod.setBase(msg.values);
          if (!this.gotParams) {
            // first values: start right there (filters, makeup and taps included), no glide from the defaults
            this.applyParams(this.mod.eff, true);
            this.updateCoefs();
            this.bMakeupCur.set(this.bMakeup);
            this.bTapCur.set(this.bTap);
          }
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
        this.wobHeld.fill(0);
        this.wobAmt.fill(0);
        break;
      case 'meterRate':
        if (typeof msg.hz === 'number' && msg.hz > 0) this.meterInterval = Math.max(1, Math.round(this.fs / msg.hz));
        break;
      case 'clockOn':
        this.mod.setClockOn(msg.int !== false, msg.midi === true);
        break;
      case 'note':
        // KEY Note of the band filter: the last MIDI note played
        if (typeof msg.note === 'number' && msg.note >= 0 && msg.note <= 127) this.bfNote = msg.note;
        break;
      case 'midiClock':
        if (typeof msg.ev === 'number' && typeof msg.t === 'number') this.mod.pushClock(msg.ev, msg.t);
        break;
      case 'wobble': {
        // ch 0 = L and R, 1 = L, 2 = R; a release lets go of both channels of the band
        const b = msg.band;
        if (typeof b !== 'number' || !(b >= 0 && b < NB)) break;
        const on = msg.on === true;
        const ch = on ? msg.ch ?? 0 : 0;
        if (ch !== 2) this.wobHeld[b * 2] = on ? 1 : 0;
        if (ch !== 1) this.wobHeld[b * 2 + 1] = on ? 1 : 0;
        if (on) {
          this.wobOn = true;
          if (typeof msg.depth === 'number' && msg.depth >= 0) this.wobDepth = Math.min(0.5, msg.depth);
        }
        break;
      }
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
    const slotParam = [G.inputGain, G.analog, G.resOffset, G.fbAll, G.fbAllTone, G.spread, G.mix, G.mix, G.outputGain, I_FBALL_R, this.iSpreadMode];
    for (let j = 0; j < NUM_GS; j++) this.gA[j] = m[slotParam[j]] ? fast : slow;
    for (let i = 0; i < NS; i++) {
      this.bGainA[i] = m[this.iGain[i]] || this.lyrFast ? fast : slow;
      this.bFbA[i] = m[this.iFb[i]] ? fast : slow;
      this.bResA[i] = m[this.iRes[i]] ? fastSub : slowSub;
    }
    const slowDyn = 1 - Math.exp(-DYN_SUB / (TAU_SLOW * fs));
    const fastDyn = 1 - Math.exp(-DYN_SUB / (TAU_FAST * fs));
    this.dSmA = m[this.iDynThr] || m[this.iDynRatio] || m[this.iDynRange] ? fastDyn : slowDyn;
    for (let b = 0; b < NB; b++) this.dAmtA[b] = m[this.iDynAmt[b]] ? fastDyn : slowDyn;
    this.bfModulated = [this.iBfType, this.iBfCut, this.iBfSlope, this.iBfWidth, this.iBfDepth, this.iBfOffset, this.iBfRofs, this.iBfKey, this.iBfPeak, this.iBfResAmt].some((i) => m[i] === 1);
    this.lyrResA = fastSub;
  }

  /** FB function keys: fade every slot's wobble depth towards held / released; true while one moves */
  private wobbleStep(dt: number): boolean {
    if (!this.wobOn) return false;
    const held = this.wobHeld, amt = this.wobAmt;
    const step = dt / WOB_FADE_S;
    let any = false;
    for (let i = 0; i < NS; i++) {
      let a = amt[i];
      if (held[i]) a = a + step < 1 ? a + step : 1;
      else if (a > 0) a = a - step > 0 ? a - step : 0;
      amt[i] = a;
      if (a > 0 || held[i]) any = true;
    }
    this.wobOn = any;
    return any;
  }

  /**
   * mode layers, once per block: the band filter curve at the band centres plus the scanner's values,
   * in dB on top of every slot's fader (locked bands of a mode get 0 dB from it). Off = nothing to do.
   * The FB function keys add the wobble of a held band: its fader position ± depth · sin, one cycle
   * per beat of the master clock (in phase with its beats while it runs, at its TEMPO while it stands).
   */
  private applyLayers(p: Float32Array, inL: Float32Array | null, inR: Float32Array | null, n: number) {
    const fOn = p[this.iBfOn] >= 0.5;
    const scan = this.mod.scan;
    const wob = this.wobbleStep(this.mod.ctx.dt);
    if (!fOn && !scan.on && !wob && !this.lyrLive) return;
    const ly = this.lyrDb;
    let envOn = false;
    if (fOn) {
      const type = Math.round(p[this.iBfType]);
      // KEY: FREQ, the FOCUS spot, a band centre or the last MIDI note; then the envelope on the input
      const key = Math.round(p[this.iBfKey]);
      let fc = key === BAND_FILTER_KEY_NOTE
        ? this.bfNote >= 0 ? 440 * Math.pow(2, (this.bfNote - 69) / 12) : p[this.iBfCut]
        : filterKeyCutoff(key, p[this.iBfCut], resKnobShape(p[G.resOffset], this.knobCurve));
      const envAmt = clamp(p[this.iBfEnv], -FILTER_ENV_OCT, FILTER_ENV_OCT);
      if (envAmt !== 0) {
        envOn = true;
        let pk = 0;
        if (inL) for (let q = 0; q < n; q++) { const a = inL[q] < 0 ? -inL[q] : inL[q]; if (a > pk) pk = a; }
        if (inR && inR !== inL) for (let q = 0; q < n; q++) { const a = inR[q] < 0 ? -inR[q] : inR[q]; if (a > pk) pk = a; }
        if (!(pk < 1e6)) pk = 0;
        const relS = clamp(p[this.iBfEnvRel], 10, 2000) * 0.001;
        this.bfEnv += (pk - this.bfEnv) * (1 - Math.exp(-n / ((pk > this.bfEnv ? BF_ENV_ATK_SEC : relS) * this.fs)));
        if (this.bfEnv < 1e-9) this.bfEnv = 0;
        if (this.bfEnv > 0) {
          let en = (20 * Math.log10(this.bfEnv) + BF_ENV_SPAN_DB) / BF_ENV_SPAN_DB;
          en = en > 0 ? (en < 1 ? en : 1) : 0;
          fc *= Math.pow(2, envAmt * en);
        }
      } else this.bfEnv = 0;
      fc = clamp(fc, 20, 20000);
      const slope = clamp(p[this.iBfSlope], 6, 48);
      const width = clamp(p[this.iBfWidth], 0.25, 8);
      const depth = clamp(p[this.iBfDepth], 0, 60);
      const off = clamp(p[this.iBfOffset], -24, 12);
      const peak = clamp(p[this.iBfPeak], 0, 12);
      const rOfs = clamp(p[this.iBfRofs], -2, 2);
      bandFilterLevels(this.bfL, type, fc, slope, width, depth, off, 0, peak);
      bandFilterLevels(this.bfR, type, fc, slope, width, depth, off, rOfs, peak);
      // RES AMT: open bands up to +shift, closed ones down to −shift
      const ra = clamp(p[this.iBfResAmt], -1, 1) * BAND_FILTER_RES_SHIFT;
      const fcR = rOfs ? fc * Math.pow(2, rOfs) : fc;
      for (let b = 0; b < NB; b++) {
        const open = p[this.iBfLock[b]] < 0.5;
        ly[b * 2] = open ? this.bfL[b] : 0;
        ly[b * 2 + 1] = open ? this.bfR[b] : 0;
        if (ra !== 0 && open) {
          this.lyrRes[b * 2] = ra * (2 * bandFilterOpen(type, fc, slope, width, depth, BAND_FREQS[b]) - 1);
          this.lyrRes[b * 2 + 1] = ra * (2 * bandFilterOpen(type, fcR, slope, width, depth, BAND_FREQS[b]) - 1);
        } else {
          this.lyrRes[b * 2] = 0;
          this.lyrRes[b * 2 + 1] = 0;
        }
      }
    } else {
      ly.fill(0);
      this.lyrRes.fill(0);
      this.bfEnv = 0;
    }
    if (scan.on) for (let i = 0; i < NS; i++) ly[i] += scan.layerDb[i];
    if (wob) {
      const c = this.mod.masterClock;
      if (c.running) this.wobPhase = c.beats - Math.floor(c.beats);
      else this.wobPhase = (this.wobPhase + (this.mod.ctx.dt * c.bpm) / 60) % 1;
      const sw = this.wobDepth * Math.sin(2 * Math.PI * this.wobPhase);
      for (let i = 0; i < NS; i++) {
        const a = this.wobAmt[i];
        if (!(a > 0)) continue;
        const f = this.bFaderDb[i];
        const n = faderDbToNorm(f) + a * sw;
        ly[i] += faderNormToDb(n < 0 ? 0 : n > 1 ? 1 : n) - f;
      }
    }
    // all off: this last pass set the targets back to the bare faders
    this.lyrLive = fOn || scan.on || wob;
    for (let i = 0; i < NS; i++) this.bGainTgt[i] = dbToGain(this.bFaderDb[i] + ly[i]);
    const fast = scan.on || (fOn && (this.bfModulated || envOn || Math.round(p[this.iBfKey]) !== 0)) || wob;
    if (fast !== this.lyrFast) {
      this.lyrFast = fast;
      this.updateSmoothing();
    }
  }

  /** band dynamics targets from the effective values; once per block (cheap, no per-sample work while off) */
  private applyDyn(p: Float32Array) {
    const on = p[this.iDynOn] >= 0.5;
    this.dynOnTgt = on ? 1 : 0;
    if (!on && !this.dynLive) return;
    this.dThrTgt = clamp(p[this.iDynThr], -60, 0);
    this.dSlopeTgt = 1 - 1 / clamp(p[this.iDynRatio], 1, 20);
    this.dMode = clamp(Math.round(p[this.iDynMode]), 0, 2);
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
    const src = clamp(Math.round(p[this.iDynSrc]), 0, 2);
    if (src !== this.dynSrc) {
      // the analysis starts clean on the new source
      this.dynSrc = src;
      this.aS1.fill(0);
      this.aS2.fill(0);
      this.aY.fill(0);
      this.fS1.fill(0);
      this.fS2.fill(0);
    }
    const perStep = (0.001 * this.fs) / DYN_SUB;
    this.dDlyL = Math.min(this.dRingLen - 1, Math.round(clamp(p[this.iDynDelay], 0, DYN_DELAY_MAX_MS) * perStep));
    this.dDlyR = Math.min(this.dRingLen - 1, this.dDlyL + Math.round(clamp(p[this.iDynRdly], 0, DYN_RDLY_MAX_MS) * perStep));
    this.fOn = p[this.iDynFilt] >= 0.5;
    const fHz = Math.min(clamp(p[this.iDynFiltF], 20, 20000), 0.45 * this.fs);
    if (fHz !== this.fHz) {
      this.fHz = fHz;
      const g = Math.tan((Math.PI * fHz) / this.fs);
      this.fA1 = 1 / (1 + g * (g + this.fK));
      this.fA2 = g * this.fA1;
      this.fA3 = g * this.fA2;
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
      this.dCorr = 0;
      this.dCorrA = 1 - Math.exp(-DYN_SUB / (0.15 * this.fs));
      this.dG.fill(1);
      this.dGTgt.fill(1);
      this.dGStep.fill(0);
      this.dGR.fill(1);
      this.dGRTgt.fill(1);
      this.dGRStep.fill(0);
      this.dRing.fill(0);
      this.aS1.fill(0);
      this.aS2.fill(0);
      this.aY.fill(0);
      this.fS1.fill(0);
      this.fS2.fill(0);
      this.dSub = 0;
    }
  }

  /**
   * IN / OUT source, every sample while the dynamics run: the input filter (if on), then the analysis
   * bandpass of every band on that signal (TPT SVF, output k·BP, unity at the band centre).
   */
  private dynAnalyse(xL: number, xR: number) {
    if (this.fOn) {
      const a1 = this.fA1, a2 = this.fA2, a3 = this.fA3, k = this.fK, s1 = this.fS1, s2 = this.fS2;
      for (let ch = 0; ch < 2; ch++) {
        const v3 = (ch === 0 ? xL : xR) - s2[ch];
        const v1 = a1 * s1[ch] + a2 * v3;
        const v2 = s2[ch] + a2 * s1[ch] + a3 * v3;
        s1[ch] = 2 * v1 - s1[ch];
        s2[ch] = 2 * v2 - s2[ch];
        if (ch === 0) xL = k * v1;
        else xR = k * v1;
      }
      if (!(Math.abs(s1[0]) + Math.abs(s1[1]) + Math.abs(s2[0]) + Math.abs(s2[1]) < 1e8)) {
        s1.fill(0);
        s2.fill(0);
      }
    }
    const A1 = this.aA1, A2 = this.aA2, A3 = this.aA3, K = this.aK, S1 = this.aS1, S2 = this.aS2, Y = this.aY;
    for (let b = 0; b < NB; b++) {
      const a1 = A1[b], a2 = A2[b], a3 = A3[b], k = K[b];
      for (let ch = 0; ch < 2; ch++) {
        const i = b * 2 + ch;
        const c1 = S1[i], c2 = S2[i];
        const v3 = (ch === 0 ? xL : xR) - c2;
        const v1 = a1 * c1 + a2 * v3;
        const v2 = c2 + a2 * c1 + a3 * v3;
        const n1 = 2 * v1 - c1;
        const n2 = 2 * v2 - c2;
        if (!(Math.abs(n1) + Math.abs(n2) < 1e8)) {
          S1[i] = S2[i] = Y[i] = 0;
          continue;
        }
        S1[i] = n1;
        S2[i] = n2;
        Y[i] = k * v1;
      }
    }
  }

  /**
   * Detector, every DYN_DET samples after the band loop: instantaneous amplitude² of each band output
   * y = k·BP from the TPT states alone (s1 = BP + g·HP, s2 = LP + g·BP after the update), so the hot
   * filter loop stays untouched: A² = k²·(BP² − LP·HP). Stereo-linked: the louder channel, peak-held
   * until the next gain computer step.
   */
  private dynDetect() {
    const band = this.dynSrc === DYN_SRC_BAND;
    // BAND: the band filters themselves; IN / OUT: the analysis bandpasses (same form, see dynAnalyse)
    const ic1 = band ? this.ic1 : this.aS1, ic2 = band ? this.ic2 : this.aS2, yPrev = band ? this.yPrev : this.aY;
    const cG = this.cG, cK = this.cK, aG = this.aG, aK = this.aK, dPk = this.dPk;
    for (let b = 0; b < NB; b++) {
      let pk = dPk[b];
      for (let i = b * 2; i < b * 2 + 2; i++) {
        // with BP = y/k, LP = s2 − g·BP, HP = (s1 − BP)/g:  k²·LP·HP = (k·s2 − g·y)(k·s1 − y)/g
        const y = yPrev[i], k = band ? cK[i] : aK[b], g = band ? cG[i] : aG[b];
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
    const mode = this.dMode, cut = mode !== DYN_BOOST, boost = mode !== DYN_CUT;
    const gateP = thrP * DYN_GATE_P; // no boost below this A²
    const corr = this.dCorr;
    let sP = 0, sB = 0; // BOOST: output power of the bands without / with the boosts
    const bGain = this.bGainCur, bMk = this.bMakeupCur;
    const atkA = this.dAtkA, relA = this.dRelA;
    const dPk = this.dPk, dGr = this.dGr, dGc = this.dGc, dG = this.dG, dGTgt = this.dGTgt, dGStep = this.dGStep;
    const dGR = this.dGR, dGRTgt = this.dGRTgt, dGRStep = this.dGRStep;
    const amtCur = this.dAmtCur, amtTgt = this.dAmtTgt, amtA = this.dAmtA, mGr = this.mGr, mLvl = this.mLvl;
    // delay line: write this step's change, L reads DELAY back, R DELAY + R DLY
    const ring = this.dRing, len = this.dRingLen, pos = this.dRingPos, dl = this.dDlyL, dr = this.dDlyR;
    this.dRingPos = pos + 1 < len ? pos + 1 : 0;
    const rowL = (dl > pos ? pos - dl + len : pos - dl) * NB;
    const rowR = (dr > pos ? pos - dr + len : pos - dr) * NB;
    for (let b = 0; b < NB; b++) {
      const pk = dPk[b];
      dPk[b] = 0;
      if (pk > mLvl[b]) mLvl[b] = pk;
      let tgt = 0;
      if (pk > thrP) {
        if (cut) {
          tgt = DB_PER_LN_POW * Math.log(pk / thrP) * slope;
          if (tgt > range) tgt = range;
        }
      } else if (boost && pk > gateP) {
        const under = DB_PER_LN_POW * Math.log(thrP / pk); // dB below the threshold, < DYN_GATE_DB
        tgt = under * slope;
        if (tgt > range) tgt = range;
        const fade = (DYN_GATE_DB - under) * (1 / DYN_GATE_FADE_DB);
        tgt = fade < 1 ? -tgt * fade : -tgt;
      }
      // attack while the gain goes down (more cut, less boost), release while it comes back up
      let gr = dGr[b];
      gr += (tgt - gr) * (tgt > gr ? atkA : relA);
      if (gr < 1e-9 && gr > -1e-9) gr = 0;
      dGr[b] = gr;
      const amt = (amtCur[b] += (amtTgt[b] - amtCur[b]) * amtA[b]);
      let gcNow = gr * amt * onRamp;
      if (mode === DYN_BOOST) {
        // what the band adds to the output: its level × fader × makeup (both channels)
        const gL = bGain[b * 2] * bMk[b * 2], gR = bGain[b * 2 + 1] * bMk[b * 2 + 1];
        const w = pk * (gL * gL + gR * gR);
        sP += w;
        sB += gcNow < 0 ? w * Math.exp(-2 * gcNow * LN_GAIN_PER_DB) : w;
      }
      gcNow += corr; // 0 outside BOOST (after its short fade when leaving BOOST)
      ring[pos * NB + b] = gcNow;
      const gc = dl ? ring[rowL + b] : gcNow;
      const gcR = dr ? ring[rowR + b] : gcNow;
      dGc[b] = gc;
      if (gc * gc > mGr[b] * mGr[b]) mGr[b] = gc;
      // land exactly on the previous target (so "no change" is exactly 1), then glide to the new one
      const g0 = dGTgt[b];
      const g1 = gc > 1e-6 || gc < -1e-6 ? Math.exp(-gc * LN_GAIN_PER_DB) : 1;
      dG[b] = g0;
      dGTgt[b] = g1;
      dGStep[b] = (g1 - g0) * (1 / DYN_SUB);
      const r0 = dGRTgt[b];
      const r1 = gcR === gc ? g1 : gcR > 1e-6 || gcR < -1e-6 ? Math.exp(-gcR * LN_GAIN_PER_DB) : 1;
      dGR[b] = r0;
      dGRTgt[b] = r1;
      dGRStep[b] = (r1 - r0) * (1 / DYN_SUB);
    }
    // BOOST level correction: cut every band by the power the boosts added (follows the next step)
    let cTgt = 0;
    if (sB > sP && sP > 1e-30) {
      cTgt = DB_PER_LN_POW * Math.log(sB / sP);
      if (cTgt > range) cTgt = range;
    }
    let c = corr + (cTgt - corr) * this.dCorrA;
    if (c < 1e-9) c = 0;
    this.dCorr = c;
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
      if (this.dG[b] !== 1 || this.dGTgt[b] !== 1 || this.dGR[b] !== 1 || this.dGRTgt[b] !== 1) settled = false;
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
    t[S_FBALLR] = clamp(p[I_FBALL_R], 0, 1) * FBALL_MAX;
    t[S_TONE] = Math.log(clamp(p[G.fbAllTone], 200, 20000));
    t[S_SPREAD] = clamp(p[G.spread], -1, 1);
    t[S_CLASSIC] = p[this.iSpreadMode] >= 0.5 ? 1 : 0;
    const mix = clamp(p[G.mix], 0, 1);
    t[S_DRY] = Math.cos(mix * HALF_PI);
    t[S_WET] = Math.sin(mix * HALF_PI);
    t[S_OUT] = dbToGain(clamp(p[G.outputGain], -24, 12));
    this.fbOnTgt[0] = p[G.fbAllOn] >= 0.5 ? 1 : 0;
    this.fbOnTgt[1] = p[I_FBALLON_R] >= 0.5 ? 1 : 0;
    this.bypTgt = p[G.bypass] >= 0.5 ? 1 : 0;
    this.fbRoute = p[this.iRoute] >= 0.5 ? 1 : 0;
    this.knobMode = resKnobMode(p[this.iKnob]);
    this.knobCurve = clamp(Math.round(p[this.iCurve]), 0, 3);
    const w = clamp(Math.round(p[this.iWeight]), 0, 2);
    if (w !== this.knobWeight) {
      this.knobWeight = w;
      for (let b = 0; b < NB; b++) this.kW[b] = resKnobWeight(b, w);
    }
    for (let i = 0; i < NS; i++) {
      this.bFaderDb[i] = p[this.iGain[i]];
      this.bGainTgt[i] = dbToGain(this.bFaderDb[i] + this.lyrDb[i]);
      this.bResTgt[i] = clamp(p[this.iRes[i]], 0, 1);
      this.bFbTgt[i] = clamp(p[this.iFb[i]], 0, 1);
    }
    if (snap) {
      this.gCur.set(t);
      this.bGainCur.set(this.bGainTgt);
      this.bResCur.set(this.bResTgt);
      this.bFbCur.set(this.bFbTgt);
      this.fbOnCur.set(this.fbOnTgt);
      this.bypCur = this.bypTgt;
    }
  }

  /**
   * true when every per-slot glide (level, fb, makeup, tap) has arrived: values within 1e-7 of their
   * target are set onto it (−140 dB, inaudible), so the per-sample glides can stop.
   */
  private bandsSettled(): boolean {
    const gc = this.bGainCur, gt = this.bGainTgt, fc = this.bFbCur, ft = this.bFbTgt;
    const mc = this.bMakeupCur, mt = this.bMakeup, tc = this.bTapCur, tt = this.bTap;
    let settled = true;
    for (let i = 0; i < NS; i++) {
      if (gc[i] !== gt[i]) {
        if (Math.abs(gt[i] - gc[i]) < SETTLE_EPS) gc[i] = gt[i];
        else settled = false;
      }
      if (fc[i] !== ft[i]) {
        if (Math.abs(ft[i] - fc[i]) < SETTLE_EPS) fc[i] = ft[i];
        else settled = false;
      }
      if (mc[i] !== mt[i]) {
        if (Math.abs(mt[i] - mc[i]) < SETTLE_EPS) mc[i] = mt[i];
        else settled = false;
      }
      if (tc[i] !== tt[i]) {
        if (Math.abs(tt[i] - tc[i]) < SETTLE_EPS) tc[i] = tt[i];
        else settled = false;
      }
    }
    return settled;
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
    this.envF.fill(0);
    this.yBuf.fill(0);
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
    // RESONANCE knob through its curve; per band weighted. RES mode shifts RES, FEEDBACK mode scales feedback,
    // FOCUS sweeps a RES spotlight through the bands (no band weighting).
    const knob = resKnobShape(this.gCur[S_RESOFF], this.knobCurve);
    const fbMode = this.knobMode === RES_KNOB_FEEDBACK;
    const focus = this.knobMode === RES_KNOB_FOCUS;
    this.fbAllFactor = fbMode ? fbKnobFactor(knob) : 1;
    const fMax = 0.45 * fs;
    const dt = SUB / fs;
    const driftSlew = 1 - Math.exp(-dt / 1.5);
    for (let b = 0; b < NB; b++) {
      const kb = focus ? resFocusShift(b, knob) : knob * this.kW[b];
      this.bFbFactor[b] = fbMode ? fbKnobFactor(kb) : 1;
      for (let ch = 0; ch < 2; ch++) {
        const i = b * 2 + ch;
        // RES per channel (L/R per band): Q, loop excess, makeup and tap level per slot
        // band filter RES AMT (0 unless used, so the sum is unchanged then)
        const lr = (this.lyrResCur[i] += (this.lyrRes[i] - this.lyrResCur[i]) * this.lyrResA);
        let r = this.bResCur[i] + (fbMode ? 0 : kb) + lr;
        r = r < 0 ? 0 : r > 1 ? 1 : r;
        const qNom = Q_MIN * Math.exp(r * Q_RANGE_LN);
        this.bFbExcess[i] = 0.15 + 0.03 * qNom;
        this.bMakeup[i] = resonanceMakeup(qNom);
        this.bTap[i] = feedbackTapGain(qNom);
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

  /** ANALOG drive settings for analog an (> 0.5) */
  private setDrive(an: number): void {
    this.drvAn = an;
    const d = Math.min(1, (an - 0.5) * 2);
    this.drvGain = Math.pow(10, (DRIVE_MAX_DB * d) / 20);
    this.drvHard = d;
    this.drvBias = DRIVE_ASYM * d;
    this.drvBiasOut = driveClip(this.drvBias, d);
    // level match: a peak of DRIVE_REF comes out as large as it went in (mean of both half-waves)
    const u = this.drvGain * DRIVE_REF;
    this.drvMakeup = (2 * DRIVE_REF) / (driveClip(u + this.drvBias, d) - driveClip(this.drvBias - u, d));
    const t = Math.min(1, d / DRIVE_FADE);
    this.drvMix = t * t * (3 - 2 * t);
  }

  /** ANALOG drive on one channel: gain, off-centre clipper with ADAA, makeup */
  private drive(x: number, ch: number): number {
    const u = x * this.drvGain;
    const up = this.drvU[ch];
    this.drvU[ch] = u;
    const h = this.drvHard, b = this.drvBias, bo = this.drvBiasOut;
    const du = u - up;
    const y =
      du > 1e-5 || du < -1e-5
        ? (driveClipF(u + b, h) - driveClipF(up + b, h)) / du - bo
        : driveClip(0.5 * (u + up) + b, h) - bo;
    return y * this.drvMakeup;
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
    mod.beginBlock(n, typeof currentTime === 'number' ? currentTime : NaN);
    if (mod.baseVersion !== this.appliedVersion || mod.anyModulated(0, NUM_RESONATOR_PARAMS) || mod.anyModulated(R_FIRST, NUM_PARAMS)) {
      this.appliedVersion = mod.baseVersion;
      this.applyParams(mod.eff, false);
    }
    this.applyDyn(mod.eff);
    this.applyLayers(mod.eff, rawL, rawR, n);

    /* --- pre filter (on a copy: never write into the input buffers) --- */
    const preL = this.preL, preR = this.preR;
    if (rawL) preL.set(rawL.subarray(0, n)); else preL.fill(0);
    if (rawR) preR.set(rawR.subarray(0, n)); else preR.fill(0);
    mod.preFilter.process(preL, preR, n, mod.ctx);
    const inL = preL, inR = preR;
    const taps = mod.taps;
    const tapIn = taps[TAP_IN], tapRes = taps[TAP_RES_OUT], tapOut = taps[TAP_OUT];
    // per channel taps, only while a follower listens to L or R
    const lrTaps = mod.lrTaps, tapsL = mod.tapsL, tapsR = mod.tapsR;
    const tapInL = tapsL[TAP_IN], tapResL = tapsL[TAP_RES_OUT], tapOutL = tapsL[TAP_OUT];
    const tapInR = tapsR[TAP_IN], tapResR = tapsR[TAP_RES_OUT], tapOutR = tapsR[TAP_OUT];

    const gCur = this.gCur, gTgt = this.gTgt;
    const bGainCur = this.bGainCur, bGainTgt = this.bGainTgt;
    const bMakeup = this.bMakeup, bMakeupCur = this.bMakeupCur;
    const bTap = this.bTap, bTapCur = this.bTapCur, bFbFactor = this.bFbFactor;
    const fbRoute = this.fbRoute;
    const bFbCur = this.bFbCur, bFbTgt = this.bFbTgt;
    const bResCur = this.bResCur, bResTgt = this.bResTgt;
    const gA = this.gA, bGainA = this.bGainA, bFbA = this.bFbA, bResA = this.bResA;
    const tStep = this.toggleStep;
    const cA1 = this.cA1, cA2 = this.cA2, cA3 = this.cA3, cK = this.cK, cG = this.cG;
    const ic1 = this.ic1, ic2 = this.ic2, yPrev = this.yPrev, env = this.env;
    const envRel = this.envRel;
    const faLp = this.faLp, faDcX = this.faDcX, faDcY = this.faDcY, faRet = this.faRet;
    const mBandSq = this.mBandSq, mBandSqL = this.mBandSqL, mBandSqR = this.mBandSqR;
    const dcR = this.dcR;
    // hot scalars live in locals for the loop (written back at the end / before meter posts)
    const fbOnTgt0 = this.fbOnTgt[0], fbOnTgt1 = this.fbOnTgt[1], bypTgt = this.bypTgt;
    let fbOn0 = this.fbOnCur[0], fbOn1 = this.fbOnCur[1], byp = this.bypCur, sub = this.subCount, mc = this.meterCount;
    const mInPk = this.mInPk, mOutPk = this.mOutPk;
    let inPk0 = mInPk[0], inPk1 = mInPk[1], outPk0 = mOutPk[0], outPk1 = mOutPk[1];
    let mHot = this.mHot;
    let faLpA = this.faLpA;
    const meterInterval = this.meterInterval;
    // band dynamics: everything below is skipped while they are idle
    const dynAct = this.dynLive;
    const dynOnTgt = this.dynOnTgt;
    let dynOn = this.dynOnCur, dSub = this.dSub;
    const dGain = this.dG, dGStep = this.dGStep, dGainR = this.dGR, dGRStep = this.dGRStep;
    const dynAna = dynAct && this.dynSrc !== DYN_SRC_BAND;
    const dynIn = this.dynSrc === DYN_SRC_IN;

    // the per-slot glides (level, fb, makeup, tap) run per sample only while one of them still moves;
    // settled, the per-slot values are computed once per coefficient update (see bandsSettled)
    let glide = !this.bandsSettled();
    let needPre = true;
    for (let s = 0; s < n; s++) {
      /* --- parameter smoothing (per sample) --- */
      for (let j = 0; j < NUM_GS; j++) gCur[j] += (gTgt[j] - gCur[j]) * gA[j];
      if (glide) {
        for (let i = 0; i < NS; i++) {
          bGainCur[i] += (bGainTgt[i] - bGainCur[i]) * bGainA[i];
          bFbCur[i] += (bFbTgt[i] - bFbCur[i]) * bFbA[i];
        }
      }
      if (fbOn0 !== fbOnTgt0) {
        fbOn0 += fbOn0 < fbOnTgt0 ? tStep : -tStep;
        if (Math.abs(fbOn0 - fbOnTgt0) < tStep) fbOn0 = fbOnTgt0;
      }
      if (fbOn1 !== fbOnTgt1) {
        fbOn1 += fbOn1 < fbOnTgt1 ? tStep : -tStep;
        if (Math.abs(fbOn1 - fbOnTgt1) < tStep) fbOn1 = fbOnTgt1;
      }
      if (byp !== bypTgt) {
        byp += byp < bypTgt ? tStep : -tStep;
        if (Math.abs(byp - bypTgt) < tStep) byp = bypTgt;
      }
      if (++sub >= SUB) {
        sub = 0;
        // resonance only feeds the coefficients, so it is smoothed at the coefficient rate (same τ)
        for (let i = 0; i < NS; i++) bResCur[i] += (bResTgt[i] - bResCur[i]) * bResA[i];
        this.updateCoefs();
        faLpA = this.faLpA;
        glide = !this.bandsSettled();
        needPre = true;
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
      if (lrTaps) {
        tapInL[s] = dryL;
        tapInR[s] = dryR;
      }
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
      let sL = (fastTanh(dryL * inGain * satInv + bias) - tb) * satNorm;
      let sR = (fastTanh(dryR * inGain * satInv + bias) - tb) * satNorm;
      // ANALOG drive: upper half of the knob
      if (an > 0.5) {
        if (an !== this.drvAn) this.setDrive(an);
        const w = this.drvMix;
        sL += (this.drive(sL, 0) - sL) * w;
        sR += (this.drive(sR, 1) - sR) * w;
      } else {
        this.drvU[0] = sL;
        this.drvU[1] = sR;
      }
      const xL = sL + this.noise() * noiseAmp + faRet[0];
      const xR = sR + this.noise() * noiseAmp + faRet[1];

      /* --- spread gains (ODD/EVEN: right of centre odd bands → L, even → R; left of centre mirrored) --- */
      const spr = gCur[S_SPREAD];
      const sprA = spr < 0 ? -spr : spr;
      const th = sprA * QUARTER_PI;
      const gNear = SQRT2 * Math.cos(QUARTER_PI - th); // gain on the side the band moves to
      const gFar = SQRT2 * Math.sin(QUARTER_PI - th);
      const gOddL = spr < 0 ? gFar : gNear; // odd bands (1-based); even bands get the mirror
      const gOddR = spr < 0 ? gNear : gFar;
      const sideG = 1 - sprA;
      const nlDamp = NL_DAMP * an;
      // CLASSIC spread (crossfaded while the function switches): R × cg, L / cg
      const cl = gCur[S_CLASSIC];
      const cg = cl > 1e-6 ? Math.exp(spr * CLASSIC_K) : 1;
      const icg = 1 / cg;

      let wetL = 0, wetR = 0;
      let sumL = 0, sumR = 0; // band sums without ODD/EVEN panning (for CLASSIC)
      let faInL = 0, faInR = 0; // feedback tap: band sum after the faders, at tap level (no resonance lift)
      let hot = false;

      /* --- per slot (band × channel): loop gain (FEEDBACK knob applied, left = inverted), post-fader gain, tap level --- */
      const fbgA = this.fbgA, fgA = this.fgA, tapA = this.tapA, yBuf = this.yBuf;
      if (dynAct && !glide && !needPre) {
        // settled, dynamics running: only the gain changes (loop gain and tap level are as computed last)
        for (let b = 0; b < NB; b++) {
          const dg = dGain[b];
          dGain[b] = dg + dGStep[b];
          const dgr = dGainR[b];
          dGainR[b] = dgr + dGRStep[b];
          fgA[b * 2] = bGainCur[b * 2] * dg;
          fgA[b * 2 + 1] = bGainCur[b * 2 + 1] * dgr;
        }
      } else if (glide || dynAct || needPre) {
        needPre = false;
        const bFbExcess = this.bFbExcess;
        for (let b = 0; b < NB; b++) {
          // band dynamics are stereo-linked: one gain per band, after the band's own loop, before makeup
          // and the taps (folded into the fader gain)
          let dg = 1;
          let dgr = 1;
          if (dynAct) {
            dg = dGain[b];
            dGain[b] = dg + dGStep[b];
            dgr = dGainR[b];
            dGainR[b] = dgr + dGRStep[b];
          }
          for (let i = b * 2; i < b * 2 + 2; i++) {
            let fbRaw = bFbCur[i] * bFbFactor[b];
            if (fbRaw > 1) fbRaw = 1;
            else if (fbRaw < -1) fbRaw = -1;
            const fa = fbRaw < 0 ? -fbRaw : fbRaw;
            const gl = fa <= BAND_FB_EDGE ? fa * BAND_FB_SLOPE : 1 + ((fa - BAND_FB_EDGE) / (1 - BAND_FB_EDGE)) * bFbExcess[i];
            fbgA[i] = fbRaw < 0 ? -gl : gl;
            fgA[i] = dynAct ? bGainCur[i] * (i & 1 ? dgr : dg) : bGainCur[i];
            tapA[i] = glide ? (bTapCur[i] += (bTap[i] - bTapCur[i]) * 0.002) : bTapCur[i];
          }
        }
      }

      if (fbRoute === 0) {
        /* --- BAND route: every band feeds back into itself, before its fader --- */
        for (let b = 0; b < NB; b++) {
          for (let ch = 0; ch < 2; ch++) {
            const i = b * 2 + ch;
            const fbg = fbgA[i];
            const fbMag = fbg < 0 ? -fbg : fbg;
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
            if (fbMag > 1e-6) {
              // limiter acts on the amplified loop signal, so the fed-back level stays ≤ BAND_CLIP_L
              const u = fbMag * e * BAND_CLIP_INV;
              const cg = 1 / Math.sqrt(1 + u * u);
              if (cg < 0.8 && fbMag > HOT_LOOP_GAIN) hot = true;
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
              yBuf[i] = 0;
              continue;
            }
            ic1[i] = n1;
            ic2[i] = n2;
            yPrev[i] = y;
            yBuf[i] = y;
          }
        }
      } else {
        /* --- COMMON route: the bands feed back after their faders into the shared input of all bands --- */
        const tP = this.tP, tB = this.tB, tA1 = this.tA1, tA2 = this.tA2, tA3 = this.tA3, tW = this.tW, envF = this.envF;
        for (let ch = 0; ch < 2; ch++) {
          const x = ch === 0 ? xL : xR;
          // every band output is linear in the shared input u: y = P + B·u
          let sWP = 0, sWB = 0;
          for (let b = 0; b < NB; b++) {
            const i = b * 2 + ch;
            const k = cK[i];
            let a1 = cA1[i], a2 = cA2[i], a3 = cA3[i];
            const c1 = ic1[i], c2 = ic2[i];
            const ypa = Math.abs(yPrev[i]);
            let e = env[i] * envRel;
            if (ypa > e) e = ypa;
            env[i] = e;
            if (nlDamp > 0) {
              const y2 = e * e;
              const g = cG[i];
              const ke = k + (nlDamp * y2) / (1 + 0.25 * y2);
              a1 = 1 / (1 + g * (g + ke));
              a2 = g * a1;
              a3 = g * a2;
            }
            const P = k * (a1 * c1 - a2 * c2);
            const B = k * a2;
            const w = fbgA[i] * fgA[i] * tapA[i];
            tP[b] = P;
            tB[b] = B;
            tA1[b] = a1;
            tA2[b] = a2;
            tA3[b] = a3;
            tW[b] = w;
            sWP += w * P;
            sWB += w * B;
          }
          // limiter on the summed return (envelope of the unlimited return), then the delay-free solve
          // u = x + sc·Σ w·y  →  u = (x + sc·Σ w·P) / (1 − sc·Σ w·B)
          const ef = envF[ch];
          const ul = ef * COMMON_CLIP_INV;
          let sc = 1 / Math.sqrt(1 + ul * ul);
          if (sc < 0.8) hot = true;
          let d = sc * sWB;
          if (d > COMMON_D_MAX) {
            sc *= COMMON_D_MAX / d;
            d = COMMON_D_MAX;
          }
          const u = (x + sc * sWP) / (1 - d);
          let F = 0;
          for (let b = 0; b < NB; b++) {
            const i = b * 2 + ch;
            const c1 = ic1[i], c2 = ic2[i];
            const a1 = tA1[b], a2 = tA2[b], a3 = tA3[b];
            const y = tP[b] + tB[b] * u;
            const v3 = u - c2;
            const v1 = a1 * c1 + a2 * v3;
            const v2 = c2 + a2 * c1 + a3 * v3;
            const n1 = 2 * v1 - c1;
            const n2 = 2 * v2 - c2;
            if (!(Math.abs(n1) + Math.abs(n2) < 1e8) || !(y === y)) {
              this.resetSlot(i);
              yBuf[i] = 0;
              continue;
            }
            ic1[i] = n1;
            ic2[i] = n2;
            yPrev[i] = y;
            yBuf[i] = y;
            F += tW[b] * y;
          }
          const fAbs = F < 0 ? -F : F;
          let e2 = ef * envRel;
          if (fAbs > e2) e2 = fAbs;
          envF[ch] = e2 < 1e8 ? e2 : 0;
        }
      }

      /* --- output: fader, taps, resonance makeup, spread --- */
      for (let b = 0; b < NB; b++) {
        const iL = b * 2, iR = iL + 1;
        let yL = yBuf[iL] * fgA[iL];
        let yR = yBuf[iR] * fgA[iR];
        faInL += yL * tapA[iL];
        faInR += yR * tapA[iR];
        // resonance makeup (after the band's own loop, outside the feedback loops so their
        // self-oscillation edge does not move with resonance)
        if (glide) {
          yL *= bMakeupCur[iL] += (bMakeup[iL] - bMakeupCur[iL]) * 0.002;
          yR *= bMakeupCur[iR] += (bMakeup[iR] - bMakeupCur[iR]) * 0.002;
        } else {
          yL *= bMakeupCur[iL];
          yR *= bMakeupCur[iR];
        }
        mBandSq[b] += 0.5 * (yL * yL + yR * yR);
        taps[TAP_BAND0 + b][s] = 0.5 * (yL + yR);
        if (lrTaps) {
          tapsL[TAP_BAND0 + b][s] = yL;
          tapsR[TAP_BAND0 + b][s] = yR;
        }
        sumL += yL;
        sumR += yR;
        // ODD/EVEN spread: mid panned, side faded
        const m = 0.5 * (yL + yR);
        const d = 0.5 * (yL - yR) * sideG;
        let oL: number, oR: number;
        if ((b & 1) === 0) {
          // odd band (1-based)
          oL = gOddL * m + d;
          oR = gOddR * m - d;
        } else {
          oL = gOddR * m + d;
          oR = gOddL * m - d;
        }
        wetL += oL;
        wetR += oR;
        // meters: the band in L and R as it leaves, with the CLASSIC share mixed in like below
        oL += (yL * icg - oL) * cl;
        oR += (yR * cg - oR) * cl;
        mBandSqL[b] += oL * oL;
        mBandSqR[b] += oR * oR;
      }
      // CLASSIC spread: R up and L down right of centre (crossfaded while the function switches)
      if (cl > 1e-6) {
        wetL += (sumL / cg - wetL) * cl;
        wetR += (sumR * cg - wetR) * cl;
      }

      tapRes[s] = 0.5 * (wetL + wetR);
      if (lrTaps) {
        tapResL[s] = wetL;
        tapResR[s] = wetR;
      }
      if (dynAna) this.dynAnalyse(dynIn ? sL : wetL, dynIn ? sR : wetR);
      if (dynAct) {
        if (++dSub >= DYN_SUB) dSub = 0;
        if (dSub % DYN_DET === 0) this.dynDetect();
      }

      /* --- Feedback All loop (one-sample delay) --- */
      // per channel (L/R per band): its own switch and amount
      const faG0 = gCur[S_FBALL] * fbOn0 * this.fbAllFactor;
      const faG1 = gCur[S_FBALLR] * fbOn1 * this.fbAllFactor;
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
        // soft clip after the gain: the return never exceeds FBALL_CLIP_L
        if (faG0 > 1e-6 || faG0 < -1e-6) {
          const r0 = faG0 * h0;
          const u0 = r0 * FBALL_CLIP_INV;
          faRet[0] = r0 / Math.sqrt(1 + u0 * u0);
          if (u0 * u0 > 0.5) hot = true;
        } else faRet[0] = 0;
        if (faG1 > 1e-6 || faG1 < -1e-6) {
          const r1 = faG1 * h1;
          const u1 = r1 * FBALL_CLIP_INV;
          faRet[1] = r1 / Math.sqrt(1 + u1 * u1);
          if (u1 * u1 > 0.5) hot = true;
        } else faRet[1] = 0;
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
      if (lrTaps) {
        tapOutL[s] = l;
        tapOutR[s] = r;
      }
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
    this.fbOnCur[0] = fbOn0; this.fbOnCur[1] = fbOn1; this.bypCur = byp; this.subCount = sub; this.meterCount = mc;
    mInPk[0] = inPk0; mInPk[1] = inPk1; mOutPk[0] = outPk0; mOutPk[1] = outPk1;
    this.mHot = mHot;
    // extra output channels (if any) mirror the left
    for (let c = 2; c < out.length; c++) out[c].set(outL);
    return true;
  }

  private postMeters(cnt: number, hot: boolean) {
    // copied (not reused) so every frame keeps its own values, also in offline tests
    const bands = new Float32Array(NB), bandsL = new Float32Array(NB), bandsR = new Float32Array(NB);
    for (let b = 0; b < NB; b++) {
      bands[b] = Math.sqrt(this.mBandSq[b] / cnt);
      bandsL[b] = Math.sqrt(this.mBandSqL[b] / cnt);
      bandsR[b] = Math.sqrt(this.mBandSqR[b] / cnt);
      this.mBandSq[b] = this.mBandSqL[b] = this.mBandSqR[b] = 0;
    }
    const dynGR = new Float32Array(this.mGr);
    this.mGr.fill(0);
    const dynLvl = new Float32Array(NB);
    for (let b = 0; b < NB; b++) dynLvl[b] = Math.sqrt(this.mLvl[b]);
    this.mLvl.fill(0);
    const scan = this.mod.scan;
    this.port.postMessage({
      type: 'meters',
      inPeak: [this.mInPk[0], this.mInPk[1]],
      outPeak: [this.mOutPk[0], this.mOutPk[1]],
      bands,
      bandsL,
      bandsR,
      dynGR,
      dynLvl,
      scanDb: new Float32Array(scan.layerDb),
      scanPos: [scan.on ? scan.lastL : -1, scan.on ? scan.lastR : -1],
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
