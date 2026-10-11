/**
 * Drawing helpers shared by the tab visualisations: theme colours, the band column grid
 * (columns line up with the faders), spectrum fills and small labels. All in design px.
 */
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';
import { colCenter, colLeft, xOfFreq } from '../shell/bandAxis';
import { readVars } from '../shell/canvas';

export const PALETTE_VARS = {
  accent: '--c-accent',
  accentSoft: '--c-accent-soft',
  accentGlow: '--c-accent-glow',
  fb: '--c-fb',
  fbSoft: '--c-fb-soft',
  mod: '--c-mod',
  modSoft: '--c-mod-soft',
  ok: '--c-ok',
  grid: '--c-spec-grid',
  line: '--c-line',
  lineStrong: '--c-line-strong',
  text: '--c-text',
  text2: '--c-text-2',
  text3: '--c-text-3',
  text4: '--c-text-4',
  specIn: '--c-spec-in',
  specOut: '--c-spec-out',
  well: '--c-well',
  panel: '--c-panel',
  panel2: '--c-panel-2',
  filterPre: '--c-filter-pre',
  filterPost: '--c-filter-post',
  fontMono: '--font-mono',
} as const;

export type Palette = Record<keyof typeof PALETTE_VARS, string>;

export function readPalette(el: Element): Palette {
  const p = readVars(el, PALETTE_VARS);
  if (!p.filterPre) p.filterPre = p.text3;
  if (!p.filterPost) p.filterPost = p.text2;
  return p;
}

export function monoFont(pal: Palette, px = 9, weight = 500): string {
  return `${weight} ${px}px ${pal.fontMono || 'monospace'}`;
}

/**
 * Column grid: a hairline between band columns, a faint dotted line at each band centre and
 * (optionally) the band frequency at the bottom of each column.
 */
export function drawBandGrid(ctx: CanvasRenderingContext2D, w: number, h: number, pal: Palette, opts: { labels?: boolean; centres?: boolean } = {}): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.grid;
  ctx.beginPath();
  for (let k = 1; k < NUM_BANDS; k++) {
    const x = Math.round(colLeft(k, w)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  if (opts.centres !== false) {
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (let k = 0; k < NUM_BANDS; k++) {
      const x = Math.round(colCenter(k, w)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.labels !== false) {
    ctx.font = monoFont(pal, 9);
    ctx.fillStyle = pal.text4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let k = 0; k < NUM_BANDS; k++) ctx.fillText(formatHz(BAND_FREQS[k]), colCenter(k, w), h - 3);
  }
  ctx.restore();
}

/** horizontal dB lines with labels at the right edge */
export function drawDbGrid(ctx: CanvasRenderingContext2D, w: number, pal: Palette, dbs: number[], yOf: (db: number) => number, unit = ''): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.grid;
  ctx.beginPath();
  for (const db of dbs) {
    const y = Math.round(yOf(db)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.font = monoFont(pal, 9);
  ctx.fillStyle = pal.text4;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  for (const db of dbs) ctx.fillText(`${db > 0 ? '+' : ''}${db}${unit}`, w - 5, yOf(db) - 2);
  ctx.restore();
}

/** filled spectrum trace (gradient to transparent), optional thin edge */
export function fillTrace(ctx: CanvasRenderingContext2D, vals: Float32Array, colPx: number, w: number, h: number, yOf: (v: number) => number, fill: string, edge: string | null, edgeAlpha = 0.35): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < vals.length; i++) ctx.lineTo(Math.min(w, i * colPx), Math.max(0, yOf(vals[i])));
  ctx.lineTo(w, h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, fill);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fill();
  if (edge) {
    ctx.globalAlpha = edgeAlpha;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const x = Math.min(w, i * colPx);
      const y = Math.max(0, yOf(vals[i]));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** a line through one value per column */
export function strokeTrace(ctx: CanvasRenderingContext2D, vals: Float32Array, colPx: number, w: number, yOf: (v: number) => number, color: string, width = 1.5, clip?: [number, number]): Path2D {
  const path = new Path2D();
  for (let i = 0; i < vals.length; i++) {
    let y = yOf(vals[i]);
    if (clip) y = Math.min(clip[1], Math.max(clip[0], y));
    if (i === 0) path.moveTo(0, y);
    else path.lineTo(Math.min(w, i * colPx), y);
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
  return path;
}

/** "AUDIO OFF" style note in the top-left corner */
export function cornerNote(ctx: CanvasRenderingContext2D, pal: Palette, text: string): void {
  ctx.save();
  ctx.font = monoFont(pal, 9);
  ctx.fillStyle = pal.text3;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 8, 8);
  ctx.restore();
}

export function formatHz(f: number): string {
  if (f >= 1000) return `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k`;
  return `${Math.round(f)}`;
}

export { xOfFreq };
