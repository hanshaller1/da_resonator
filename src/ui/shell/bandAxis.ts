/**
 * Frequency axis shared by every band-related visualisation: the 10 band centres sit exactly
 * over the 10 fader columns (column k spans [k, k+1] · w/10, its centre at (k + 0.5) · w/10).
 * Between two band centres the axis is logarithmic; beyond the outer bands it continues with the
 * spacing of the outer pair (about 20 Hz at the left edge, 16 kHz at the right).
 */
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';

const LOGS = BAND_FREQS.map((f) => Math.log(f));
const LAST = NUM_BANDS - 1;

/** position in band units (band k centre = k + 0.5) */
function unitsOf(f: number): number {
  const lf = Math.log(Math.max(1e-3, f));
  if (lf <= LOGS[0]) return 0.5 - (LOGS[0] - lf) / (LOGS[1] - LOGS[0]);
  if (lf >= LOGS[LAST]) return LAST + 0.5 + (lf - LOGS[LAST]) / (LOGS[LAST] - LOGS[LAST - 1]);
  let k = 0;
  while (k < LAST - 1 && lf >= LOGS[k + 1]) k++;
  return k + 0.5 + (lf - LOGS[k]) / (LOGS[k + 1] - LOGS[k]);
}

function freqOfUnits(u: number): number {
  if (u <= 0.5) return Math.exp(LOGS[0] - (0.5 - u) * (LOGS[1] - LOGS[0]));
  if (u >= LAST + 0.5) return Math.exp(LOGS[LAST] + (u - LAST - 0.5) * (LOGS[LAST] - LOGS[LAST - 1]));
  const k = Math.min(LAST - 1, Math.floor(u - 0.5));
  const t = u - 0.5 - k;
  return Math.exp(LOGS[k] + t * (LOGS[k + 1] - LOGS[k]));
}

/** x (0..w) of frequency f */
export function xOfFreq(f: number, w: number): number {
  return (unitsOf(f) / NUM_BANDS) * w;
}

/** frequency at x (0..w) */
export function freqOfX(x: number, w: number): number {
  return freqOfUnits((x / w) * NUM_BANDS);
}

/** centre x of band column k */
export function colCenter(k: number, w: number): number {
  return ((k + 0.5) / NUM_BANDS) * w;
}

/** left edge x of band column k */
export function colLeft(k: number, w: number): number {
  return (k / NUM_BANDS) * w;
}

/** lowest / highest frequency on the axis */
export const AXIS_F_MIN = freqOfUnits(0);
export const AXIS_F_MAX = freqOfUnits(NUM_BANDS);

/** frequency grid lines worth labelling on this axis */
export const AXIS_GRID_F = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
