/**
 * SPECTR band levels: input and output level per band column (power mean of the spectrum columns
 * under each fader), their difference, and a feedback warning per band when the output stands far
 * above the input (the resonance is running away or ringing on its own).
 */
import { NUM_BANDS } from '../../../shared/params';
import type { Palette } from '../../viz/draw';
import { monoFont } from '../../viz/draw';
import { colCenter, colLeft } from '../../shell/bandAxis';
import { SPEC_BOT } from '../../viz/spectrum';

/** smoothing of the band readouts */
const SMOOTH_MS = 250;
/** OUT − IN where the warning starts, and where it is at full strength */
export const WARN_FROM_DB = 12;
export const WARN_FULL_DB = 24;
/** the output must be at least this loud for a warning (no warnings on noise) */
const WARN_MIN_OUT = -60;
/** how long a warning takes to fade after the cause is gone */
const WARN_FADE_MS = 600;

export class BandLevels {
  readonly inDb = new Float32Array(NUM_BANDS).fill(SPEC_BOT);
  readonly outDb = new Float32Array(NUM_BANDS).fill(SPEC_BOT);
  /** 0…1 per band */
  readonly warn = new Float32Array(NUM_BANDS);
  private pIn = new Float64Array(NUM_BANDS);
  private pOut = new Float64Array(NUM_BANDS);
  private n = new Uint16Array(NUM_BANDS);

  clear(): void {
    this.inDb.fill(SPEC_BOT);
    this.outDb.fill(SPEC_BOT);
    this.warn.fill(0);
  }

  diff(k: number): number {
    return this.outDb[k] - this.inDb[k];
  }

  /** the loudest warning band, or −1 */
  worst(min = 0.5): number {
    let best = -1;
    for (let k = 0; k < NUM_BANDS; k++) if (this.warn[k] >= min && (best < 0 || this.warn[k] > this.warn[best])) best = k;
    return best;
  }

  /** take one frame of input / output columns (dB, `colPx` design px each, plot width `w`) */
  update(inCols: Float32Array, outCols: Float32Array, colPx: number, w: number, dt: number): void {
    this.pIn.fill(0);
    this.pOut.fill(0);
    this.n.fill(0);
    for (let i = 0; i < outCols.length; i++) {
      const x = (i + 0.5) * colPx;
      if (x >= w) break;
      const k = Math.min(NUM_BANDS - 1, Math.floor((x / w) * NUM_BANDS));
      this.pIn[k] += Math.pow(10, inCols[i] / 10);
      this.pOut[k] += Math.pow(10, outCols[i] / 10);
      this.n[k]++;
    }
    const a = 1 - Math.exp(-dt / SMOOTH_MS);
    const fade = dt / WARN_FADE_MS;
    for (let k = 0; k < NUM_BANDS; k++) {
      if (!this.n[k]) continue;
      const vi = Math.max(SPEC_BOT, 10 * Math.log10(this.pIn[k] / this.n[k] + 1e-30));
      const vo = Math.max(SPEC_BOT, 10 * Math.log10(this.pOut[k] / this.n[k] + 1e-30));
      this.inDb[k] += (vi - this.inDb[k]) * a;
      this.outDb[k] += (vo - this.outDb[k]) * a;
      const d = vo - vi;
      const target = vo >= WARN_MIN_OUT ? Math.max(0, Math.min(1, (d - WARN_FROM_DB) / (WARN_FULL_DB - WARN_FROM_DB))) : 0;
      this.warn[k] = Math.max(target, this.warn[k] - fade);
    }
  }

  /** feedback warning: the band column glows, with a bar along its top edge */
  drawWarn(g: CanvasRenderingContext2D, w: number, plotH: number, pal: Palette): void {
    for (let k = 0; k < NUM_BANDS; k++) {
      const v = this.warn[k];
      if (v <= 0.01) continue;
      const x0 = colLeft(k, w);
      const cw = colLeft(k + 1, w) - x0;
      g.save();
      g.globalAlpha = v;
      const grad = g.createLinearGradient(0, 0, 0, plotH);
      grad.addColorStop(0, pal.fbSoft);
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad;
      g.fillRect(x0, 0, cw, plotH);
      g.fillStyle = pal.fb;
      g.fillRect(x0 + 1, 0, cw - 2, 3);
      g.restore();
    }
  }

  /** height the readout chips take above the bottom of the spectrum area */
  static readonly CHIP_SPACE = 11 * 3 + 6 + 4;

  /** readout chips at the bottom of each band column: IN, OUT and OUT − IN */
  drawChips(g: CanvasRenderingContext2D, w: number, bottom: number, pal: Palette, labels: [string, string]): void {
    g.save();
    g.font = monoFont(pal, 9);
    g.textBaseline = 'top';
    const rowH = 11;
    const ch = rowH * 3 + 6;
    const y = bottom - ch - 4;
    if (y < 20) {
      g.restore();
      return;
    }
    const lw = Math.max(g.measureText(labels[0]).width, g.measureText(labels[1]).width) + 4;
    for (let k = 0; k < NUM_BANDS; k++) {
      const cx = colCenter(k, w);
      const cw = Math.min(colLeft(k + 1, w) - colLeft(k, w) - 8, lw + 32);
      const x = cx - cw / 2;
      g.globalAlpha = 0.85;
      g.fillStyle = pal.panel;
      g.beginPath();
      g.roundRect(x, y, cw, ch, 3);
      g.fill();
      g.globalAlpha = 1;
      const silent = (db: number) => db <= SPEC_BOT + 1;
      const val = (db: number) => (silent(db) ? '–' : db.toFixed(0));
      const row = (i: number, label: string, text: string, color: string) => {
        g.textAlign = 'left';
        g.fillStyle = pal.text4;
        g.fillText(label, x + 4, y + 3 + i * rowH);
        g.textAlign = 'right';
        g.fillStyle = color;
        g.fillText(text, x + cw - 4, y + 3 + i * rowH);
      };
      row(0, labels[0], val(this.inDb[k]), pal.text3);
      row(1, labels[1], val(this.outDb[k]), pal.accent);
      const d = this.diff(k);
      const dTxt = silent(this.inDb[k]) && silent(this.outDb[k]) ? '–' : `${d >= 0 ? '+' : ''}${d.toFixed(0)}`;
      row(2, 'Δ', dTxt, this.warn[k] > 0.5 ? pal.fb : pal.text);
    }
    g.restore();
  }
}
