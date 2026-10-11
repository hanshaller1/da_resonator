/**
 * Route bookkeeping shared by the real engine and the UI mock engine:
 * fixed route slots (depth = param `route{slot}.depth`), trigger routes, validation.
 */
import { NUM_ROUTES } from '../paramdefs/modules';
import { PARAMS, PARAM_BY_ID, paramIndex } from '../params';
import { checkRoute, checkTriggerRoute, type ModConfig, type RouteCheck, type RouteConfig, type TriggerRouteConfig } from './rules';
import { MAX_TRIGGER_ROUTES, SOURCES, SOURCE_BY_ID, TRIGGER_INS, TRIGGER_IN_BY_ID, TRIGGER_OUTS, TRIGGER_OUT_BY_ID } from './sources';

export interface RouteInfo {
  slot: number;
  /** source id ('lfo1' …) */
  source: string;
  /** target param id */
  target: string;
  /** param id holding the depth (-1..1) */
  depthParam: string;
}
export interface TriggerRouteInfo {
  /** trigger output id ('cmod1.step') */
  source: string;
  /** trigger input id ('lfo2.reset') */
  target: string;
}

export const routeDepthId = (slot: number) => `route${slot}.depth`;

export class ModRouting {
  private slots: (RouteConfig | null)[] = new Array(NUM_ROUTES).fill(null);
  private trig: TriggerRouteConfig[] = [];
  private cbs = new Set<() => void>();

  /** current config (fresh object, safe to post to the worklet) */
  config(): ModConfig {
    return { routes: this.slots.filter((r): r is RouteConfig => !!r).map((r) => ({ ...r })), triggers: this.trig.map((t) => ({ ...t })) };
  }

  onChange(cb: () => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
  private emit() {
    for (const cb of this.cbs) cb();
  }

  routes(): RouteInfo[] {
    const out: RouteInfo[] = [];
    this.slots.forEach((r, slot) => {
      if (r) out.push({ slot, source: SOURCES[r.src].id, target: PARAMS[r.dst].id, depthParam: routeDepthId(slot) });
    });
    return out;
  }
  triggerRoutes(): TriggerRouteInfo[] {
    return this.trig.map((t) => ({ source: TRIGGER_OUTS[t.src].id, target: TRIGGER_INS[t.dst].id }));
  }

  canRoute(source: string, target: string): RouteCheck {
    const s = SOURCE_BY_ID[source];
    const p = PARAM_BY_ID[target];
    if (!s || !p) return { ok: false, reason: 'Unknown source or target' };
    if (!this.slots.includes(null)) return { ok: false, reason: `All ${NUM_ROUTES} modulation slots are in use` };
    return checkRoute(this.config(), s.index, p.index);
  }

  /** returns the new route, or the reason it was refused */
  addRoute(source: string, target: string): RouteInfo | RouteCheck {
    const c = this.canRoute(source, target);
    if (!c.ok) return c;
    const slot = this.slots.indexOf(null);
    this.slots[slot] = { slot, src: SOURCE_BY_ID[source].index, dst: paramIndex(target) };
    this.emit();
    return { slot, source, target, depthParam: routeDepthId(slot) };
  }

  removeRoute(slot: number): void {
    if (!this.slots[slot]) return;
    this.slots[slot] = null;
    this.emit();
  }

  canTriggerRoute(source: string, target: string): RouteCheck {
    const o = TRIGGER_OUT_BY_ID[source];
    const i = TRIGGER_IN_BY_ID[target];
    if (!o || !i) return { ok: false, reason: 'Unknown trigger port' };
    if (this.trig.length >= MAX_TRIGGER_ROUTES) return { ok: false, reason: 'All trigger routes are in use' };
    return checkTriggerRoute(this.config(), o.index, i.index);
  }
  addTriggerRoute(source: string, target: string): RouteCheck {
    const c = this.canTriggerRoute(source, target);
    if (!c.ok) return c;
    this.trig.push({ src: TRIGGER_OUT_BY_ID[source].index, dst: TRIGGER_IN_BY_ID[target].index });
    this.emit();
    return c;
  }
  removeTriggerRoute(source: string, target: string): void {
    const o = TRIGGER_OUT_BY_ID[source]?.index;
    const i = TRIGGER_IN_BY_ID[target]?.index;
    const n = this.trig.length;
    this.trig = this.trig.filter((t) => !(t.src === o && t.dst === i));
    if (this.trig.length !== n) this.emit();
  }

  /** replace everything (presets). Invalid / looping entries are dropped and returned. */
  load(routes: { slot?: number; source: string; target: string }[], triggers: TriggerRouteInfo[] = []): string[] {
    const dropped: string[] = [];
    this.slots = new Array(NUM_ROUTES).fill(null);
    this.trig = [];
    for (const r of routes) {
      const s = SOURCE_BY_ID[r.source];
      const p = PARAM_BY_ID[r.target];
      const slot = r.slot !== undefined && r.slot >= 0 && r.slot < NUM_ROUTES && !this.slots[r.slot] ? r.slot : this.slots.indexOf(null);
      if (!s || !p || slot < 0 || !checkRoute(this.config(), s.index, p.index).ok) {
        dropped.push(`${r.source} → ${r.target}`);
        continue;
      }
      this.slots[slot] = { slot, src: s.index, dst: p.index };
    }
    for (const t of triggers) {
      const o = TRIGGER_OUT_BY_ID[t.source];
      const i = TRIGGER_IN_BY_ID[t.target];
      if (!o || !i || this.trig.length >= MAX_TRIGGER_ROUTES || !checkTriggerRoute(this.config(), o.index, i.index).ok) {
        dropped.push(`${t.source} → ${t.target}`);
        continue;
      }
      this.trig.push({ src: o.index, dst: i.index });
    }
    this.emit();
    return dropped;
  }

  clear(): void {
    this.load([], []);
  }
}
