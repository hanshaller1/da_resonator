/**
 * Targets of one or more modulation sources, for the source's own tab (the mod matrix is shown
 * per source: LFO routes on LFO MOD, macro routes on MACRO …). Each row: target (click shows the
 * control), depth knob, depth, remove. A footer adds a target. Optionally lists the trigger
 * routes into / out of a module (resets), with an add select.
 */
import '../../styles/components/routes.css';
import type { EngineAPI, RouteInfo, Unsubscribe } from '../../core/types';
import { TRIGGER_IN_BY_ID, TRIGGER_INS, TRIGGER_OUT_BY_ID, TRIGGER_OUTS } from '../../shared/mod/sources';
import { PARAM_BY_ID } from '../../shared/params';
import { newRouteChannel } from '../channel';
import { h } from '../dom';
import { formatDepth, onSourceNames, sourceLabel, targetGroup, targetGroups, targetLabel } from '../mod/labels';
import { nav } from '../shell/tabs';
import { Knob } from './knob';
import { showBubble } from '../mod/feedback';
import { routeChannelButton } from '../mod/routeChannel';

export interface RoutesListOptions {
  /** sources whose routes are listed (re-read on refresh()) */
  sources: () => string[];
  /** source the "add target" select adds for (null hides the select) */
  addFrom?: () => string | null;
  /** trigger inputs (resets) of the shown module, e.g. ['lfo2.reset'] */
  triggerIns?: () => string[];
  /** trigger outputs of the shown module, e.g. ['lfo2.cycle'] */
  triggerOuts?: () => string[];
  /** show the source name on each row (when several sources are listed) */
  showSource?: boolean;
  /** text when there are no routes */
  empty?: string;
  title?: string;
}

interface Row {
  key: string;
  el: HTMLElement;
  dispose(): void;
}

export class RoutesList {
  readonly el: HTMLElement;
  private list = h('ul', { class: 'rl-list' });
  private emptyEl: HTMLElement;
  private count = h('span', { class: 'rl-count' });
  private addSel = h('select', { class: 'rl-select', 'aria-label': 'Add target' });
  private trig = h('div', { class: 'rl-trig' });
  private rows = new Map<number, Row>();
  private unsubs: Unsubscribe[] = [];

  constructor(
    private engine: EngineAPI,
    private opts: RoutesListOptions,
  ) {
    this.emptyEl = h('p', { class: 'rl-empty' }, opts.empty ?? 'No targets yet. Pick one below, or arm the source chip and drag on any control.');
    this.addSel.addEventListener('change', () => {
      const src = this.opts.addFrom?.();
      const tgt = this.addSel.value;
      this.addSel.value = '';
      if (!src || !tgt) return;
      const r = engine.mod.addRoute(src, tgt, 0.5, newRouteChannel(tgt));
      if ('ok' in r && !r.ok) showBubble(this.addSel, r.reason, 'warn', 2200);
    });
    this.el = h(
      'div',
      { class: 'rl' },
      h('div', { class: 'rl-head' }, h('span', { class: 'micro-label' }, opts.title ?? 'Targets'), this.count),
      h('div', { class: 'rl-scroll' }, this.list, this.emptyEl),
      h('div', { class: 'rl-foot' }, this.addSel),
      this.trig,
    );
    this.unsubs.push(engine.mod.onChange(() => this.refresh()), onSourceNames(() => this.refresh(true)));
    this.refresh();
  }

  /** re-read sources and routes (call after the shown instance changed) */
  refresh(rebuild = false): void {
    const { mod, params } = this.engine;
    const sources = new Set(this.opts.sources());
    const all = mod.routes();
    const routes = all.filter((r) => sources.has(r.source));
    if (rebuild) {
      for (const row of this.rows.values()) {
        row.dispose();
        row.el.remove();
      }
      this.rows.clear();
    }
    const live = new Set(routes.map((r) => r.slot));
    for (const [slot, row] of this.rows) {
      const r = routes.find((x) => x.slot === slot);
      if (!live.has(slot) || !r || row.key !== `${r.source}>${r.target}`) {
        row.dispose();
        row.el.remove();
        this.rows.delete(slot);
      }
    }
    let ref: ChildNode | null = this.list.firstChild;
    for (const r of routes) {
      let row = this.rows.get(r.slot);
      if (!row) this.rows.set(r.slot, (row = this.buildRow(r, all)));
      if (row.el === ref) ref = ref.nextSibling;
      else this.list.insertBefore(row.el, ref);
    }
    this.emptyEl.hidden = routes.length > 0;
    this.count.textContent = routes.length ? String(routes.length) : '';

    // add select
    const src = this.opts.addFrom?.() ?? null;
    this.addSel.hidden = !src;
    if (src) {
      this.addSel.replaceChildren(h('option', { value: '' }, `Add target for ${sourceLabel(src)}…`));
      for (const g of targetGroups(mod, src)) {
        const og = h('optgroup', { label: g.label });
        for (const o of g.options) if (!o.reason) og.append(h('option', { value: o.id }, o.label));
        if (og.childElementCount) this.addSel.append(og);
      }
    }
    void params;
    this.renderTriggers();
  }

  private buildRow(r: RouteInfo, all: RouteInfo[]): Row {
    const { params, mod } = this.engine;
    const group = targetGroup(PARAM_BY_ID[r.target]);
    const full = targetLabel(r.target, all);
    const label = full.startsWith(`${group} `) ? full.slice(group.length + 1) : full;
    const depth = new Knob(params, r.depthParam, { size: 'sm', bare: true, ariaLabel: `Depth ${sourceLabel(r.source)} to ${full}` });
    const out = h('output', { class: 'rl-depth' });
    const fmt = () => (out.textContent = formatDepth(params.get(r.depthParam)));
    const sub = params.subscribe(r.depthParam, fmt);
    fmt();
    const target = h(
      'button',
      { type: 'button', class: 'rl-target', title: `Show ${full}` },
      this.opts.showSource ? h('span', { class: 'rl-src' }, sourceLabel(r.source)) : null,
      h('span', { class: 'rl-group' }, group),
      h('span', { class: 'rl-label' }, label),
    );
    target.addEventListener('click', () => {
      if (!nav.reveal(r.target)) showBubble(target, 'That control is not on screen', 'warn', 1600);
    });
    const rm = h('button', { type: 'button', class: 'rl-remove', 'aria-label': `Remove ${sourceLabel(r.source)} → ${full}`, title: 'Remove' }, '✕');
    rm.addEventListener('click', () => mod.removeRoute(r.slot));
    const ch = routeChannelButton(mod, r);
    const el = h('li', { class: ch ? 'rl-row has-ch' : 'rl-row' }, target, ch?.el ?? null, depth.el, out, rm);
    return {
      key: `${r.source}>${r.target}`,
      el,
      dispose: () => {
        depth.destroy();
        sub();
        ch?.dispose();
      },
    };
  }

  private renderTriggers(): void {
    const ins = this.opts.triggerIns?.() ?? [];
    const outs = this.opts.triggerOuts?.() ?? [];
    this.trig.replaceChildren();
    this.trig.hidden = !ins.length && !outs.length;
    if (this.trig.hidden) return;
    const { mod } = this.engine;
    const ts = mod.triggerRoutes().filter((t) => ins.includes(t.target) || outs.includes(t.source));
    for (const t of ts) {
      const o = TRIGGER_OUT_BY_ID[t.source]?.label ?? t.source;
      const i = TRIGGER_IN_BY_ID[t.target]?.label ?? t.target;
      const rm = h('button', { type: 'button', class: 'rl-remove', 'aria-label': `Remove trigger ${o} → ${i}`, title: 'Remove' }, '✕');
      rm.addEventListener('click', () => mod.removeTriggerRoute(t.source, t.target));
      this.trig.append(h('div', { class: 'rl-trow' }, h('span', { class: 'rl-tport' }, o), h('span', { class: 'rl-arrow', 'aria-hidden': 'true' }, '→'), h('span', { class: 'rl-tport' }, i), rm));
    }
    // add: "reset by …" for each input, "resets …" for each output
    const sel = h('select', { class: 'rl-select', 'aria-label': 'Add trigger route' }, h('option', { value: '' }, ins.length ? 'Reset by…' : 'Trigger a reset…'));
    for (const inp of ins) {
      for (const o of TRIGGER_OUTS) {
        const c = mod.canTriggerRoute(o.id, inp);
        if (c.ok) sel.append(h('option', { value: `${o.id}>${inp}` }, `${o.label} → ${TRIGGER_IN_BY_ID[inp]?.label ?? inp}`));
      }
    }
    for (const out of outs) {
      for (const i of TRIGGER_INS) {
        const c = mod.canTriggerRoute(out, i.id);
        if (c.ok) sel.append(h('option', { value: `${out}>${i.id}` }, `${TRIGGER_OUT_BY_ID[out]?.label ?? out} → ${i.label}`));
      }
    }
    sel.addEventListener('change', () => {
      const [s, t] = sel.value.split('>');
      if (!s || !t) return;
      const c = mod.addTriggerRoute(s, t);
      if (!c.ok) showBubble(sel, c.reason, 'warn', 2200);
    });
    if (sel.options.length > 1) this.trig.append(sel);
  }

  destroy(): void {
    this.unsubs.forEach((u) => u());
    for (const row of this.rows.values()) row.dispose();
    this.rows.clear();
  }
}
