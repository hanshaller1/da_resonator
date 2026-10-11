/**
 * A canvas for a tab's visualisation area: sized by the stage (crisp at any scale), theme
 * colours kept current, and a frame callback that only runs while its tab is visible.
 */
import { h } from '../dom';
import { fitCanvas, onThemeChange, type CanvasSize } from '../shell/canvas';
import type { TabContext } from '../shell/tabs';
import { frameLoop } from '../scheduler';
import { readPalette, type Palette } from './draw';

export interface VizOptions {
  /** accessible description of the picture */
  label: string;
  /** extra class on the canvas */
  cls?: string;
  /** called after every resize (design px) */
  onResize?(size: CanvasSize): void;
}

export class VizCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  ratio = 1;
  pal: Palette;
  /** set to request a redraw; frame callbacks decide what to do with it */
  dirty = true;

  /**
   * @param host element to put the canvas in (usually `tab.viz`)
   * @param frame called every animation frame while the tab is visible and the canvas has a size
   */
  constructor(host: HTMLElement, tab: TabContext, frame: (dt: number, now: number) => void, opts: VizOptions) {
    this.canvas = h('canvas', { class: `viz-canvas ${opts.cls ?? ''}`.trim(), role: 'img', 'aria-label': opts.label });
    host.append(this.canvas);
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2d canvas unavailable');
    this.g = g;
    this.pal = readPalette(host);
    fitCanvas(this.canvas, (s) => {
      this.w = s.w;
      this.h = s.h;
      this.ratio = s.ratio;
      this.dirty = true;
      opts.onResize?.(s);
    });
    onThemeChange(() => {
      this.pal = readPalette(host);
      this.dirty = true;
    });
    tab.onVisible((v) => {
      if (v) this.dirty = true;
    });
    frameLoop.add((now, dt) => {
      if (!tab.visible || !this.w) return;
      if (!this.pal.accent) this.pal = readPalette(host); // styles not resolved until attached
      frame(dt, now);
    });
  }

  /** reset the transform to design px and clear; returns the context */
  begin(): CanvasRenderingContext2D {
    const { g, ratio } = this;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    // context state survives between frames: start every frame from the defaults
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 1;
    g.lineWidth = 1;
    g.setLineDash([]);
    return g;
  }
}
