/**
 * SPECTR peak marks: the loudest distinct peaks of a trace, with frequency, note name and cents
 * (for tuning the resonances).
 */
import type { Palette } from '../../viz/draw';
import { formatHz, monoFont } from '../../viz/draw';
import { SPEC_BOT } from '../../viz/spectrum';

export interface Peak {
  /** fractional column of the peak */
  col: number;
  f: number;
  db: number;
}

/** how many peaks are marked */
export const MAX_PEAKS = 3;
/** a peak must stand this far above its surroundings (dB) */
const PROMINENCE = 6;
/** surroundings for the prominence check, and the least distance between two marks (columns) */
const NEAR = 10;
/** quietest peak worth marking */
const MIN_DB = SPEC_BOT + 24;

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** note name with cents, A4 = 440 Hz, e.g. "A4 +3¢" */
export function noteName(f: number): string {
  const m = 69 + 12 * Math.log2(f / 440);
  const n = Math.round(m);
  const cents = Math.round((m - n) * 100);
  const name = `${NOTES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
  return cents === 0 ? name : `${name} ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`;
}

/**
 * The loudest local maxima of `vals` that stand at least PROMINENCE dB above the lowest point
 * within NEAR columns on both sides. `freqAt(i)` gives the left edge frequency of column i.
 */
export function findPeaks(vals: Float32Array, freqAt: (i: number) => number, max = MAX_PEAKS): Peak[] {
  const n = vals.length;
  const cand: Peak[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = vals[i];
    if (v < MIN_DB || v < vals[i - 1] || v <= vals[i + 1]) continue;
    let loL = v;
    let loR = v;
    let top = true;
    for (let j = Math.max(0, i - NEAR); j < i; j++) {
      loL = Math.min(loL, vals[j]);
      if (vals[j] > v) top = false;
    }
    for (let j = i + 1; j <= Math.min(n - 1, i + NEAR); j++) {
      loR = Math.min(loR, vals[j]);
      if (vals[j] > v) top = false;
    }
    // edges of the plot count as surroundings that are low enough
    if (i - NEAR < 0) loL = Math.min(loL, SPEC_BOT);
    if (i + NEAR > n - 1) loR = Math.min(loR, SPEC_BOT);
    if (!top || v - Math.max(loL, loR) < PROMINENCE) continue;
    // parabolic refinement between the neighbours
    const a = vals[i - 1];
    const c = vals[i + 1];
    const den = a - 2 * v + c;
    const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const col = i + off;
    // column centre frequency, log-interpolated
    const k = Math.floor(col + 0.5);
    const t = col + 0.5 - k;
    const f = Math.exp(Math.log(freqAt(k)) * (1 - t) + Math.log(freqAt(k + 1)) * t);
    cand.push({ col, f, db: v - 0.25 * (a - c) * off });
  }
  cand.sort((p, q) => q.db - p.db);
  const out: Peak[] = [];
  for (const p of cand) {
    if (out.some((q) => Math.abs(q.col - p.col) < NEAR)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/** a small triangle at each peak and a label with frequency and note (kept below `top`) */
export function drawPeaks(g: CanvasRenderingContext2D, peaks: Peak[], colPx: number, w: number, yOf: (db: number) => number, top: number, pal: Palette): void {
  g.save();
  g.font = monoFont(pal, 9);
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  for (const p of peaks) {
    const x = Math.min(w - 4, Math.max(4, (p.col + 0.5) * colPx));
    const py = yOf(p.db);
    // label above the peak, or below it when the peak is too close to the top (legend line)
    const above = py - 4 - 32 >= top;
    const y = above ? py - 4 : py + 4;
    const s = above ? -1 : 1;
    g.fillStyle = pal.accent;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 4, y + 6 * s);
    g.lineTo(x + 4, y + 6 * s);
    g.closePath();
    g.fill();
    const lines = [`${formatHz(p.f)} Hz`, noteName(p.f)];
    const bw = Math.max(...lines.map((t) => g.measureText(t).width)) + 8;
    const lx = Math.min(w - bw / 2 - 2, Math.max(bw / 2 + 2, x));
    const by = above ? y - 32 : Math.max(top, y + 8);
    g.globalAlpha = 0.85;
    g.fillStyle = pal.panel;
    g.beginPath();
    g.roundRect(lx - bw / 2, by, bw, 24, 3);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = pal.text;
    g.fillText(lines[0], lx, by + 12);
    g.fillStyle = pal.text3;
    g.fillText(lines[1], lx, by + 23);
  }
  g.restore();
}
