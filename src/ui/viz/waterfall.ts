/**
 * Waterfall (spectrogram) of one trace: every few milliseconds one row of spectrum columns, the
 * newest on top, older ones scrolling down. Kept in an offscreen canvas one pixel per column and
 * row, scaled to the drawing area. Colours run from the well colour through grey to the accent.
 */
import type { Palette } from './draw';
import { SPEC_BOT, SPEC_TOP } from './spectrum';

/** rows kept (history length = ROWS · ROW_MS) */
const ROWS = 160;
/** time per row */
const ROW_MS = 40;
/** level shown as the darkest colour (dBFS) */
const FLOOR_DB = SPEC_BOT + 12;

export class Waterfall {
  private cv = document.createElement('canvas');
  private g = this.cv.getContext('2d')!;
  private row: ImageData | null = null;
  private lut = new Uint8ClampedArray(256 * 4);
  private lutFor: Palette | null = null;
  private acc = 0;

  /** history in seconds */
  static readonly SECONDS = (ROWS * ROW_MS) / 1000;

  resize(cols: number): void {
    this.cv.width = Math.max(1, cols);
    this.cv.height = ROWS;
    this.row = this.g.createImageData(this.cv.width, 1);
    this.clear();
  }

  clear(): void {
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
    this.acc = 0;
  }

  /** add rows for `dt` ms of the trace `vals` (dB per column) */
  push(vals: Float32Array, dt: number, pal: Palette): void {
    if (!this.row) return;
    if (this.lutFor !== pal) this.buildLut(pal);
    this.acc += dt;
    let n = Math.floor(this.acc / ROW_MS);
    if (!n) return;
    this.acc -= n * ROW_MS;
    n = Math.min(n, ROWS);
    const d = this.row.data;
    const span = SPEC_TOP - FLOOR_DB;
    for (let i = 0; i < this.cv.width; i++) {
      const v = vals[i] ?? SPEC_BOT;
      const t = Math.max(0, Math.min(255, Math.round(((v - FLOOR_DB) / span) * 255)));
      d[i * 4] = this.lut[t * 4];
      d[i * 4 + 1] = this.lut[t * 4 + 1];
      d[i * 4 + 2] = this.lut[t * 4 + 2];
      d[i * 4 + 3] = this.lut[t * 4 + 3];
    }
    // scroll down by n rows ('copy': no blending with the old picture)
    this.g.globalCompositeOperation = 'copy';
    this.g.drawImage(this.cv, 0, n);
    this.g.globalCompositeOperation = 'source-over';
    for (let r = 0; r < n; r++) this.g.putImageData(this.row, 0, r);
  }

  /** draw the history at y top…top+h, `colPx` design px per column */
  draw(g: CanvasRenderingContext2D, colPx: number, top: number, h: number): void {
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.cv, 0, 0, this.cv.width, ROWS, 0, top, this.cv.width * colPx, h);
    g.restore();
  }

  private buildLut(pal: Palette): void {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 1;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, pal.well || '#000');
    grad.addColorStop(0.4, pal.text4 || '#555');
    grad.addColorStop(0.75, pal.accent || '#fa0');
    grad.addColorStop(1, pal.text || '#fff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 1);
    this.lut.set(g.getImageData(0, 0, 256, 1).data);
    this.lutFor = pal;
  }
}
