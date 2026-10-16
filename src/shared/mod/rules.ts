/**
 * Who may modulate whom (docs/plan-modulation-und-module.md, 4.2) and the modulation graph.
 * Used by the main thread (validation, greying out targets in the UI) and by the worklet
 * (evaluation order). Pure functions, no DOM.
 */
import { NUM_CMODS, NUM_LFOS } from '../paramdefs/modules';
import { PARAMS, type ParamSpec } from '../params';
import { SOURCES, TRIGGER_INS, TRIGGER_OUTS, type ModSourceSpec } from './sources';

/**
 * Channel of a route onto a param with an R twin (L/R per band): both alike, only L, only R, or
 * INV (R moves against L). Routes onto other params always use CH_LR.
 */
export const ROUTE_CHANNELS = ['LR', 'L', 'R', 'INV'] as const;
export type RouteChannel = (typeof ROUTE_CHANNELS)[number];
export const CH_LR = 0;
export const CH_L = 1;
export const CH_R = 2;
export const CH_INV = 3;

/** value route: source → param, depth lives in param `route{slot}.depth` */
export interface RouteConfig {
  slot: number;
  /** index into SOURCES */
  src: number;
  /** index into PARAMS (the L param of a pair) */
  dst: number;
  /** index into ROUTE_CHANNELS; missing = CH_LR */
  ch?: number;
}

/** does a route with channel `ch` move the L param / the R twin of its target? */
export function routeHitsL(ch: number | undefined): boolean {
  return ch !== CH_R;
}
export function routeHitsR(ch: number | undefined): boolean {
  return ch !== CH_L;
}
/** trigger route: trigger output → trigger input */
export interface TriggerRouteConfig {
  /** index into TRIGGER_OUTS */
  src: number;
  /** index into TRIGGER_INS */
  dst: number;
}
export interface ModConfig {
  routes: RouteConfig[];
  triggers: TriggerRouteConfig[];
}

export type RouteCheck = { ok: true } | { ok: false; reason: string };
const OK: RouteCheck = { ok: true };
const no = (reason: string): RouteCheck => ({ ok: false, reason });

/** class rules only (no graph): may source `src` ever modulate param `dst`? */
export function classAllows(src: ModSourceSpec, dst: ParamSpec): RouteCheck {
  if (dst.modClass === 'macro') return no('Macros are never modulated');
  if (!dst.modulatable || dst.curve === 'toggle') return no(`${dst.label} can't be modulated`);
  if (dst.module === src.module) return no(`${src.label} can't modulate itself`);
  if (dst.modClass === 'clock' && src.cls !== 'macro') return no('Only macros may change the tempo');
  if (dst.curve === 'discrete' && src.cls !== 'macro' && src.cls !== 'cmod') return no('Stepped settings follow only macros and clock mods');
  if (src.cls === 'dyn' && dst.modClass === 'dyn') return no('Gain reduction may not modulate the dynamics');
  return OK;
}

/** graph node a value route ends in */
export function targetNode(dst: ParamSpec): string {
  return dst.module;
}
export const routeNode = (slot: number) => `route${slot}`;

/** implicit edges: the clock feeds every tempo-synced module */
function implicitEdges(): [string, string][] {
  const e: [string, string][] = [];
  for (let n = 1; n <= NUM_LFOS; n++) e.push(['clock', `lfo${n}`]);
  for (let n = 1; n <= NUM_CMODS; n++) e.push(['clock', `cmod${n}`]);
  return e;
}

function edgesOf(cfg: ModConfig): [string, string][] {
  const e = implicitEdges();
  for (const r of cfg.routes) {
    const rn = routeNode(r.slot);
    e.push([SOURCES[r.src].node, rn], [rn, targetNode(PARAMS[r.dst])]);
  }
  for (const t of cfg.triggers) e.push([TRIGGER_OUTS[t.src].node, TRIGGER_INS[t.dst].node]);
  return e;
}

function adjacency(edges: [string, string][]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    let l = adj.get(a);
    if (!l) adj.set(a, (l = []));
    l.push(b);
  }
  return adj;
}

function reaches(adj: Map<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj.get(n) ?? []) {
      if (m === to) return true;
      if (!seen.has(m)) {
        seen.add(m);
        stack.push(m);
      }
    }
  }
  return false;
}

/** full check for a new value route against the current config */
export function checkRoute(cfg: ModConfig, src: number, dst: number): RouteCheck {
  const s = SOURCES[src];
  const p = PARAMS[dst];
  if (!s || !p) return no('Unknown source or target');
  const c = classAllows(s, p);
  if (!c.ok) return c;
  if (cfg.routes.some((r) => r.src === src && r.dst === dst)) return no(`${s.label} already modulates ${p.label}`);
  // the new edge s.node → route → target closes a cycle iff target already reaches s.node
  if (reaches(adjacency(edgesOf(cfg)), targetNode(p), s.node)) return no(`That would create a loop back into ${s.label}`);
  return OK;
}

export function checkTriggerRoute(cfg: ModConfig, src: number, dst: number): RouteCheck {
  const o = TRIGGER_OUTS[src];
  const i = TRIGGER_INS[dst];
  if (!o || !i) return no('Unknown trigger port');
  if (o.node === i.node) return no(`${o.label} can't reset its own module`);
  if (cfg.triggers.some((t) => t.src === src && t.dst === dst)) return no('Trigger route exists already');
  if (reaches(adjacency(edgesOf(cfg)), i.node, o.node)) return no(`That would create a loop back into ${o.label}`);
  return OK;
}

/**
 * Topological evaluation order of all graph nodes (sources, routes, the clock, sinks).
 * Throws if the config contains a cycle (cannot happen when routes go through checkRoute).
 */
export function evaluationOrder(cfg: ModConfig): string[] {
  const edges = edgesOf(cfg);
  const nodes = new Set<string>(['clock']);
  for (const s of SOURCES) nodes.add(s.node);
  for (const [a, b] of edges) {
    nodes.add(a);
    nodes.add(b);
  }
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const [, b] of edges) indeg.set(b, indeg.get(b)! + 1);
  const adj = adjacency(edges);
  const queue = [...nodes].filter((n) => indeg.get(n) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      const d = indeg.get(m)! - 1;
      indeg.set(m, d);
      if (d === 0) queue.push(m);
    }
  }
  if (order.length !== nodes.size) throw new Error('modulation graph has a cycle');
  return order;
}
