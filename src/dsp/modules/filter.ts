/**
 * Pre / post filter stage: stereo multimode TPT state-variable filter (Zavalishin / Simper form).
 *
 *  in ─► drive (tanh-style, level compensated) ─► SVF ─► [SVF] ─► type mix ─► dry/wet ─► on/off fade ─► out
 *
 *  Types       : LP, BP (unity peak, k·bp), HP, Notch (lp + hp = x − k·bp). Output = cx·x + cb·k·bp + cl·lp,
 *                so a type change is a 10 ms ramp of three weights (no state jump, no click).
 *  Slope       : 12 dB = one SVF, 24 dB = two cascaded SVFs at Q_stage = √Q, so the gain at the cutoff
 *                (Q for LP/HP) is the same for both slopes and res 1 never stacks to Q² (+56 dB).
 *                Switching crossfades between the first and the second stage output over 10 ms.
 *  Resonance   : Q = 0.5 · 50^res → 0.5 … 25. The linear filter is stable for any Q > 0 and any
 *                (modulated) cutoff, so full-depth audio-rate cutoff modulation stays bounded.
 *  Cutoff      : 20 Hz … min(20 kHz, 0.45·fs), smoothed in the log domain.
 *  Smoothing   : cutoff and resonance ramp linearly across each block from the previous effective value
 *                (removes the 128-sample staircase of fast LFOs) plus a 1.5 ms one-pole; coefficients are
 *                recomputed every 16 samples and interpolated per sample. Drive / mix: 5 ms one-pole.
 *  Drive       : u = x + w·(c·sat(g·x) − x), g = 0..24 dB, w = drive / 24 (so 0 dB is exactly clean),
 *                c keeps the RMS of a −12 dBFS sine (typical program stays within ~±3 dB; at 24 dB
 *                quiet signals gain up to +9 dB, loud ones are squashed).
 *  On / off    : 10 ms linear crossfade with the dry signal. Fully off = untouched buffers (returns false).
 *                Switching on starts from a cleared state with the current settings snapped (no sweep).
 *  Safety      : non-finite filter state is cleared and non-finite samples of that block zeroed;
 *                state below −300 dB is flushed (silent input would otherwise end in denormals).
 *  Key         : KEY Off = FREQ; Focus = the spot of the RESONANCE knob (FOCUS mode, shaped by its curve), glided
 *                between the band centres; Band n = that band's centre. FREQ is then not used.
 *  Env         : the filter's own follower on its input (block peak, 5 ms attack, ENV REL release); −48…0 dBFS
 *                moves the cutoff by ENV AMT octaves (±4 at the stops).
 *  Spread      : L cutoff −SPREAD/2, R +SPREAD/2 octaves (each channel its own coefficients when ≠ 0).
 */
import { FILTER_ENV_OCT, FILTER_KEY_BAND0, FILTER_KEY_FOCUS, FILTER_SPREAD_OCT, type FilterSlot } from '../../shared/paramdefs/modules';
import { BAND_FREQS, NUM_BANDS, paramIndex, resKnobShape } from '../../shared/params';
import type { AudioStage, BlockCtx } from './types';

/* ---------- laws shared with the UI response overlay ---------- */

export const FILTER_Q_MIN = 0.5;
export const FILTER_Q_MAX = 25;
export const FILTER_F_MIN = 20;
export const FILTER_F_MAX = 20000;
export const FILTER_DRIVE_MAX = 24;

/** resonance 0..1 → Q of the 12 dB filter (0.5 … 25, exponential) */
export function filterResToQ(res: number): number {
  res = res > 0 ? (res < 1 ? res : 1) : 0;
  return FILTER_Q_MIN * Math.pow(FILTER_Q_MAX / FILTER_Q_MIN, res);
}

/** Q of each SVF stage: 24 dB cascades two stages at √Q */
export function filterStageQ(res: number, slope24: boolean): number {
  const q = filterResToQ(res);
  return slope24 ? Math.sqrt(q) : q;
}

/** cutoff after KEY: FREQ (key 0), the FOCUS spot of the shaped RESONANCE knob s (key 1), a band centre (key ≥ 2) */
export function filterKeyCutoff(key: number, cutoff: number, s: number): number {
  const k = Math.round(key);
  if (k >= FILTER_KEY_BAND0) return BAND_FREQS[Math.min(NUM_BANDS - 1, k - FILTER_KEY_BAND0)];
  if (k !== FILTER_KEY_FOCUS) return cutoff;
  const x = ((Math.min(1, Math.max(-1, s)) + 1) / 2) * (NUM_BANDS - 1);
  const i = Math.min(NUM_BANDS - 2, Math.floor(x));
  return BAND_FREQS[i] * Math.pow(BAND_FREQS[i + 1] / BAND_FREQS[i], x - i);
}

/** highest cutoff at sample rate fs */
export function filterMaxCutoff(fs: number): number {
  return Math.min(FILTER_F_MAX, 0.45 * fs);
}

/**
 * Linear magnitude of the filter at frequency f (small signal, drive not included), mixed with dry.
 * Exact for the TPT SVF: its response is the analog prototype at the prewarped frequency
 * Ω = tan(πf/fs) / tan(πfc/fs).
 */
export function filterMagnitude(type: number, slope24: boolean, cutoff: number, res: number, mix: number, f: number, fs: number): number {
  const fc = Math.min(filterMaxCutoff(fs), Math.max(FILTER_F_MIN, cutoff));
  const g = Math.tan((Math.PI * fc) / fs);
  const w = Math.tan((Math.PI * Math.min(f, 0.4999 * fs)) / fs) / g;
  const k = 1 / filterStageQ(res, slope24);
  // one stage: N / D with D = (1 − Ω²) + jkΩ
  const dRe = 1 - w * w, dIm = k * w;
  let nRe = 0, nIm = 0;
  const t = Math.round(type);
  if (t === 0) nRe = 1; // LP
  else if (t === 1) nIm = k * w; // BP, unity peak
  else if (t === 2) nRe = -w * w; // HP
  else nRe = dRe; // Notch
  const den = dRe * dRe + dIm * dIm;
  let hRe = (nRe * dRe + nIm * dIm) / den;
  let hIm = (nIm * dRe - nRe * dIm) / den;
  if (slope24) {
    const re = hRe * hRe - hIm * hIm;
    hIm = 2 * hRe * hIm;
    hRe = re;
  }
  const m = mix > 0 ? (mix < 1 ? mix : 1) : 0;
  return Math.hypot(1 - m + m * hRe, m * hIm);
}

/* ---------- DSP ---------- */

/** coefficients are recomputed every SUB samples and interpolated per sample in between */
const SUB = 16;
/** on/off, type and slope crossfades */
const FADE_SEC = 0.01;
/** extra one-pole on cutoff / resonance after the per-block ramp */
const TAU_FREQ = 0.0015;
/** drive / mix smoothing */
const TAU_LEVEL = 0.005;
/** drive level compensation keeps the RMS of a sine at this peak (−12 dBFS) */
const DRIVE_REF = 0.25;
const DB_TO_LN = Math.LN10 / 20;
const LN_QMIN = Math.log(FILTER_Q_MIN);
const LN_QSPAN = Math.log(FILTER_Q_MAX / FILTER_Q_MIN);
/** state below this (−300 dB) is flushed to zero */
const TINY = 1e-15;
/** filter envelope: attack time, and the dB span (−48 … 0 dBFS) mapped to 0 … 1 */
const ENV_ATK_SEC = 0.005;
const ENV_SPAN_DB = 48;
const HALF_LN2 = 0.5 * Math.LN2;

/*
 * Output weights per type (FILTER_TYPES order) on hp = x − k·bp − lp:
 *   y = cx·x + cb·(k·bp) + cl·lp      LP (0,0,1)  BP (0,1,0)  HP (1,−1,−1)  Notch (1,−1,0)
 */
const TYPE_CX = [0, 0, 1, 1];
const TYPE_CB = [0, 1, -1, -1];
const TYPE_CL = [1, 0, -1, 0];

/** smooth saturator: tanh Padé approximant, exactly ±1 (with zero slope) beyond |u| = 3 */
function sat(u: number): number {
  const u2 = u * u;
  return u2 >= 9 ? (u > 0 ? 1 : -1) : (u * (27 + u2)) / (27 + 9 * u2);
}

/** make-up gain per dB of drive (0 … 24): RMS of c·sat(g·REF·sin) equals RMS of REF·sin */
const DRIVE_COMP = new Float64Array(FILTER_DRIVE_MAX + 1);
for (let d = 0; d <= FILTER_DRIVE_MAX; d++) {
  const g = Math.pow(10, d / 20);
  let e = 0;
  for (let i = 0; i < 256; i++) {
    const y = sat(g * DRIVE_REF * Math.sin(((i + 0.5) * Math.PI) / 512)); // quarter period is enough
    e += y * y;
  }
  DRIVE_COMP[d] = (DRIVE_REF * Math.SQRT1_2) / Math.sqrt(e / 256);
}
function driveComp(db: number): number {
  const i = db < FILTER_DRIVE_MAX ? Math.floor(db) : FILTER_DRIVE_MAX - 1;
  return DRIVE_COMP[i] + (DRIVE_COMP[i + 1] - DRIVE_COMP[i]) * (db - i);
}

function toward(v: number, t: number, step: number): number {
  return v < t ? (v + step < t ? v + step : t) : v > t ? (v - step > t ? v - step : t) : v;
}

/** largest block (ModEngine.MAX_BLOCK; not imported to keep this module free of cycles) */
const MAX_N = 128;

/** Pre / post filter stage (one instance per slot). */
export class FilterStage implements AudioStage {
  private readonly iOn: number;
  private readonly iType: number;
  private readonly iSlope: number;
  private readonly iCut: number;
  private readonly iRes: number;
  private readonly iDrive: number;
  private readonly iMix: number;
  private readonly iKey: number;
  private readonly iEnv: number;
  private readonly iEnvRel: number;
  private readonly iSpread: number;
  private readonly iResKnob: number;
  private readonly iResCurve: number;

  private fs = 0;
  private fMax = FILTER_F_MAX;
  private piFs = 0;
  private aFreq = 0;
  private aLevel = 0;
  private fadeStep = 0;

  /** processing (fade > 0 or on) */
  private active = false;
  /** second stage running (24 dB or crossfading to / from it) */
  private bLive = false;

  // smoothed settings
  private lc = 0; // ln cutoff
  private lcPrev = 0; // previous block's target
  private rs = 0;
  private rsPrev = 0;
  private dv = 0; // drive dB
  private mx = 1;
  /** L/R spread (octaves), smoothed */
  private sp = 0;
  /** envelope of the filter's input (linear peak) */
  private env = 0;
  private fade = 0;
  private sl = 0; // 0 = 12 dB … 1 = 24 dB
  private cx = 0;
  private cb = 0;
  private cl = 1;
  // coefficients reached at the end of the last sub-block
  private g = 0;
  private gR = 0;
  private k = 1;
  private m = 0;
  private dg = 1;
  private dc = 1;
  private dw = 0;

  /** TPT integrator memories: [stage A s1, s2, stage B s1, s2] for left, then right */
  readonly state = new Float64Array(8);

  // per-sample coefficients of the current block, shared by both channels
  private readonly c1 = new Float64Array(MAX_N);
  private readonly c2 = new Float64Array(MAX_N);
  private readonly c3 = new Float64Array(MAX_N);
  // R coefficients while SPREAD moves the channels apart
  private readonly c1R = new Float64Array(MAX_N);
  private readonly c2R = new Float64Array(MAX_N);
  private readonly c3R = new Float64Array(MAX_N);
  private readonly kb = new Float64Array(MAX_N); // cb·k
  private readonly wx = new Float64Array(MAX_N); // cx
  private readonly wl = new Float64Array(MAX_N); // cl
  private readonly ws = new Float64Array(MAX_N); // slope crossfade
  private readonly wm = new Float64Array(MAX_N); // wet amount (mix · on fade)
  private readonly da = new Float64Array(MAX_N); // drive: u = da·x + db·sat(dg·x)
  private readonly db = new Float64Array(MAX_N);
  private readonly dgain = new Float64Array(MAX_N);

  constructor(readonly slot: FilterSlot) {
    this.iOn = paramIndex(`${slot}.on`);
    this.iType = paramIndex(`${slot}.type`);
    this.iSlope = paramIndex(`${slot}.slope`);
    this.iCut = paramIndex(`${slot}.cutoff`);
    this.iRes = paramIndex(`${slot}.res`);
    this.iDrive = paramIndex(`${slot}.drive`);
    this.iMix = paramIndex(`${slot}.mix`);
    this.iKey = paramIndex(`${slot}.key`);
    this.iEnv = paramIndex(`${slot}.env`);
    this.iEnvRel = paramIndex(`${slot}.envRel`);
    this.iSpread = paramIndex(`${slot}.spread`);
    this.iResKnob = paramIndex('resOffset');
    this.iResCurve = paramIndex('reso.curve');
  }

  private setRate(fs: number): void {
    this.fs = fs;
    this.fMax = filterMaxCutoff(fs);
    this.piFs = Math.PI / fs;
    this.aFreq = 1 - Math.exp(-SUB / (TAU_FREQ * fs));
    this.aLevel = 1 - Math.exp(-SUB / (TAU_LEVEL * fs));
    this.fadeStep = SUB / (FADE_SEC * fs);
  }

  process(l: Float32Array, r: Float32Array, n: number, ctx: BlockCtx): boolean {
    const e = ctx.eff;
    const onT = e[this.iOn] >= 0.5 ? 1 : 0;
    if (onT === 0 && !this.active) return false;
    if (ctx.fs !== this.fs) this.setRate(ctx.fs);
    if (n > MAX_N) n = MAX_N;

    /* --- targets (effective values: base + modulation) --- */
    let fc = filterKeyCutoff(e[this.iKey], e[this.iCut], resKnobShape(e[this.iResKnob], Math.round(e[this.iResCurve])));
    // the filter's own envelope on its input (block peak, one-pole per block)
    let pk = 0;
    for (let q = 0; q < n; q++) {
      const a = l[q] < 0 ? -l[q] : l[q], b = r[q] < 0 ? -r[q] : r[q];
      if (a > pk) pk = a;
      if (b > pk) pk = b;
    }
    if (!(pk < 1e6)) pk = 0;
    const relS = Math.max(0.001, e[this.iEnvRel] * 0.001);
    this.env += (pk - this.env) * (1 - Math.exp(-n / ((pk > this.env ? ENV_ATK_SEC : relS) * ctx.fs)));
    if (this.env < 1e-9) this.env = 0;
    const envAmt = e[this.iEnv];
    if (envAmt !== 0 && this.env > 0) {
      let en = (20 * Math.log10(this.env) + ENV_SPAN_DB) / ENV_SPAN_DB;
      en = en > 0 ? (en < 1 ? en : 1) : 0;
      const oct = (envAmt > FILTER_ENV_OCT ? FILTER_ENV_OCT : envAmt < -FILTER_ENV_OCT ? -FILTER_ENV_OCT : envAmt) * en;
      fc *= Math.pow(2, oct);
    }
    let spT = e[this.iSpread];
    spT = spT >= -FILTER_SPREAD_OCT ? (spT <= FILTER_SPREAD_OCT ? spT : FILTER_SPREAD_OCT) : spT < 0 ? -FILTER_SPREAD_OCT : 0; // NaN → 0
    fc = fc >= FILTER_F_MIN ? (fc < this.fMax ? fc : this.fMax) : FILTER_F_MIN; // also catches NaN
    const lcT = Math.log(fc);
    let resT = e[this.iRes];
    resT = resT > 0 ? (resT < 1 ? resT : 1) : 0;
    let dvT = e[this.iDrive];
    dvT = dvT > 0 ? (dvT < FILTER_DRIVE_MAX ? dvT : FILTER_DRIVE_MAX) : 0;
    let mxT = e[this.iMix];
    mxT = mxT > 0 ? (mxT < 1 ? mxT : 1) : 0;
    let ty = Math.round(e[this.iType]);
    ty = ty > 0 ? (ty < 3 ? ty : 3) : 0;
    const slT = e[this.iSlope] >= 0.5 ? 1 : 0;
    const cxT = TYPE_CX[ty], cbT = TYPE_CB[ty], clT = TYPE_CL[ty];

    if (!this.active) {
      // waking up: clear state and snap every setting (no sweep from stale values), then fade in
      this.active = true;
      this.state.fill(0);
      this.bLive = slT === 1;
      this.lc = this.lcPrev = lcT;
      this.rs = this.rsPrev = resT;
      this.dv = dvT;
      this.mx = mxT;
      this.sl = slT;
      this.cx = cxT; this.cb = cbT; this.cl = clT;
      this.fade = 0;
      this.sp = spT;
      this.g = this.gAt(lcT - spT * HALF_LN2);
      this.gR = this.gAt(lcT + spT * HALF_LN2);
      this.k = Math.exp(-(1 - 0.5 * slT) * (LN_QMIN + resT * LN_QSPAN));
      this.m = 0;
      this.dg = Math.exp(dvT * DB_TO_LN);
      this.dc = driveComp(dvT);
      this.dw = dvT / FILTER_DRIVE_MAX;
    }
    if (slT === 1 && !this.bLive) {
      // second stage joins: it starts from silence while the slope crossfade opens
      const s = this.state;
      s[2] = s[3] = s[6] = s[7] = 0;
      this.bLive = true;
    }
    const useB = this.bLive;
    const useDrive = this.dv > 1e-6 || dvT > 0;
    // L and R get their own coefficients while SPREAD is (or glides) away from 0
    const useR = this.sp !== 0 || spT !== 0 || this.gR !== this.g;

    /* --- per-sample coefficients: recomputed every SUB samples, linear in between --- */
    let lc = this.lc, rs = this.rs, dv = this.dv, mx = this.mx, fade = this.fade, sl = this.sl, sp = this.sp;
    let cx = this.cx, cb = this.cb, cl = this.cl;
    let g = this.g, gR = this.gR, k = this.k, m = this.m, dg = this.dg, dc = this.dc, dw = this.dw;
    const lcP = this.lcPrev, rsP = this.rsPrev, aF = this.aFreq, aL = this.aLevel, piFs = this.piFs;
    const c1 = this.c1, c2 = this.c2, c3 = this.c3, kb = this.kb, wx = this.wx, wl = this.wl, ws = this.ws, wm = this.wm;
    const nsub = Math.ceil(n / SUB);
    for (let j = 0, i = 0; j < nsub; j++) {
      const i0 = i;
      const end = i + SUB < n ? i + SUB : n;
      const inv = 1 / (end - i);
      const st = (this.fadeStep * (end - i)) / SUB;

      // targets at the end of this sub-block: cutoff / res ramp across the block, then a short one-pole
      const frac = (j + 1) / nsub;
      lc += (lcP + (lcT - lcP) * frac - lc) * aF;
      rs += (rsP + (resT - rsP) * frac - rs) * aF;
      dv += (dvT - dv) * aL;
      mx += (mxT - mx) * aL;
      sp += (spT - sp) * aL;
      if (spT === 0 && sp < 1e-4 && sp > -1e-4) sp = 0;
      const cx0 = cx, cb0 = cb, cl0 = cl, sl0 = sl;
      fade = toward(fade, onT, st);
      sl = toward(sl, slT, st);
      cx = toward(cx, cxT, st);
      cb = toward(cb, cbT, st);
      cl = toward(cl, clT, st);

      const g1 = useR ? this.gAt(lc - sp * HALF_LN2) : Math.tan(piFs * Math.exp(lc));
      const k1 = Math.exp(-(1 - 0.5 * sl) * (LN_QMIN + rs * LN_QSPAN));
      const m1 = fade * mx;
      const gI = (g1 - g) * inv, kI = (k1 - k) * inv, mI = (m1 - m) * inv;
      const k0 = k;
      const cxI = (cx - cx0) * inv, cbI = (cb - cb0) * inv, clI = (cl - cl0) * inv, slI = (sl - sl0) * inv;
      let cxS = cx0, cbS = cb0, clS = cl0, slS = sl0;
      for (; i < end; i++) {
        g += gI; k += kI; m += mI;
        cxS += cxI; cbS += cbI; clS += clI; slS += slI;
        const a = 1 / (1 + g * (g + k));
        c1[i] = a; c2[i] = g * a; c3[i] = g * g * a;
        kb[i] = cbS * k; wx[i] = cxS; wl[i] = clS; ws[i] = slS; wm[i] = m;
      }
      if (useR) {
        // R: its own cutoff, same k (interpolated the same way)
        const gR1 = this.gAt(lc + sp * HALF_LN2);
        const gRI = (gR1 - gR) * inv;
        let kq = k0;
        for (let q = i0; q < end; q++) {
          gR += gRI;
          kq += kI;
          const a = 1 / (1 + gR * (gR + kq));
          this.c1R[q] = a; this.c2R[q] = gR * a; this.c3R[q] = gR * gR * a;
        }
        gR = gR1;
      }
      // land exactly on the sub-block values (no drift from the increments)
      g = g1; k = k1; m = m1;
      if (!useR) gR = g;

      if (useDrive) {
        const da = this.da, db = this.db, dgain = this.dgain;
        const dg1 = Math.exp(dv * DB_TO_LN);
        const dc1 = driveComp(dv);
        const dw1 = dv / FILTER_DRIVE_MAX;
        const dgI = (dg1 - dg) * inv, dcI = (dc1 - dc) * inv, dwI = (dw1 - dw) * inv;
        for (let q = i0; q < end; q++) {
          dg += dgI; dc += dcI; dw += dwI;
          da[q] = 1 - dw; db[q] = dw * dc; dgain[q] = dg;
        }
        dg = dg1; dc = dc1; dw = dw1;
      }
    }

    /* --- audio --- */
    this.runChannel(l, n, 0, useDrive, useB, this.c1, this.c2, this.c3);
    if (useR) this.runChannel(r, n, 4, useDrive, useB, this.c1R, this.c2R, this.c3R);
    else this.runChannel(r, n, 4, useDrive, useB, this.c1, this.c2, this.c3);

    const s = this.state;
    // non-finite state (NaN input, …): clear it and zero what this block produced
    const sum = s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + s[7];
    if (sum - sum !== 0) {
      s.fill(0);
      for (let q = 0; q < n; q++) {
        if (l[q] - l[q] !== 0) l[q] = 0;
        if (r[q] - r[q] !== 0) r[q] = 0;
      }
    }
    // a decaying state on silent input ends in a denormal limit cycle (~10x slower math): flush it
    for (let q = 0; q < 8; q++) if (s[q] < TINY && s[q] > -TINY) s[q] = 0;

    this.lc = lc; this.rs = rs; this.dv = dv; this.mx = mx; this.fade = fade; this.sl = sl; this.sp = sp;
    this.cx = cx; this.cb = cb; this.cl = cl;
    this.g = g; this.gR = gR; this.k = k; this.m = m; this.dg = dg; this.dc = dc; this.dw = dw;
    this.lcPrev = lcT; this.rsPrev = resT;
    if (sl <= 0 && slT === 0) this.bLive = false;
    if (fade <= 0 && onT === 0) this.active = false; // the last samples were exactly dry: next block passes through
    return true;
  }

  /** one channel in place: drive ─► stage A ─► [stage B] ─► dry/wet; state at state[off … off+3] */
  private runChannel(buf: Float32Array, n: number, off: number, useDrive: boolean, useB: boolean, c1: Float64Array, c2: Float64Array, c3: Float64Array): void {
    const kb = this.kb, wx = this.wx, wl = this.wl, ws = this.ws, wm = this.wm;
    const da = this.da, db = this.db, dgain = this.dgain, s = this.state;
    let a1 = s[off], a2 = s[off + 1], b1 = s[off + 2], b2 = s[off + 3];
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const u = useDrive ? da[i] * x + db[i] * sat(dgain[i] * x) : x;
      const p1 = c1[i], p2 = c2[i], p3 = c3[i], pb = kb[i], px = wx[i], pl = wl[i];
      let v3 = u - a2;
      let v1 = p1 * a1 + p2 * v3;
      let v2 = a2 + p2 * a1 + p3 * v3;
      a1 = 2 * v1 - a1;
      a2 = 2 * v2 - a2;
      let y = px * u + pb * v1 + pl * v2;
      if (useB) {
        // second stage on the first stage's output, crossfaded in by the slope weight
        v3 = y - b2;
        v1 = p1 * b1 + p2 * v3;
        v2 = b2 + p2 * b1 + p3 * v3;
        b1 = 2 * v1 - b1;
        b2 = 2 * v2 - b2;
        y += ws[i] * (px * y + pb * v1 + pl * v2 - y);
      }
      buf[i] = x + wm[i] * (y - x);
    }
    s[off] = a1; s[off + 1] = a2; s[off + 2] = b1; s[off + 3] = b2;
  }

  /** TPT g of the cutoff e^lc, kept inside 20 Hz … fMax */
  private gAt(lc: number): number {
    let f = Math.exp(lc);
    f = f >= FILTER_F_MIN ? (f < this.fMax ? f : this.fMax) : FILTER_F_MIN;
    return Math.tan(this.piFs * f);
  }

  reset(): void {
    this.state.fill(0);
    this.env = 0;
  }
}
