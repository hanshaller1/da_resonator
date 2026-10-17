/**
 * L/R per band (docs/lr-pro-band-2026-10-16.md): which channel the faders, the band RES / FB knobs
 * and Feedback All edit, and the commands of the channel switch. The choice is a view setting: it
 * is never stored with the sound and starts at L+R.
 * Every param with an R twin (shared/params.ts) follows it: L edits the historic id, R its twin,
 * L+R moves both by the same travel so an offset between them stays.
 */
import { Emitter } from '../core/Emitter';
import type { ParamStoreAPI, RouteChannel, Unsubscribe } from '../core/types';
import { NUM_BANDS, PARAMS, bandParamId, bandParamIdR, faderDbToNorm, faderNormToDb, twinId, type BandParamKey } from '../shared/params';

export type ChannelSel = 'L' | 'LR' | 'R';

let sel: ChannelSel = 'LR';
const changed = new Emitter<[ChannelSel]>();

export const channelSel = {
  get(): ChannelSel {
    return sel;
  },
  set(v: ChannelSel): void {
    if (v === sel) return;
    sel = v;
    changed.emit(v);
  },
  onChange(cb: (v: ChannelSel) => void): Unsubscribe {
    return changed.on(cb);
  },
};

/** channel of a new route onto `target`: the switch on an L/R pair, L+R anywhere else */
export function newRouteChannel(target: string): RouteChannel {
  return twinId(target) ? sel : 'LR';
}

/** L+R: both channels move by the same travel `delta` from where the gesture started; each stops at its end */
export function moveLinked(l0: number, r0: number, delta: number): [number, number] {
  const c = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  return [c(l0 + delta), c(r0 + delta)];
}

/** [L id, R id] of every param with an R twin */
export const STEREO_PAIRS: readonly (readonly [string, string])[] = PARAMS.filter((p) => p.twin !== undefined).map((p) => [p.id, PARAMS[p.twin!].id] as const);

function setGrouped(p: ParamStoreAPI, edits: [string, number][]): void {
  for (const [id] of edits) p.beginGesture(id);
  for (const [id, v] of edits) p.set(id, v);
  for (const [id] of edits) p.endGesture(id);
}

/** R = L: every R value takes the value of its L param (levels, RES, FB, Feedback All) */
export function copyLtoR(p: ParamStoreAPI): void {
  setGrouped(
    p,
    STEREO_PAIRS.map(([l, r]) => [r, p.get(l)]),
  );
}

/** one band value of all 10 bands back to its default, in L and R (faders: 0 dB, RES: broad, FB: 0) */
export function resetBands(p: ParamStoreAPI, key: BandParamKey): void {
  const edits: [string, number][] = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    edits.push([bandParamId(b, key), p.spec(bandParamId(b, key)).def]);
    edits.push([bandParamIdR(b, key), p.spec(bandParamIdR(b, key)).def]);
  }
  setGrouped(p, edits);
}

/** default DICE range (CONFIG → GENERAL, Resonance card): −24 to +6 dB, so no band falls silent and none jumps to +12 */
export const DICE_MIN_DB = -24;
export const DICE_MAX_DB = 6;

/**
 * DICE (FB tab; hardware: SHIFT + encoder in FB mode): every band level to a random fader position,
 * evenly spread over the fader travel between minDb and maxDb, in the channel(s) of the switch
 * (L+R: the same value in both).
 */
export function rollLevels(p: ParamStoreAPI, ch: ChannelSel = sel, rnd: () => number = Math.random, minDb = DICE_MIN_DB, maxDb = DICE_MAX_DB): void {
  const lo = faderDbToNorm(minDb);
  const hi = faderDbToNorm(maxDb);
  const edits: [string, number][] = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    const db = Math.round(faderNormToDb(lo + rnd() * (hi - lo)) * 10) / 10;
    if (ch !== 'R') edits.push([bandParamId(b, 'gain'), db]);
    if (ch !== 'L') edits.push([bandParamIdR(b, 'gain'), db]);
  }
  setGrouped(p, edits);
}

/** do L and R of this pair differ? (a hair of travel apart counts as equal) */
export function pairDiffers(p: ParamStoreAPI, id: string): boolean {
  const r = twinId(id);
  return !!r && Math.abs(p.getNorm(id) - p.getNorm(r)) > 1e-4;
}
