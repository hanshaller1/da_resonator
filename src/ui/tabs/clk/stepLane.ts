/**
 * 16-step lane of one clock mod: draw values by dragging over the bars (Steps mode), steps beyond
 * STEPS dimmed, Euclid pulses shown as gates, the current step lit from the clock position.
 * Each bar is a keyboard slider bound to `cmodN.stepK` (also a [data-param] target for reveal
 * and assign mode).
 */
import type { EngineAPI } from '../../../core/types';
import { euclidHit, swungStep } from '../../../dsp/modules/cmod';
import { CMOD_STEPS } from '../../../shared/paramdefs/modules';
import { DIVISIONS } from '../../../shared/paramdefs/types';
import { clockView, followedClock } from '../../clock';
import { clamp01, h, toggleClass } from '../../dom';
import { assign } from '../../mod/assign';
import { effective } from '../lfo/sourceTab';

/* CMOD_MODES order */
export const MODE_DIVIDER = 0;
export const MODE_STEPS = 1;
export const MODE_EUCLID = 2;
export const MODE_RANDOM = 3;
const MODE_NAMES = ['divider', 'steps', 'euclid', 'random'];

export class StepLane {
  readonly el: HTMLElement;
  private grid: HTMLElement;
  private cols: HTMLElement[] = [];
  private bars: HTMLElement[] = [];
  private mods: HTMLElement[] = [];
  private ids: string[] = [];
  private mode = -1;
  private cur = -1;
  private patternKey = '';
  private frame = 0;

  constructor(
    private engine: EngineAPI,
    private m: string,
    label: string,
  ) {
    const p = engine.params;
    this.grid = h('div', { class: 'clk-steps', role: 'group', 'aria-label': `${label} steps` });
    for (let s = 0; s < CMOD_STEPS; s++) {
      const id = `${m}.step${s}`;
      const fill = h('span', { class: 'clk-bar-fill' });
      const mod = h('span', { class: 'clk-bar-mod' });
      const bar = h(
        'div',
        { class: 'clk-bar', tabindex: '0', role: 'slider', 'aria-label': `${label} step ${s + 1}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'data-param': id },
        fill,
        mod,
      );
      const col = h('div', { class: 'clk-col' }, bar, h('span', { class: 'clk-led' }), h('span', { class: 'clk-num' }, s % 4 === 0 ? String(s + 1) : ''));
      const sync = (v: number) => {
        fill.style.height = `${clamp01(v) * 100}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
        bar.setAttribute('aria-valuetext', `${Math.round(v * 100)}%`);
      };
      sync(p.get(id));
      p.subscribe(id, sync);
      bar.addEventListener('dblclick', () => this.mode === MODE_STEPS && this.write(id, null));
      bar.addEventListener('keydown', (e) => this.onKey(e, s));
      this.ids.push(id);
      this.bars.push(bar);
      this.mods.push(mod);
      this.cols.push(col);
      this.grid.append(col);
    }
    this.grid.addEventListener('pointerdown', this.onDown);
    this.el = h('div', { class: 'clk-lane' }, this.grid);
  }

  /** set (or reset with null) one step as its own gesture */
  private write(id: string, v: number | null): void {
    const p = this.engine.params;
    p.beginGesture(id);
    if (v === null) p.reset(id);
    else p.set(id, clamp01(v));
    p.endGesture(id);
  }

  private onKey(e: KeyboardEvent, s: number): void {
    if (this.mode !== MODE_STEPS) return;
    const p = this.engine.params;
    const v = p.get(this.ids[s]);
    const fine = e.shiftKey ? 0.01 : 0.05;
    let n: number | null = null;
    switch (e.key) {
      case 'ArrowUp': n = v + fine; break;
      case 'ArrowDown': n = v - fine; break;
      case 'PageUp': n = v + 0.25; break;
      case 'PageDown': n = v - 0.25; break;
      case 'Home': n = 0; break;
      case 'End': n = 1; break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        this.bars[Math.max(0, Math.min(CMOD_STEPS - 1, s + (e.key === 'ArrowLeft' ? -1 : 1)))].focus();
        return;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.write(this.ids[s], null);
        return;
      default:
        return;
    }
    e.preventDefault();
    this.write(this.ids[s], n);
  }

  /* drag to draw: the column under the pointer takes the pointer's height; skipped columns are interpolated */
  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || assign.source || this.mode !== MODE_STEPS) return;
    e.preventDefault();
    const p = this.engine.params;
    // client rects already include the stage scale
    const rects = this.bars.map((b) => b.getBoundingClientRect());
    const touched = new Set<string>();
    const colAt = (x: number) => {
      let best = 0;
      for (let i = 0; i < rects.length; i++) if (x >= rects[i].left - 2) best = i;
      return best;
    };
    const valAt = (i: number, y: number) => clamp01(1 - (y - rects[i].top) / rects[i].height);
    const put = (i: number, v: number) => {
      const id = this.ids[i];
      if (!touched.has(id)) {
        touched.add(id);
        p.beginGesture(id);
      }
      p.set(id, v);
    };
    let lastCol = colAt(e.clientX);
    let lastVal = valAt(lastCol, e.clientY);
    put(lastCol, lastVal);
    this.bars[lastCol].focus({ preventScroll: true });
    const grid = this.grid;
    try {
      grid.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    toggleClass(this.el, 'is-drawing', true);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const col = colAt(ev.clientX);
      const val = valAt(col, ev.clientY);
      const dir = col > lastCol ? 1 : -1;
      if (col !== lastCol) for (let i = lastCol + dir; i !== col; i += dir) put(i, lastVal + ((val - lastVal) * (i - lastCol)) / (col - lastCol));
      put(col, val);
      lastCol = col;
      lastVal = val;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      grid.removeEventListener('pointermove', move);
      grid.removeEventListener('pointerup', up);
      grid.removeEventListener('pointercancel', up);
      toggleClass(this.el, 'is-drawing', false);
      for (const id of touched) p.endGesture(id);
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', up);
    grid.addEventListener('pointercancel', up);
  };

  setMode(mode: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.el.dataset.mode = MODE_NAMES[mode] ?? 'divider';
    // the bars are only editable where the step values are used
    for (const b of this.bars) {
      b.tabIndex = mode === MODE_STEPS ? 0 : -1;
      b.setAttribute('aria-disabled', String(mode !== MODE_STEPS));
    }
    this.patternKey = '';
  }

  /** per frame: pattern, current step from the clock position (same grid maths as the DSP) */
  tick(): void {
    const p = this.engine.params;
    const m = this.m;
    const pattern = this.mode === MODE_STEPS || this.mode === MODE_EUCLID;
    const steps = pattern ? Math.max(1, Math.min(CMOD_STEPS, Math.round(effective(this.engine, `${m}.steps`)) + 1)) : CMOD_STEPS;
    const pulses = Math.round(effective(this.engine, `${m}.pulses`));
    const rot = Math.round(effective(this.engine, `${m}.rotate`));
    const key = `${this.mode}/${steps}/${this.mode === MODE_EUCLID ? `${pulses}/${rot}` : ''}`;
    if (key !== this.patternKey) {
      this.patternKey = key;
      this.cols.forEach((c, i) => {
        toggleClass(c, 'is-inactive', pattern && i >= steps);
        toggleClass(c, 'is-pulse', this.mode === MODE_EUCLID && i < steps && euclidHit(steps, pulses, rot, i));
      });
    }
    let cur = -1;
    if (pattern && this.engine.state === 'running' && p.get(`${m}.on`) >= 0.5) {
      const div = DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, Math.round(effective(this.engine, `${m}.div`))))].beats;
      const k = swungStep(clockView(this.engine, followedClock(this.engine, m)).beats / div, effective(this.engine, `${m}.swing`));
      cur = ((k % steps) + steps) % steps;
    }
    if (cur !== this.cur) {
      if (this.cur >= 0) toggleClass(this.cols[this.cur], 'is-current', false);
      if (cur >= 0) toggleClass(this.cols[cur], 'is-current', true);
      this.cur = cur;
    }
    // modulated step values: cyan marker at the effective value
    if ((this.frame++ & 3) === 0) {
      for (let s = 0; s < CMOD_STEPS; s++) {
        const id = this.ids[s];
        const on = this.mode === MODE_STEPS && p.isModulated(id);
        toggleClass(this.bars[s], 'is-modulated', on);
        if (on) this.mods[s].style.bottom = `${p.getEffectiveNorm(id) * 100}%`;
      }
    }
  }
}
