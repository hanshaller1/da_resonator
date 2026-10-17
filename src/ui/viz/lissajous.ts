/**
 * Lissajous figure (X/Y scope) of two signals for the SPECTR tab: trace A on the X axis, trace B
 * on the Y axis, read from the time-domain data of two analysers. Equal signals draw the rising
 * diagonal, opposite ones the falling one, unrelated ones a cloud. The scale follows the louder
 * signal (fast up, slow down), so quiet material still fills the square. Without analysers
 * (mock engine) it draws a figure from the level meters.
 */
import type { Palette } from './draw';
import { monoFont } from './draw';

/** samples drawn per frame (≈ 43 ms at 48 kHz) */
const N = 2048;
/** quietest peak the scale goes up to (−50 dBFS), so silence stays a dot */
const FLOOR = 0.003;
/** release of the scale per second (attack is instant) */
const RELEASE = 0.25;

export class Lissajous {
  private a = new Float32Array(N);
  private b = new Float32Array(N);
  private buf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private env = FLOOR;
  private phase = 0;
  private has = false;

  /** forget the picture */
  clear(): void {
    this.a.fill(0);
    this.b.fill(0);
    this.env = FLOOR;
    this.has = false;
  }

  /** read the newest samples of both analysers */
  read(aNode: AnalyserNode, bNode: AnalyserNode, dt: number): void {
    this.take(aNode, this.a);
    this.take(bNode, this.b);
    this.follow(dt);
    this.has = true;
  }

  /** mock engine: two related tones whose size follows the levels (0..1) of A and B */
  synth(levelA: number, levelB: number, dt: number): void {
    this.phase += dt / 1000;
    const drift = 0.35 * Math.sin(this.phase * 0.7);
    for (let i = 0; i < N; i++) {
      const t = this.phase * 2 * Math.PI + (i / N) * 2 * Math.PI * 3;
      this.a[i] = levelA * (0.8 * Math.sin(t) + 0.2 * Math.sin(3 * t + 1));
      this.b[i] = levelB * (0.8 * Math.sin(t + 0.6 + drift) + 0.2 * Math.sin(2 * t));
    }
    this.follow(dt);
    this.has = true;
  }

  private take(node: AnalyserNode, out: Float32Array): void {
    if (this.buf.length !== node.fftSize) this.buf = new Float32Array(node.fftSize);
    node.getFloatTimeDomainData(this.buf);
    out.set(this.buf.subarray(Math.max(0, this.buf.length - N)));
  }

  private follow(dt: number): void {
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(this.a[i]), Math.abs(this.b[i]));
    const rel = Math.pow(RELEASE, dt / 1000);
    this.env = Math.max(FLOOR, peak, this.env * rel);
  }

  /** draw into the square at (x, y) with side `size`; labels name the axes */
  draw(g: CanvasRenderingContext2D, x: number, y: number, size: number, pal: Palette, labelA: string, labelB: string): void {
    const half = size / 2;
    const cx = x + half, cy = y + half;
    g.save();
    // frame and axes
    g.fillStyle = pal.panel;
    g.globalAlpha = 0.94;
    g.beginPath();
    g.roundRect(x, y, size, size, 4);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = pal.lineStrong;
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = pal.grid;
    g.beginPath();
    g.moveTo(Math.round(cx) + 0.5, y + 4);
    g.lineTo(Math.round(cx) + 0.5, y + size - 4);
    g.moveTo(x + 4, Math.round(cy) + 0.5);
    g.lineTo(x + size - 4, Math.round(cy) + 0.5);
    g.stroke();
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(x + 6, y + size - 6);
    g.lineTo(x + size - 6, y + 6);
    g.moveTo(x + 6, y + 6);
    g.lineTo(x + size - 6, y + size - 6);
    g.stroke();
    g.setLineDash([]);

    // the figure
    if (this.has) {
      const k = ((half - 8) * 0.95) / this.env;
      g.beginPath();
      g.rect(x + 1, y + 1, size - 2, size - 2);
      g.clip();
      g.strokeStyle = pal.accent;
      g.globalAlpha = 0.75;
      g.lineWidth = 1;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(cx + this.a[0] * k, cy - this.b[0] * k);
      for (let i = 1; i < N; i++) g.lineTo(cx + this.a[i] * k, cy - this.b[i] * k);
      g.stroke();
      g.globalAlpha = 1;
    }

    // axis names and scale
    g.font = monoFont(pal, 9);
    g.fillStyle = pal.text3;
    g.textBaseline = 'bottom';
    g.textAlign = 'right';
    g.fillText(`X ${labelA}`, x + size - 6, y + size - 4);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(`Y ${labelB}`, x + 6, y + 5);
    g.textAlign = 'right';
    g.fillStyle = pal.text4;
    g.fillText(this.has ? `${(20 * Math.log10(this.env)).toFixed(0)} dB` : '', x + size - 6, y + 5);
    g.restore();
  }
}
