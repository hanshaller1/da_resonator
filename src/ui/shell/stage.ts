/**
 * Fixed design size, scaled like a plugin window: the whole instrument is laid out at
 * 1200 × 700 design px and scaled uniformly to fit the window (smaller and larger).
 * Everything inside works in design px; only code that mixes pointer / client coordinates
 * with layout sizes (fader jumps, canvas backing stores) needs `uiScale()`.
 */
import type { Unsubscribe } from '../../core/types';

export const DESIGN_W = 1200;
export const DESIGN_H = 700;

let scale = 1;
const listeners = new Set<(k: number) => void>();

/** current scale factor of the stage (screen px per design px) */
export function uiScale(): number {
  return scale;
}

export function onScaleChange(cb: (k: number) => void): Unsubscribe {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * `frame` is the in-flow box sized to the scaled stage (so the page never scrolls sideways),
 * `stage` the 1200 × 700 element inside it that gets the transform.
 */
export function mountStage(frame: HTMLElement, stage: HTMLElement): void {
  const fit = () => {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const k = Math.max(0.2, Math.min(vw / DESIGN_W, vh / DESIGN_H));
    frame.style.width = `${DESIGN_W * k}px`;
    frame.style.height = `${DESIGN_H * k}px`;
    stage.style.transform = `scale(${k})`;
    document.documentElement.style.setProperty('--ui-scale', String(k));
    if (Math.abs(k - scale) > 1e-4) {
      scale = k;
      for (const l of listeners) l(k);
    }
  };
  scale = 0; // force the first notification
  fit();
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
}
