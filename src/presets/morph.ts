/**
 * Morph from the live sound to a snapshot (docs/hardware-modi-und-pools-2026-10-16.md, point 10A).
 * - Every continuous param glides in its normalised range (a frequency glides in octaves, a fader in
 *   its fader travel); switches and choices (ON, type, mode, clock …) jump at the start.
 * - Routes: one in both glides its depth; one only in the old sound fades to 0, one only in the new
 *   one is added at the start with depth 0 and fades in (unless the routing refuses it, e.g. a loop
 *   with an old route: then it arrives at the end). Routes onto a route depth, trigger routes and module
 *   state (macro names …) arrive at the end.
 * The caller loads the snapshot at the end, so the sound lands exactly on it (presets/session.ts).
 */
import type { EngineSnapshot, RouteChannel, RouteCheck, RouteInfo } from '../core/types';
import { PARAMS, fromNorm, toNorm, type ParamSpec } from '../shared/params';

/** the part of the engine a morph drives */
export interface MorphEngine {
  readonly params: {
    get(id: string): number;
    set(id: string, plain: number): void;
  };
  readonly mod: {
    routes(): RouteInfo[];
    addRoute(source: string, target: string, depth?: number, ch?: RouteChannel): RouteInfo | RouteCheck;
    setRouteChannel(slot: number, ch: RouteChannel): void;
  };
}

interface Lane {
  spec: ParamSpec;
  a: number;
  b: number;
}

const ROUTE_DEPTH = /^route\d+\.depth$/;
const routeKey = (r: { source: string; target: string }) => `${r.source}>${r.target}`;
const isRouteInfo = (r: RouteInfo | RouteCheck): r is RouteInfo => 'slot' in r;

export class Morph {
  private lanes: Lane[] = [];

  /** sets up the morph (switches jump, new routes come in at depth 0); `at(k)` moves it */
  constructor(
    private engine: MorphEngine,
    to: EngineSnapshot,
  ) {
    const p = engine.params;
    for (const spec of PARAMS) {
      if (ROUTE_DEPTH.test(spec.id)) continue;
      const v = to.params[spec.id];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (spec.curve === 'toggle' || spec.curve === 'discrete') {
        p.set(spec.id, v);
        continue;
      }
      const a = toNorm(spec, p.get(spec.id));
      const b = toNorm(spec, Math.min(spec.max, Math.max(spec.min, v)));
      if (a !== b) this.lanes.push({ spec, a, b });
    }

    // routes, matched by source and target (routes onto a route depth arrive at the end)
    const live = engine.mod.routes().filter((r) => !ROUTE_DEPTH.test(r.target));
    const used = new Set<number>();
    const depthSpec = (slot: number) => PARAMS.find((s) => s.id === `route${slot}.depth`);
    const lane = (slot: number, from: number, toDepth: number) => {
      const spec = depthSpec(slot);
      if (spec && from !== toDepth) this.lanes.push({ spec, a: toNorm(spec, from), b: toNorm(spec, toDepth) });
    };
    for (const r of to.routes) {
      if (ROUTE_DEPTH.test(r.target)) continue;
      const depth = to.params[`route${r.slot}.depth`] ?? 0;
      const ch = r.ch ?? 'LR';
      const old = live.find((x) => !used.has(x.slot) && routeKey(x) === routeKey(r));
      if (old) {
        used.add(old.slot);
        if (old.ch !== ch) engine.mod.setRouteChannel(old.slot, ch);
        lane(old.slot, p.get(old.depthParam), depth);
        continue;
      }
      const added = engine.mod.addRoute(r.source, r.target, 0, ch);
      if (isRouteInfo(added)) {
        used.add(added.slot);
        lane(added.slot, 0, depth);
      }
    }
    for (const r of live) if (!used.has(r.slot)) lane(r.slot, p.get(r.depthParam), 0);
  }

  /** move to k (0 = start, 1 = the new values) */
  at(k: number): void {
    const t = Math.min(1, Math.max(0, k));
    const p = this.engine.params;
    for (const l of this.lanes) p.set(l.spec.id, fromNorm(l.spec, l.a + (l.b - l.a) * t));
  }

  /** number of gliding values (params and route depths) */
  get size(): number {
    return this.lanes.length;
  }
}
