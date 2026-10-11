/**
 * Assign mode on the controls. Every param control (Knob, Fader, ParamSelect) owns an
 * `AssignBinding`; one registry here re-evaluates them all when a source is armed or the routes
 * change, so each control knows whether it is a target, already routed, or blocked (and why).
 *
 * While a source is armed, pointer-down on a target creates the route (depth 0) and vertical
 * drag sets its depth; double-click removes it; Enter creates it from the keyboard (depth 50 %),
 * arrows change the depth, Delete removes it. Alt-drag still edits the value. Blocked controls
 * (dimmed, title = reason) keep working normally, e.g. to tweak the armed LFO's own rate.
 *
 * Controls reach the engine through `setModApi()` (called once from mountApp), so their
 * constructors don't need the engine.
 */
import type { ModAPI, ParamStoreAPI, RouteInfo, Unsubscribe } from '../../core/types';
import { assign } from './assign';
import { announce, hideBubble, showBubble } from './feedback';
import { formatDepth, sourceBipolar, sourceLabel, targetLabel } from './labels';

export type AssignState = 'target' | 'routed' | 'blocked' | null;

/** what a control offers its binding */
export interface AssignHost {
  readonly id: string;
  readonly el: HTMLElement;
  /** paint the depth range of the armed source's route (null = hide) */
  showDepth?(depth: number | null, bipolar: boolean): void;
}

/* ---------- module state ---------- */

type RoutesOpener = (anchor: HTMLElement, id: string, mod: ModAPI, params: ParamStoreAPI, at?: { x: number; y: number }) => void;
/** set by mod/popover.ts (which needs Knob: a static import here would be an import cycle) */
let openParamRoutes: RoutesOpener | null = null;
export function setRoutesOpener(fn: RoutesOpener): void {
  openParamRoutes = fn;
}

let api: ModAPI | null = null;
let store: ParamStoreAPI | null = null;
let modUnsub: Unsubscribe | null = null;
let paramUnsub: Unsubscribe | null = null;
const bindings = new Set<AssignBinding>();
const roots = new WeakMap<Element, AssignBinding>();
/** loose [data-param] elements (toggles, custom widgets) marked during assign mode */
let loose = new Map<HTMLElement, { id: string; state: AssignState; title: string | null }>();
let queued = false;

/** connect the controls to the engine's modulation API (call once, before panels mount) */
export function setModApi(mod: ModAPI | null, params?: ParamStoreAPI): void {
  modUnsub?.();
  paramUnsub?.();
  modUnsub = paramUnsub = null;
  api = mod;
  store = params ?? null;
  if (mod) modUnsub = mod.onChange(refreshAll);
  if (params) {
    // depth of the armed source's routes, or its polarity switch, changed: redraw depth arcs
    paramUnsub = params.subscribeAll((id) => {
      if (!assign.source || !(id.endsWith('.depth') || id === `${assign.source}.uni`)) return;
      for (const b of bindings) if (b.state === 'routed') b.paintDepth();
    });
  }
  refreshAll();
}

export function getModApi(): ModAPI | null {
  return api;
}

assign.onChange(refreshAll);

function refreshAll(): void {
  const src = api ? assign.source : null;
  if (typeof document !== 'undefined') document.body.classList.toggle('is-assigning', !!src);
  for (const b of bindings) b.update();
  // panels may re-render right after a route change: mark loose elements once the DOM settled
  if (!queued) {
    queued = true;
    queueMicrotask(() => {
      queued = false;
      markLoose();
    });
  }
}

function ownerBinding(el: Element): AssignBinding | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const b = roots.get(n);
    if (b) return b;
  }
  return null;
}

function setTitle(el: HTMLElement, saved: string | null, text: string | null): void {
  if (text) el.title = text;
  else if (saved !== null) el.title = saved;
  else el.removeAttribute('title');
}

function applyClasses(el: HTMLElement, s: AssignState): void {
  el.classList.toggle('is-assign-target', s === 'target' || s === 'routed');
  el.classList.toggle('is-assign-routed', s === 'routed');
  el.classList.toggle('is-assign-blocked', s === 'blocked');
}

/** toggles and other [data-param] elements without a binding: mark them, route on click */
function markLoose(): void {
  if (typeof document === 'undefined') return;
  const src = api ? assign.source : null;
  const next = new Map<HTMLElement, { id: string; state: AssignState; title: string | null }>();
  if (src && api) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-param]')) {
      if (ownerBinding(el)) continue;
      const id = el.dataset.param!;
      const prev = loose.get(el);
      const title = prev ? prev.title : el.getAttribute('title');
      const routed = api.routesTo(id).some((r) => r.source === src);
      const c = routed ? null : api.canRoute(src, id);
      const state: AssignState = routed ? 'routed' : c!.ok ? 'target' : 'blocked';
      applyClasses(el, state);
      setTitle(el, title, routed ? `${sourceLabel(src)} modulates this` : c!.ok ? `Click to modulate with ${sourceLabel(src)}` : (c as { reason: string }).reason);
      next.set(el, { id, state, title });
    }
  }
  for (const [el, v] of loose) {
    if (next.has(el)) continue;
    applyClasses(el, null);
    setTitle(el, v.title, null);
  }
  loose = next;
}

if (typeof document !== 'undefined') {
  // loose targets (no binding of their own): a click creates the route at 50 %.
  // Blocked ones (toggles …) keep working.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const src = assign.source;
      if (!src || !api || e.button !== 0 || e.altKey || !(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>('[data-param]');
      const v = el && loose.get(el);
      if (!el || !v || v.state === 'blocked') return;
      e.preventDefault();
      e.stopPropagation();
      if (v.state === 'target') {
        const r = api.addRoute(src, v.id, 0.5);
        if ('ok' in r) showBubble(el, r.ok ? '' : r.reason, 'warn', 1600);
        else {
          showBubble(el, `${sourceLabel(src)} → ${formatDepth(0.5)}`, 'mod', 1200);
          announce(`${sourceLabel(src)} now modulates ${targetLabel(v.id)} at 50 percent`);
        }
      }
    },
    true,
  );
  // swallow the click that follows, so toggles don't flip while routing
  document.addEventListener(
    'click',
    (e) => {
      if (!assign.source || !(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>('[data-param]');
      const v = el && loose.get(el);
      if (v && v.state !== 'blocked' && !(e as MouseEvent).altKey) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}

/* ---------- per-control binding ---------- */

export interface DragOpts {
  /** pixels for a full -1..1 depth sweep */
  dragRange: number;
  fineFactor?: number;
}

export class AssignBinding {
  state: AssignState = null;
  private route: RouteInfo | null = null;
  private savedTitle: string | null = null;
  private titled = false;
  private drag: { pointerId: number; lastY: number; acc: number; el: HTMLElement; depthParam: string; params: ParamStoreAPI } | null = null;
  private lastTap = 0;
  private press: { pointerId: number; x: number; y: number; timer: number } | null = null;

  constructor(
    private host: AssignHost,
    private params: ParamStoreAPI,
  ) {
    bindings.add(this);
    roots.set(host.el, this);
    host.el.addEventListener('contextmenu', this.onContext);
    this.update();
  }

  destroy(): void {
    bindings.delete(this);
    roots.delete(this.host.el);
    this.host.el.removeEventListener('contextmenu', this.onContext);
    this.cancelPress();
  }

  /** assign mode is on and this control reacts to it */
  get armed(): boolean {
    return !!api && !!assign.source;
  }

  /** re-evaluate against the armed source (called by the registry) */
  update(): void {
    const src = api ? assign.source : null;
    const el = this.host.el;
    if (!src || !api) {
      if (this.state !== null) {
        this.state = null;
        this.route = null;
        applyClasses(el, null);
        this.restoreTitle();
        this.host.showDepth?.(null, false);
      }
      return;
    }
    if (!this.titled) {
      this.savedTitle = el.getAttribute('title');
      this.titled = true;
    }
    const id = this.host.id;
    this.route = api.routesTo(id).find((r) => r.source === src) ?? null;
    const name = sourceLabel(src);
    if (this.route) {
      this.state = 'routed';
      el.title = `${name} modulates this: drag to set depth, double-click to remove`;
    } else {
      const c = api.canRoute(src, id);
      this.state = c.ok ? 'target' : 'blocked';
      el.title = c.ok ? `Click or drag to modulate with ${name}` : c.reason;
    }
    applyClasses(el, this.state);
    this.paintDepth();
  }

  private restoreTitle(): void {
    if (!this.titled) return;
    setTitle(this.host.el, this.savedTitle, null);
    this.titled = false;
  }

  paintDepth(): void {
    if (!this.host.showDepth) return;
    const src = assign.source;
    if (!this.route || !src) return this.host.showDepth(null, false);
    const get = (id: string) => this.params.get(id);
    this.host.showDepth(this.params.get(this.route.depthParam), sourceBipolar(src, get));
  }

  /* ---------- pointer ---------- */

  /** returns true when assign mode handled the event (the control must not edit its value) */
  pointerDown(e: PointerEvent, opts: DragOpts): boolean {
    if (e.pointerType !== 'mouse' && e.button === 0 && !this.armed) this.startPress(e);
    if (!this.armed || e.button !== 0 || e.altKey || !api || this.state === 'blocked') return false;
    const src = assign.source!;
    const el = this.host.el;
    e.preventDefault();
    e.stopPropagation();
    (el.tabIndex >= 0 ? el : el.querySelector<HTMLElement>('select, [tabindex="0"]'))?.focus({ preventScroll: true });

    // touch / pen: double-tap removes, like double-click
    if (e.pointerType !== 'mouse') {
      if (e.timeStamp - this.lastTap < 300) {
        this.lastTap = 0;
        this.removeRoute();
        return true;
      }
      this.lastTap = e.timeStamp;
    }

    if (!this.route) {
      const r = api.addRoute(src, this.host.id, 0);
      if ('ok' in r) {
        showBubble(el, r.ok ? 'Could not add route' : r.reason, 'warn', 1800);
        return true;
      }
      this.route = r;
      announce(`${sourceLabel(src)} now modulates ${targetLabel(this.host.id)}. Drag to set depth.`);
    }
    const depthParam = this.route.depthParam;
    const target = (e.currentTarget as HTMLElement | null) ?? el;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    this.drag = { pointerId: e.pointerId, lastY: e.clientY, acc: this.params.getNorm(depthParam), el: target, depthParam, params: this.params };
    this.params.beginGesture(depthParam);
    el.classList.add('is-depth-drag');
    const fine = opts.fineFactor ?? 0.12;
    const range = Math.max(40, opts.dragRange);
    this.showDepthBubble();
    const move = (ev: PointerEvent) => {
      const d = this.drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      const dy = d.lastY - ev.clientY;
      d.lastY = ev.clientY;
      if (!dy) return;
      d.acc = Math.min(1.1, Math.max(-0.1, d.acc + (dy / range) * (ev.shiftKey ? fine : 1)));
      d.params.setNorm(d.depthParam, d.acc);
      this.showDepthBubble();
    };
    const up = (ev: PointerEvent) => {
      const d = this.drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      this.drag = null;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('lostpointercapture', up);
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      d.params.endGesture(d.depthParam);
      el.classList.remove('is-depth-drag');
      hideBubble(700);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    // the control may be re-rendered away mid-drag
    target.addEventListener('lostpointercapture', up);
    return true;
  }

  private showDepthBubble(): void {
    const src = assign.source;
    if (!this.route || !src) return;
    showBubble(this.host.el, `${sourceLabel(src)} → ${formatDepth(this.params.get(this.route.depthParam))}`);
  }

  /** double-click in assign mode removes the armed source's route */
  dblclick(e: MouseEvent): boolean {
    if (!this.armed || e.altKey || this.state === 'blocked') return false;
    e.preventDefault();
    this.removeRoute();
    return true;
  }

  /** wheel over a routed target changes the depth */
  wheel(e: WheelEvent): boolean {
    if (!this.armed || e.altKey || !this.route) return false;
    e.preventDefault();
    const id = this.route.depthParam;
    const d = this.params.get(id);
    const step = (e.shiftKey ? 0.01 : 0.03) * (e.deltaY > 0 ? -1 : 1);
    this.params.beginGesture(id);
    this.params.set(id, Math.max(-1, Math.min(1, d + step)));
    this.params.endGesture(id);
    this.showDepthBubble();
    hideBubble(900);
    return true;
  }

  private removeRoute(): void {
    const src = assign.source;
    if (!api || !src) return;
    const r = api.routesTo(this.host.id).find((x) => x.source === src);
    if (!r) return;
    api.removeRoute(r.slot);
    showBubble(this.host.el, `${sourceLabel(src)} removed`, 'mod', 900);
    announce(`Removed ${sourceLabel(src)} from ${targetLabel(this.host.id)}`);
  }

  /* ---------- keyboard ---------- */

  keydown(e: KeyboardEvent): boolean {
    if (!this.armed || !api || e.altKey) return false;
    const src = assign.source!;
    const name = sourceLabel(src);
    const target = targetLabel(this.host.id);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.state === 'blocked') {
        announce(this.host.el.title);
        showBubble(this.host.el, this.host.el.title, 'warn', 1800);
      } else if (!this.route) {
        const r = api.addRoute(src, this.host.id, 0.5);
        if ('ok' in r) announce(r.ok ? '' : r.reason);
        else {
          announce(`${name} now modulates ${target} at 50 percent. Arrow keys change the depth, Delete removes it.`);
          this.route = r;
          this.showDepthBubble();
          hideBubble(1200);
        }
      } else {
        announce(`${name} modulates ${target} at ${Math.round(this.params.get(this.route.depthParam) * 100)} percent`);
      }
      return true;
    }
    if (!this.route) return false;
    const id = this.route.depthParam;
    let step = 0;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        step = e.shiftKey ? 0.01 : 0.05;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        step = e.shiftKey ? -0.01 : -0.05;
        break;
      case 'PageUp':
        step = 0.25;
        break;
      case 'PageDown':
        step = -0.25;
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.removeRoute();
        return true;
      default:
        return false;
    }
    e.preventDefault();
    this.params.beginGesture(id);
    this.params.set(id, Math.max(-1, Math.min(1, this.params.get(id) + step)));
    this.params.endGesture(id);
    this.showDepthBubble();
    hideBubble(1000);
    announce(`Depth ${Math.round(this.params.get(id) * 100)} percent`);
    return true;
  }

  /* ---------- route list: right-click / context-menu key / long-press ---------- */

  private onContext = (e: MouseEvent): void => {
    if (!api || !store || !openParamRoutes) return;
    const spec = this.params.spec(this.host.id);
    if (!spec.modulatable && !api.routesTo(this.host.id).length) return;
    e.preventDefault();
    this.cancelPress();
    // keyboard-invoked context menus report 0/0: anchor to the control instead
    const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined;
    openParamRoutes(this.host.el, this.host.id, api, store, at);
  };

  private startPress(e: PointerEvent): void {
    this.cancelPress();
    const timer = window.setTimeout(() => {
      const p = this.press;
      this.press = null;
      if (!p || !api || !store || !openParamRoutes) return;
      if (!this.params.spec(this.host.id).modulatable && !api.routesTo(this.host.id).length) return;
      // end the value drag the control started, then show the list
      this.host.el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: p.pointerId, bubbles: true }));
      openParamRoutes(this.host.el, this.host.id, api, store, { x: p.x, y: p.y });
    }, 550);
    this.press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer };
    window.addEventListener('pointermove', this.onPressMove);
    window.addEventListener('pointerup', this.cancelPress);
    window.addEventListener('pointercancel', this.cancelPress);
  }

  private onPressMove = (e: PointerEvent): void => {
    const p = this.press;
    if (p && e.pointerId === p.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) this.cancelPress();
  };

  private cancelPress = (): void => {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
    window.removeEventListener('pointermove', this.onPressMove);
    window.removeEventListener('pointerup', this.cancelPress);
    window.removeEventListener('pointercancel', this.cancelPress);
  };
}
