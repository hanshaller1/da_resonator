/**
 * Route list popover: right-click (or long-press / context-menu key) on a control lists the
 * sources modulating it ("LFO 1  ━━ +30 %  ✕") with a depth slider each and lets you add one;
 * on a source chip it lists that source's targets. One popover at a time.
 * Uses a native range input, not Knob: Knob → ParamControl → mod/targets would make an import cycle.
 */
import type { ModAPI, ParamStoreAPI, RouteInfo, Unsubscribe } from '../../core/types';
import { SOURCES } from '../../shared/mod/sources';
import { newRouteChannel } from '../channel';
import { h } from '../dom';
import { midiPopoverRow } from '../midi/hook';
import { formatDepth, onSourceNames, SOURCE_GROUPS, sourceLabel, sourcesOf, targetLabel } from './labels';
import { routeChannelButton } from './routeChannel';
import { setRoutesOpener } from './targets';

interface Open {
  el: HTMLElement;
  anchor: HTMLElement;
  close: () => void;
}
let current: Open | null = null;

export function closeRoutesPopover(): void {
  current?.close();
}

interface PopoverSpec {
  title: string;
  /** routes to list */
  routes: () => RouteInfo[];
  /** row caption of a route */
  rowLabel: (r: RouteInfo) => string;
  empty: string;
  /** optional footer (add select …), rebuilt with the rows */
  footer?: () => HTMLElement | null;
  hint?: string;
  /** no route list (a control that can't be modulated, shown for its MIDI row) */
  noRoutes?: boolean;
  /** a section under the routes with its own updates (MIDI learn), disposed on close */
  extra?: () => { el: HTMLElement; dispose(): void } | null;
}

function openPopover(anchor: HTMLElement, spec: PopoverSpec, mod: ModAPI, params: ParamStoreAPI, at?: { x: number; y: number }): void {
  closeRoutesPopover();
  const list = h('ul', { class: 'mod-pop-list' });
  const foot = h('div', { class: 'mod-pop-foot' });
  const closeBtn = h('button', { type: 'button', class: 'mod-pop-close', 'aria-label': 'Close' }, '✕');
  const el = h(
    'div',
    { class: 'mod-pop', role: 'dialog', 'aria-label': spec.title },
    h('div', { class: 'mod-pop-head' }, h('span', { class: 'mod-pop-title' }, spec.title), closeBtn),
    list,
    foot,
    spec.hint ? h('p', { class: 'mod-pop-hint' }, spec.hint) : null,
  );
  const subs: Unsubscribe[] = [];
  const extra = spec.extra?.() ?? null;
  if (extra) el.insertBefore(extra.el, el.querySelector('.mod-pop-hint'));
  if (spec.noRoutes) list.hidden = true;

  const render = () => {
    subs.splice(0).forEach((u) => u());
    list.replaceChildren();
    const routes = spec.routes();
    if (!routes.length) list.append(h('li', { class: 'mod-pop-empty' }, spec.empty));
    for (const r of routes) {
      const label = spec.rowLabel(r);
      const range = h('input', { type: 'range', class: 'range mod-pop-range', min: -1, max: 1, step: 0.01, 'aria-label': `Depth ${label}` });
      const out = h('output', { class: 'mod-pop-depth' });
      const sync = (v: number) => {
        range.value = String(v);
        range.setAttribute('aria-valuetext', formatDepth(v));
        // bar from the centre (0) to the depth
        range.style.setProperty('--lo', `${(Math.min(0, v) + 1) * 50}%`);
        range.style.setProperty('--hi', `${(Math.max(0, v) + 1) * 50}%`);
        out.textContent = formatDepth(v);
      };
      sync(params.get(r.depthParam));
      subs.push(params.subscribe(r.depthParam, sync));
      range.addEventListener('input', () => {
        params.beginGesture(r.depthParam);
        params.set(r.depthParam, Number(range.value));
        params.endGesture(r.depthParam);
      });
      range.addEventListener('dblclick', () => params.set(r.depthParam, 0));
      const rm = h('button', { type: 'button', class: 'mod-pop-remove', 'aria-label': `Remove ${label}`, title: 'Remove' }, '✕');
      rm.addEventListener('click', () => mod.removeRoute(r.slot));
      const ch = routeChannelButton(mod, r);
      if (ch) subs.push(ch.dispose);
      list.append(h('li', { class: ch ? 'mod-pop-row has-ch' : 'mod-pop-row' }, h('span', { class: 'mod-pop-src', title: label }, label), ch?.el ?? null, range, out, rm));
    }
    foot.replaceChildren();
    const f = spec.footer?.();
    if (f) foot.append(f);
    foot.hidden = !f;
  };

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    let x = at ? at.x : r.left;
    let y = at ? at.y + 4 : r.bottom + 6;
    if (y + hgt > window.innerHeight - 6) y = Math.max(6, (at ? at.y : r.top) - hgt - 6);
    x = Math.min(window.innerWidth - w - 6, Math.max(6, x));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const onDocDown = (e: PointerEvent) => {
    if (e.target instanceof Node && (el.contains(e.target) || anchor.contains(e.target))) return;
    close();
  };
  const onScroll = (e: Event) => {
    if (e.target instanceof Node && el.contains(e.target)) return;
    close();
  };
  const close = () => {
    if (current?.el !== el) return;
    current = null;
    subs.forEach((u) => u());
    extra?.dispose();
    offMod();
    offNames();
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    if (hadFocus) (anchor.tabIndex >= 0 ? anchor : anchor.querySelector<HTMLElement>('select, [tabindex="0"]'))?.focus({ preventScroll: true });
  };

  const offMod = mod.onChange(() => {
    render();
    place();
  });
  const offNames = onSourceNames(render);
  closeBtn.addEventListener('click', close);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  render();
  document.body.append(el);
  place();
  current = { el, anchor, close };
  document.addEventListener('pointerdown', onDocDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  (el.querySelector<HTMLElement>('.mod-pop-range, select, .mod-pop-remove:not([hidden]), .mod-pop-midi-btn') ?? closeBtn).focus({ preventScroll: true });
}

/** popover listing the routes into param `id` (+ "add source") and its MIDI CC (learn / remove) */
export function openParamRoutes(anchor: HTMLElement, id: string, mod: ModAPI, params: ParamStoreAPI, at?: { x: number; y: number }): void {
  const title = targetLabel(id, mod.routes());
  const modOk = params.spec(id).modulatable || mod.routesTo(id).length > 0;
  openPopover(
    anchor,
    {
      title,
      routes: () => mod.routesTo(id),
      rowLabel: (r) => sourceLabel(r.source),
      empty: 'Not modulated.',
      hint: modOk ? 'Or arm a source chip and drag on a control.' : undefined,
      noRoutes: !modOk,
      extra: () => midiPopoverRow(id),
      footer: () => {
        if (!params.spec(id).modulatable) return null;
        const sel = h('select', { class: 'mod-pop-add', 'aria-label': `Add modulation source to ${title}` }, h('option', { value: '' }, 'Add source…'));
        let any = false;
        for (const g of SOURCE_GROUPS) {
          const og = h('optgroup', { label: g.label });
          for (const s of sourcesOf(g.cls)) {
            const c = mod.canRoute(s.id, id);
            if (c.ok) any = true;
            og.append(h('option', { value: s.id, disabled: !c.ok, title: c.ok ? null : c.reason }, c.ok ? sourceLabel(s.id) : `${sourceLabel(s.id)} (${c.reason})`));
          }
          sel.append(og);
        }
        if (!any) sel.disabled = true;
        sel.addEventListener('change', () => {
          if (sel.value) mod.addRoute(sel.value, id, 0.5, newRouteChannel(id));
        });
        return sel;
      },
    },
    mod,
    params,
    at,
  );
}

/** popover listing the targets of source `source` */
export function openSourceRoutes(anchor: HTMLElement, source: string, mod: ModAPI, params: ParamStoreAPI): void {
  if (!SOURCES.some((s) => s.id === source)) return;
  openPopover(
    anchor,
    {
      title: `${sourceLabel(source)} targets`,
      routes: () => mod.routesFrom(source),
      rowLabel: (r) => targetLabel(r.target, mod.routes()),
      empty: 'No targets yet.',
      hint: 'Arm the source chip, then click or drag on controls to add targets.',
    },
    mod,
    params,
  );
}

setRoutesOpener(openParamRoutes);
