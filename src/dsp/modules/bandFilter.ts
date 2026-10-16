/**
 * Band filter (FILTER → BAND, docs/hardware-modi-und-pools-2026-10-16.md 1A, 3A): a filter curve read at the
 * centre of every band and added to that band's fader in dB, so a cutoff sweep walks audibly from band to band.
 * Pure functions, shared by the worklet and the FILTER picture.
 *
 *  Curve   : Butterworth magnitude of order n = SLOPE / 6 (continuous, so 6 … 48 dB/oct), −3 dB at the cutoff:
 *            LP |H|² = 1 / (1 + (f/fc)^2n), HP |H|² = 1 / (1 + (fc/f)^2n).
 *            BP = HP at fc·2^(−W/2) × LP at fc·2^(+W/2) (W = WIDTH in octaves), scaled to 0 dB at the cutoff;
 *            Notch |H|² = 1 − BP (so its centre always reaches the floor).
 *  Depth   : the curve never goes below −DEPTH; at the stop (60 dB) the floor is silence.
 *  Offset  : added on top: the level of the passband.
 *  Stereo  : R reads the curve at cutoff · 2^R OFS.
 */
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';

/** DEPTH at which the floor of the curve is silence */
export const BAND_FILTER_MUTE_DB = 60;
const TYPE_LP = 0;
const TYPE_BP = 1;
const TYPE_HP = 2;

/** power gain |H|² of the curve (no depth, no offset) at f */
export function bandFilterPower(type: number, cutoff: number, slope: number, width: number, f: number): number {
  const n2 = Math.max(6, slope) / 3; // 2n
  const x = f / Math.max(1, cutoff);
  if (type === TYPE_LP) return 1 / (1 + Math.pow(x, n2));
  if (type === TYPE_HP) return 1 / (1 + Math.pow(1 / x, n2));
  const e = Math.pow(2, Math.max(0, width) / 2);
  const bp = (y: number) => 1 / ((1 + Math.pow(1 / (e * y), n2)) * (1 + Math.pow(y / e, n2)));
  const p = bp(x) / bp(1);
  return type === TYPE_BP ? p : Math.max(0, 1 - p);
}

/** level the band filter gives a band at f (dB, −Infinity = silent) */
export function bandFilterDb(type: number, cutoff: number, slope: number, width: number, depth: number, offset: number, f: number): number {
  const p = bandFilterPower(type, cutoff, slope, width, f);
  const db = p > 1e-12 ? 10 * Math.log10(p) : -120;
  if (db <= -depth) return depth >= BAND_FILTER_MUTE_DB ? -Infinity : offset - depth;
  return db + offset;
}

/** the curve at every band centre for one channel (rOfs = octaves the cutoff moves, R OFS on R) */
export function bandFilterLevels(out: Float64Array | Float32Array, type: number, cutoff: number, slope: number, width: number, depth: number, offset: number, rOfs = 0): void {
  const fc = rOfs ? cutoff * Math.pow(2, rOfs) : cutoff;
  for (let b = 0; b < NUM_BANDS; b++) out[b] = bandFilterDb(type, fc, slope, width, depth, offset, BAND_FREQS[b]);
}
