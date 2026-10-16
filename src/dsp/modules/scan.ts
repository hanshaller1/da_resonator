/**
 * Band scanner (CLK MOD → SCAN, docs/hardware-modi-und-pools-2026-10-16.md 1A, 3A–6C): on every step a value
 * is sampled and written into the next band; a band holds its value until the scan comes round again.
 * The value lowers the band on top of its fader:
 *   layer dB = OFFSET − DEPTH · (1 − u),   u = sampled value 0..1 (1 = the band sits at OFFSET).
 *
 *  Steps   : RATE (scan.sync 0) runs free at 0.1 … 160 steps / s (≈ 10 000 BPM in 1/16); INT or MIDI
 *            (scan.sync 1, scan.clk) step on that clock's grid with DIV, derived from its beat position like
 *            the clock mods (block-granular).
 *  Source  : the scanner's own LFO (SHAPE, LFO rate), read at the moment of the step, or a mod source
 *            (LFO 1–4, env followers, clock mods, macros) with its value of this block. A source that
 *            swings −1..1 maps to 0..1.
 *  Order   : DIR up / down / ping-pong / random over the bands that are not locked; a locked band keeps
 *            its fader level (layer 0 dB) and the scan steps past it.
 *  Stereo  : R follows L by R DLY steps (band and value of that step); R INV writes 1 − u into R.
 *  Glide   : the worklet glides the band gains with its fast smoothing (3 ms) while the scanner runs.
 */
import { NUM_BANDS } from '../../shared/bands';
import { DIVISIONS } from '../../shared/paramdefs/types';
import { SCAN_RDLY_MAX, SCAN_SOURCE_IDS } from '../../shared/paramdefs/modules';
import { PARAM_BY_ID, paramIndex } from '../../shared/params';
import { SOURCE_BY_ID } from '../../shared/mod/sources';
import type { BlockCtx } from './types';

const NB = NUM_BANDS;
const NS = NB * 2;
/* SCAN_SHAPES order */
const SHAPE_SINE = 0;
const SHAPE_SQUARE = 1;
const SHAPE_TRIANGLE = 2;
const SHAPE_SAW = 3;
/* SCAN_DIRS order */
const DIR_UP = 0;
const DIR_DOWN = 1;
const DIR_PINGPONG = 2;
/** safety cap for steps in one block (normally at most 1) */
const MAX_STEPS_PER_BLOCK = 16;
const HIST = SCAN_RDLY_MAX + 1;

export class BandScanner {
  /** layer per slot (band·2 + channel) in dB, 0 while off or locked */
  readonly layerDb = new Float64Array(NS);
  /** sampled value per slot 0..1 */
  readonly u = new Float64Array(NS).fill(1);
  /** band of the last step on L / R (−1 = none yet), for the picture */
  lastL = -1;
  lastR = -1;
  /** true while on */
  on = false;

  private iOn = paramIndex('scan.on');
  private iSrc = paramIndex('scan.src');
  private iShape = paramIndex('scan.shape');
  private iLfo = paramIndex('scan.lfo');
  private iSync = paramIndex('scan.sync');
  private iRate = paramIndex('scan.rate');
  private iDiv = paramIndex('scan.div');
  private iDir = paramIndex('scan.dir');
  private iDepth = paramIndex('scan.depth');
  private iOffset = paramIndex('scan.offset');
  private iRdly = paramIndex('scan.rdly');
  private iRinv = paramIndex('scan.rinv');
  private iLock = Array.from({ length: NB }, (_, b) => paramIndex(`scan.lock${b}`));
  /** source value index and polarity switch (`uni` param, −1 = fixed polarity) of each SCAN_SOURCES entry */
  private srcIdx = SCAN_SOURCE_IDS.map((id) => (id ? SOURCE_BY_ID[id].index : -1));
  private srcUni = SCAN_SOURCE_IDS.map((id) => (id ? PARAM_BY_ID[`${id}.uni`]?.index ?? -1 : -1));
  private srcBip = SCAN_SOURCE_IDS.map((id) => (id ? SOURCE_BY_ID[id].bipolar : true));

  /** free running: steps since the start (integer part = steps done) */
  private acc = 0;
  /** synced: clock position after the last update (a mismatch = skipped blocks or a clock reset) */
  private lastBeats = NaN;
  /** a step is due at once (switched on, clock reset) */
  private restart = true;
  /** band written last on L (−1 / NB = before the first) and the ping-pong direction */
  private pos = -1;
  private ppDir = 1;
  /** last steps (band, value) for R DLY, newest at hHead */
  private hBand = new Int32Array(HIST).fill(-1);
  private hVal = new Float64Array(HIST);
  private hHead = 0;
  private hCount = 0;
  /** own LFO: phase in cycles, random value of the current cycle */
  private lfoPh = 0;
  private lfoSeg = 0;
  private lfoRnd = 0;
  private rng = 0x3c6ef372;

  private rand(): number {
    let s = this.rng;
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    this.rng = s;
    return s / 4294967296;
  }

  /** own LFO at phase x (cycles), bipolar */
  private lfoAt(shape: number, x: number): number {
    const seg = Math.floor(x);
    const p = x - seg;
    if (shape === SHAPE_SINE) return Math.sin(2 * Math.PI * p);
    if (shape === SHAPE_SQUARE) return p < 0.5 ? 1 : -1;
    if (shape === SHAPE_TRIANGLE) return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    if (shape === SHAPE_SAW) return 2 * p - 1;
    // random: a new value every LFO cycle
    if (seg !== this.lfoSeg) {
      this.lfoSeg = seg;
      this.lfoRnd = this.rand() * 2 - 1;
    }
    return this.lfoRnd;
  }

  /** the next band to write after `pos` (locked bands skipped); −1 if all are locked */
  private next(pos: number, dir: number, lock: (b: number) => boolean): number {
    if (dir === DIR_UP || dir === DIR_DOWN) {
      const d = dir === DIR_UP ? 1 : -1;
      const from = pos < 0 || pos >= NB ? (d > 0 ? -1 : NB) : pos;
      for (let k = 1; k <= NB; k++) {
        const b = (((from + d * k) % NB) + NB) % NB;
        if (!lock(b)) return b;
      }
      return -1;
    }
    if (dir === DIR_PINGPONG) {
      for (let turn = 0; turn < 2; turn++) {
        for (let b = pos + this.ppDir; b >= 0 && b < NB; b += this.ppDir) if (!lock(b)) return b;
        this.ppDir = -this.ppDir;
      }
      return pos >= 0 && pos < NB && !lock(pos) ? pos : -1;
    }
    // random: any open band but the current one
    let open = 0;
    for (let b = 0; b < NB; b++) if (!lock(b)) open++;
    if (open === 0) return -1;
    const cur = pos >= 0 && pos < NB && !lock(pos);
    if (open === 1) return cur ? pos : this.next(-1, DIR_UP, lock);
    let k = Math.floor(this.rand() * (cur ? open - 1 : open));
    for (let b = 0; b < NB; b++) {
      if (lock(b) || (cur && b === pos)) continue;
      if (k-- === 0) return b;
    }
    return -1;
  }

  /** once per block after the modulation graph; ctx.clock is the clock the scanner follows */
  update(ctx: BlockCtx, srcVals: Float32Array): void {
    const e = ctx.eff;
    const on = e[this.iOn] >= 0.5;
    if (!on) {
      if (this.on) {
        this.on = false;
        this.layerDb.fill(0);
        this.lastL = this.lastR = -1;
      }
      return;
    }
    if (!this.on) {
      // switched on: every band starts at OFFSET, the first step comes at once
      this.on = true;
      this.u.fill(1);
      this.reset();
    }
    const lock = (b: number) => e[this.iLock[b]] >= 0.5;
    const dir = Math.round(e[this.iDir]);
    const shape = Math.round(e[this.iShape]);
    const src = Math.max(0, Math.min(SCAN_SOURCE_IDS.length - 1, Math.round(e[this.iSrc])));
    const lfoRate = e[this.iLfo];
    const ph0 = this.lfoPh;
    this.lfoPh += lfoRate * ctx.dt;
    if (this.lfoPh > 1e6) this.lfoPh -= Math.floor(this.lfoPh);

    // step times in this block (0..1 of the block)
    const fr: number[] = [];
    const c = ctx.clock;
    if (e[this.iSync] >= 0.5) {
      const D = DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, Math.round(e[this.iDiv])))].beats;
      if (c.beatsPrev !== this.lastBeats) this.restart = true; // first block, back from off, clock reset
      this.lastBeats = c.beats;
      // steps on the grid of DIV; a restart steps at once, the next one comes on the grid
      if (this.restart) fr.push(0);
      else {
        const x0 = c.beatsPrev / D;
        const x1 = c.beats / D;
        const span = x1 - x0;
        for (let k = Math.floor(x0) + 1; k <= Math.floor(x1) && fr.length < MAX_STEPS_PER_BLOCK; k++) fr.push(span > 0 ? (k - x0) / span : 1);
      }
    } else {
      const rate = e[this.iRate];
      const a0 = this.acc;
      const a1 = a0 + rate * ctx.dt;
      if (this.restart) fr.push(0);
      for (let k = Math.floor(a0) + 1; k <= Math.floor(a1) && fr.length < MAX_STEPS_PER_BLOCK; k++) fr.push((k - a0) / (a1 - a0));
      this.acc = a1 - Math.floor(a1);
    }
    this.restart = false;

    for (const f of fr) {
      let v: number;
      let bip: boolean;
      if (src === 0) {
        v = this.lfoAt(shape, ph0 + lfoRate * ctx.dt * f);
        bip = true;
      } else {
        v = srcVals[this.srcIdx[src]];
        const ui = this.srcUni[src];
        bip = ui >= 0 ? e[ui] < 0.5 : this.srcBip[src];
      }
      let uv = bip ? 0.5 + 0.5 * v : v;
      uv = uv > 1 ? 1 : uv < 0 ? 0 : uv === uv ? uv : 0;
      const b = this.next(this.pos, dir, lock);
      if (b < 0) break;
      this.pos = b;
      this.u[b * 2] = uv;
      this.lastL = b;
      this.hHead = (this.hHead + 1) % HIST;
      this.hBand[this.hHead] = b;
      this.hVal[this.hHead] = uv;
      if (this.hCount < HIST) this.hCount++;
      // R: the step R DLY back (nothing yet while the scan is younger than that)
      const d = Math.max(0, Math.min(SCAN_RDLY_MAX, Math.round(e[this.iRdly])));
      if (d < this.hCount) {
        const h = (this.hHead - d + HIST) % HIST;
        const rv = this.hVal[h];
        this.u[this.hBand[h] * 2 + 1] = e[this.iRinv] >= 0.5 ? 1 - rv : rv;
        this.lastR = this.hBand[h];
      }
    }

    // a band not written yet sits at OFFSET (u = 1)
    const depth = e[this.iDepth];
    const off = e[this.iOffset];
    const ly = this.layerDb, u = this.u;
    for (let i = 0; i < NS; i++) ly[i] = lock(i >> 1) ? 0 : off - depth * (1 - u[i]);
  }

  /** clock reset / MIDI Start / switched on: the scan starts over at the first band */
  reset(): void {
    this.acc = 0;
    this.lastBeats = NaN;
    this.restart = true;
    this.pos = -1;
    this.ppDir = 1;
    this.hCount = 0;
    this.hHead = 0;
    this.lfoPh = 0;
    this.lfoSeg = 0;
    this.rng = 0x3c6ef372;
    this.lfoRnd = this.rand() * 2 - 1;
  }
}
