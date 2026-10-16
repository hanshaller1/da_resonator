import type { ParamStoreAPI } from '../core/types';
import { BAND_FREQS, NUM_BANDS, bandParamId, dbToGain, fbKnobFactor, resKnobShape, resKnobWeight, resToQ, resonanceMakeup } from '../shared/params';

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
 * Effective RES and feedback of band b, with the RESONANCE knob applied as the DSP does it
 * (CONFIG: knob mode, curve, bands). fb is signed (inverted feedback < 0) and includes Feedback All.
 */
export function bandResFb(p: ParamStoreAPI, b: number): { res: number; fb: number } {
  const knob = resKnobShape(p.get('resOffset'), Math.round(p.get('reso.curve')));
  const kb = knob * resKnobWeight(b, Math.round(p.get('reso.weight')));
  const fbMode = p.get('reso.knob') >= 0.5;
  const all = p.get('fbAllOn') >= 0.5 ? p.get('fbAll') * (fbMode ? fbKnobFactor(knob) : 1) : 0;
  const fb = p.get(bandParamId(b, 'fb')) * (fbMode ? fbKnobFactor(kb) : 1) + all;
  return { res: p.get(bandParamId(b, 'res')) + (fbMode ? 0 : kb), fb: Math.min(1, Math.max(-1, fb)) };
}

export interface ResponseModel {
  gains: Float64Array;
  qs: Float64Array;
  mix: number;
  out: number;
  bypass: boolean;
}

export function readModel(p: ParamStoreAPI, m?: ResponseModel): ResponseModel {
  const model: ResponseModel = m ?? { gains: new Float64Array(NUM_BANDS), qs: new Float64Array(NUM_BANDS), mix: 1, out: 1, bypass: false };
  for (let i = 0; i < NUM_BANDS; i++) {
    const { res: r, fb } = bandResFb(p, i);
    const lift = fb >= 0 ? 1 + fb * 0.8 : fbShape(fb);
    model.gains[i] = dbToGain(p.get(bandParamId(i, 'gain'))) * resonanceMakeup(resToQ(r)) * lift;
    model.qs[i] = bandQ(r, fb);
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
