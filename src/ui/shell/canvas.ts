/**
 * Canvas sizing inside the scaled stage: drawing coordinates are design px (the element's
 * layout size), the backing store follows devicePixelRatio × stage scale so lines stay crisp.
 */
import type { Unsubscribe } from '../../core/types';
import { onScaleChange, uiScale } from './stage';

export interface CanvasSize {
  /** layout size in design px (draw in these units) */
  w: number;
  h: number;
  /** backing pixels per design px */
  ratio: number;
}

/**
 * Keep `canvas`'s backing store matched to its layout size; calls `onResize` after every change
 * (also when a hidden tab becomes visible: hidden canvases report 0 × 0 and are skipped).
 * Draw after `ctx.setTransform(ratio, 0, 0, ratio, 0, 0)`.
 */
export function fitCanvas(canvas: HTMLCanvasElement, onResize: (s: CanvasSize) => void): Unsubscribe {
  let last = '';
  const apply = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(4, (window.devicePixelRatio || 1) * uiScale());
    const key = `${w}x${h}@${ratio}`;
    if (key === last) return;
    last = key;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    onResize({ w, h, ratio });
  };
  const ro = new ResizeObserver(apply);
  ro.observe(canvas);
  const off = onScaleChange(apply);
  apply();
  return () => {
    ro.disconnect();
    off();
  };
}

/** read a set of CSS custom properties (colours) from an element */
export function readVars<K extends string>(el: Element, names: Record<K, string>): Record<K, string> {
  const cs = getComputedStyle(el);
  const out = {} as Record<K, string>;
  for (const k of Object.keys(names) as K[]) out[k] = cs.getPropertyValue(names[k]).trim();
  return out;
}

/** call `cb` whenever the colour theme changes */
export function onThemeChange(cb: () => void): Unsubscribe {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
