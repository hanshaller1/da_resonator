import type { ParamStoreAPI } from '../core/types';
import { BAND_FREQS, NUM_BANDS, bandParamId, dbToGain, resToQ, resonanceMakeup } from '../shared/params';

/**
 * Visual approximation of the filterbank magnitude response: a sum of
 * 2-pole bandpasses weighted by band level and resonance makeup. Resonance sets Q and lifts the peak,
 * feedback narrows and lifts the peak. Not the DSP — just a good picture.
 */
export function bandQ(res: number, fb: number): number {
  return resToQ(res) * (1 + fb * 2.5);
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
  const resOff = p.get('resOffset');
  const fbAll = p.get('fbAllOn') >= 0.5 ? p.get('fbAll') : 0;
  for (let i = 0; i < NUM_BANDS; i++) {
    const fb = Math.min(1, p.get(bandParamId(i, 'fb')) + fbAll);
    const r = p.get(bandParamId(i, 'res')) + resOff;
    model.gains[i] = dbToGain(p.get(bandParamId(i, 'gain'))) * resonanceMakeup(resToQ(r)) * (1 + fb * 0.8);
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
