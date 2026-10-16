import type { ParamStoreAPI } from '../core/types';
import { SPREAD_CLASSIC_DB } from '../shared/paramdefs/modules';
import { BAND_FREQS, NUM_BANDS, bandParamId, bandParamIdR, dbToGain, fbKnobFactor, resKnobShape, resKnobWeight, resToQ, resonanceMakeup } from '../shared/params';

/** which channel a picture shows (L/R per band): left, right, or both averaged */
export type ModelChannel = 0 | 1 | 'both';

/**
 * Visual approximation of the filterbank magnitude response: a sum of
 * 2-pole bandpasses weighted by band level and resonance makeup. Resonance sets Q and lifts the peak,
 * feedback narrows and lifts the peak, inverted feedback widens and lowers it. Not the DSP — just a good picture.
 */
export function bandQ(res: number, fb: number): number {
  return resToQ(res) * fbShape(fb);
}
/** how feedback reshapes a band (Q and peak alike): narrower and higher, or wider and lower when inverted */
function fbShape(fb: number): number {
  return fb >= 0 ? 1 + fb * 2.5 : 1 / (1 - fb * 1.15);
}

/**
 * Effective RES and feedback of band b in channel ch (0 = L, 1 = R), with the RESONANCE knob applied
 * as the DSP does it (CONFIG: knob mode, curve, bands). fb is signed (inverted feedback < 0) and
 * includes Feedback All of that channel.
 */
export function bandResFb(p: ParamStoreAPI, b: number, ch: 0 | 1 = 0): { res: number; fb: number } {
  const id = ch === 0 ? bandParamId : bandParamIdR;
  const knob = resKnobShape(p.get('resOffset'), Math.round(p.get('reso.curve')));
  const kb = knob * resKnobWeight(b, Math.round(p.get('reso.weight')));
  const fbMode = p.get('reso.knob') >= 0.5;
  const allOn = p.get(ch === 0 ? 'fbAllOn' : 'fbAllOnR') >= 0.5;
  const all = allOn ? p.get(ch === 0 ? 'fbAll' : 'fbAllR') * (fbMode ? fbKnobFactor(knob) : 1) : 0;
  const fb = p.get(id(b, 'fb')) * (fbMode ? fbKnobFactor(kb) : 1) + all;
  return { res: p.get(id(b, 'res')) + (fbMode ? 0 : kb), fb: Math.min(1, Math.max(-1, fb)) };
}

/** the larger feedback of the two channels (signed like bandResFb), for glows and LEDs */
export function bandFbMax(p: ParamStoreAPI, b: number): number {
  const l = bandResFb(p, b, 0).fb, r = bandResFb(p, b, 1).fb;
  return Math.abs(r) > Math.abs(l) ? r : l;
}

export interface ResponseModel {
  gains: Float64Array;
  qs: Float64Array;
  mix: number;
  out: number;
  bypass: boolean;
}

function bandModel(p: ParamStoreAPI, i: number, ch: 0 | 1): [number, number] {
  const { res: r, fb } = bandResFb(p, i, ch);
  const lift = fb >= 0 ? 1 + fb * 0.8 : fbShape(fb);
  return [dbToGain(p.get((ch === 0 ? bandParamId : bandParamIdR)(i, 'gain'))) * resonanceMakeup(resToQ(r)) * lift, bandQ(r, fb)];
}

/**
 * What SPREAD does to band i, as the DSP does it for an input that is the same in L and R:
 * [gain in L, gain in R, power factor for the L+R average], from the band's L and R levels gl, gr.
 * ODD/EVEN pans the band (equal power, so the average keeps its level); CLASSIC raises one channel
 * and lowers the other.
 */
function spreadGains(p: ParamStoreAPI, i: number, gl: number, gr: number): [number, number, number] {
  const s = Math.max(-1, Math.min(1, p.get('spread')));
  if (p.get('reso.spread') >= 0.5) {
    const c = Math.pow(10, (SPREAD_CLASSIC_DB * s) / 20);
    return [gl / c, gr * c, Math.sqrt(0.5 * (c * c + 1 / (c * c)))];
  }
  const a = Math.abs(s);
  const th = (Math.PI / 4) * (1 - a);
  const near = Math.SQRT2 * Math.cos(th);
  const far = Math.SQRT2 * Math.sin(th);
  // odd bands (1-based: index 0, 2 …) go left right of centre, even bands right; mirrored left of centre
  const toL = (i % 2 === 0) === s >= 0;
  const mid = 0.5 * (gl + gr);
  const side = 0.5 * (gl - gr) * (1 - a);
  return [Math.max(0, (toL ? near : far) * mid + side), Math.max(0, (toL ? far : near) * mid - side), 1];
}

/**
 * The response of one channel after SPREAD, or of both averaged ('both': levels and Q of L and R
 * averaged, SPREAD only as its change in power).
 */
export function readModel(p: ParamStoreAPI, m?: ResponseModel, ch: ModelChannel = 'both'): ResponseModel {
  const model: ResponseModel = m ?? { gains: new Float64Array(NUM_BANDS), qs: new Float64Array(NUM_BANDS), mix: 1, out: 1, bypass: false };
  for (let i = 0; i < NUM_BANDS; i++) {
    const [gl, ql] = bandModel(p, i, 0);
    const [gr, qr] = bandModel(p, i, 1);
    const [sl, sr, power] = spreadGains(p, i, gl, gr);
    if (ch === 'both') {
      model.gains[i] = 0.5 * (gl + gr) * power;
      model.qs[i] = 0.5 * (ql + qr);
    } else {
      model.gains[i] = ch === 0 ? sl : sr;
      model.qs[i] = ch === 0 ? ql : qr;
    }
  }
  model.mix = p.get('mix');
  model.out = dbToGain(p.get('outputGain'));
  model.bypass = p.get('bypass') >= 0.5;
  return model;
}

/** Magnitude (linear) at frequency f. */
export function responseAt(m: ResponseModel, f: number): number {
  if (m.bypass) return 1;
  let re = 0;
  let im = 0;
  for (let i = 0; i < NUM_BANDS; i++) {
    const fc = BAND_FREQS[i];
    const x = m.qs[i] * (f / fc - fc / f);
    // H = 1 / (1 + jx)  ->  (1 - jx) / (1 + x^2)
    const d = 1 + x * x;
    re += (m.gains[i] * 1) / d;
    im += (m.gains[i] * -x) / d;
  }
  const wetRe = re * m.mix + (1 - m.mix);
  const wetIm = im * m.mix;
  return Math.hypot(wetRe, wetIm) * m.out;
}
