/**
 * Building blocks shared by the modulation source tabs (CLK MOD, LFO MOD, ENV MOD):
 * - the instance group on the right of the status line (selector, ON toggle, source chip),
 * - per-instance controls in the control row (all instances built once, the selected one shown),
 * - the split visualisation: picture of the selected instance left, its routes right,
 * - a sample history fed by the modulation readouts (scrolling traces).
 * The shared styles (`.srctab …`) live in styles/tabs/lfo.css.
 */
import '../../../styles/tabs/lfo.css';
import type { EngineAPI, Unsubscribe } from '../../../core/types';
import { PARAM_BY_ID, fromNorm } from '../../../shared/params';
import { InstanceSelect } from '../../components/instanceSelect';
import { RoutesList, type RoutesListOptions } from '../../components/routesList';
import { SourceChip } from '../../components/sourceChip';
import { ParamToggle } from '../../components/toggle';
import { h, toggleClass } from '../../dom';
import type { TabContext } from '../../shell/tabs';

/** value after modulation (plain), so pictures follow a modulated setting */
export function effective(engine: EngineAPI, id: string): number {
  const p = engine.params;
  return p.isModulated(id) ? fromNorm(p.spec(id), p.getEffectiveNorm(id)) : p.get(id);
}

export interface SourceTabOptions {
  /** InstanceSelect storage key */
  key: string;
  count: number;
  /** module id = source id = param prefix of instance i ('lfo1') */
  module(i: number): string;
  /** short selector caption ('LFO1') */
  label(i: number): string;
  /** readable name ('LFO 1') */
  name(i: number): string;
  /** routes list options; `sources` / `addFrom` default to the selected module */
  routes?: Partial<RoutesListOptions>;
}

/** where the picture ends and the routes list starts: the boundary between slot 6 and 7 */
export const SPLIT_SLOTS = 6;

export class SourceTab {
  readonly select: InstanceSelect;
  readonly routes: RoutesList;
  /** status line text left of the instance group */
  readonly desc: HTMLElement;
  /** the picture box (left part of the visualisation, position relative) */
  readonly pic: HTMLElement;
  private listeners = new Set<(i: number) => void>();
  private perInstance: HTMLElement[][] = [];

  constructor(
    private tab: TabContext,
    private opts: SourceTabOptions,
  ) {
    const { engine } = tab;
    const p = engine.params;
    tab.root.classList.add('srctab');
    this.select = new InstanceSelect(engine, { key: opts.key, count: opts.count, label: opts.label, onParam: (i) => `${opts.module(i)}.on` });
    for (let i = 0; i < opts.count; i++) this.select.el.children[i]?.setAttribute('title', opts.name(i));
    this.desc = h('span', { class: 'srctab-desc' });

    const ons: HTMLElement[] = [];
    const chips: HTMLElement[] = [];
    for (let i = 0; i < opts.count; i++) {
      const m = opts.module(i);
      const on = new ParamToggle(p, `${m}.on`, { label: 'ON', ariaLabel: `${opts.name(i)} on` });
      ons.push(on.el);
      chips.push(new SourceChip(engine, m).el);
    }
    this.track(ons);
    this.track(chips);
    tab.status.append(this.desc, h('span', { class: 'tp-spacer' }), this.select.el, h('span', { class: 'srctab-on' }, ...ons), h('span', { class: 'srctab-chip' }, ...chips));

    /* ---------- visualisation: picture | routes ---------- */
    this.pic = h('div', { class: 'srctab-pic' });
    this.routes = new RoutesList(engine, {
      sources: () => [this.module],
      addFrom: () => this.module,
      ...opts.routes,
    });
    tab.viz.append(this.pic, h('div', { class: 'srctab-routes' }, this.routes.el));

    /* ---------- selected instance: off state ---------- */
    const syncOff = () => toggleClass(tab.root, 'is-off', p.get(`${this.module}.on`) < 0.5);
    for (let i = 0; i < opts.count; i++) p.subscribe(`${opts.module(i)}.on`, syncOff);
    this.onChange(syncOff);
    syncOff();

    this.select.onChange((i) => {
      for (const els of this.perInstance) els.forEach((el, k) => (el.hidden = k !== i));
      this.routes.refresh();
      for (const l of this.listeners) l(i);
    });
  }

  get current(): number {
    return this.select.current;
  }

  /** module id of the selected instance ('lfo2') */
  get module(): string {
    return this.opts.module(this.select.current);
  }

  onChange(cb: (i: number) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** elements, one per instance: only the selected one is shown */
  track(els: HTMLElement[]): void {
    els.forEach((el, k) => (el.hidden = k !== this.current));
    this.perInstance.push(els);
  }

  /**
   * Fill control slot `k` (0-based) for every instance; `build` returns the control element of
   * instance i. Returns the per-instance wrappers (for dimming).
   */
  slot(k: number, build: (i: number, m: string) => HTMLElement): HTMLElement[] {
    const wraps = Array.from({ length: this.opts.count }, (_, i) => h('div', { class: 'srctab-ctl' }, build(i, this.opts.module(i))));
    this.track(wraps);
    this.tab.slots[k].append(...wraps);
    return wraps;
  }

  /**
   * Shell reveal: params of one of the instances (selects it), and the depth of a route that
   * starts at one of them (shown in the routes list).
   */
  reveal(paramId: string, owns: (paramId: string) => boolean): boolean {
    const engine = this.tab.engine;
    let module: string | null = null;
    if (/^route\d+\.depth$/.test(paramId)) module = engine.mod.routes().find((r) => r.depthParam === paramId)?.source ?? null;
    else if (owns(paramId)) module = PARAM_BY_ID[paramId]?.module ?? null;
    if (!module) return false;
    for (let i = 0; i < this.opts.count; i++) {
      if (this.opts.module(i) !== module) continue;
      this.select.select(i);
      return true;
    }
    return false;
  }
}

/* ---------- sample history ---------- */

const RING = 1024;

/**
 * Values sampled at every modulation readout (fixed audio-time spacing, no frame jitter), with
 * the smoothed wall time between readouts, for scrolling traces (newest sample at the right).
 */
export class History {
  readonly vals: Float32Array;
  private dts = new Float32Array(RING);
  private xs = new Float32Array(RING);
  private ys = new Float32Array(RING);
  head = 0;
  count = 0;
  /** set when a sample arrived since the last draw */
  fresh = false;

  constructor() {
    this.vals = new Float32Array(RING);
  }

  push(v: number, dtMs: number): void {
    this.head = (this.head + 1) % RING;
    this.vals[this.head] = v;
    this.dts[this.head] = dtMs;
    if (this.count < RING) this.count++;
    this.fresh = true;
  }

  /** value `back` samples before the newest */
  at(back: number): number {
    return this.vals[(this.head - back + RING * 4) % RING];
  }

  /**
   * Points of the trace from x1 (newest) back to x0 over `ms`: returns the number of points;
   * read them with `px(k)` / `py(k)`.
   */
  layout(x0: number, x1: number, ms: number, yOf: (v: number) => number): number {
    if (!this.count) return 0;
    const pxPerMs = (x1 - x0) / ms;
    let x = x1;
    let i = this.head;
    let n = 0;
    this.xs[0] = x;
    this.ys[0] = yOf(this.vals[i]);
    while (++n < this.count && x > x0) {
      x -= this.dts[i] * pxPerMs;
      i = (i - 1 + RING) % RING;
      this.xs[n] = Math.max(x0, x);
      this.ys[n] = yOf(this.vals[i]);
    }
    return n;
  }

  px(k: number): number {
    return this.xs[k];
  }
  py(k: number): number {
    return this.ys[k];
  }

  /** path through the laid-out points (call layout first) */
  path(g: CanvasRenderingContext2D, n: number): void {
    g.moveTo(this.xs[0], this.ys[0]);
    for (let k = 1; k < n; k++) g.lineTo(this.xs[k], this.ys[k]);
  }

  clear(): void {
    this.count = 0;
    this.fresh = true;
  }
}

/**
 * Calls `cb(dtMs)` at every modulation readout; dtMs is the smoothed wall time between readouts
 * (~16 ms), gaps (engine paused) ignored.
 */
export function onReadouts(engine: EngineAPI, cb: (dtMs: number) => void): Unsubscribe {
  let last = 0;
  let spacing = 1000 / 60;
  return engine.mod.onReadout(() => {
    const now = performance.now();
    const d = now - last;
    if (last && d < 250) spacing += (d - spacing) * 0.05;
    last = now;
    cb(spacing);
  });
}

/** a centred note in the picture (e.g. "LFO 2 is off") */
export function picNote(g: CanvasRenderingContext2D, font: string, color: string, text: string, x: number, y: number): void {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
  g.restore();
}
