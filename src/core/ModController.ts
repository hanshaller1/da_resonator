import type { ModFrame } from '../shared/messages';
import { ModRouting, routeDepthId } from '../shared/mod/routing';
import { routeHitsL, routeHitsR, type ModConfig, type RouteChannel, type RouteCheck } from '../shared/mod/rules';
import { NUM_SOURCES, SOURCES, SOURCE_BY_ID, TRIGGER_INS, TRIGGER_OUTS } from '../shared/mod/sources';
import { NUM_PARAMS, PARAMS } from '../shared/params';
import { Emitter } from './Emitter';
import type { ParamStore } from './ParamStore';
import type { ModAPI, RouteInfo, Unsubscribe } from './types';

/**
 * Main-thread side of the modulation system: route bookkeeping and validation,
 * readouts for the UI. The modulation itself runs in the worklet (dsp/ModEngine.ts);
 * `send` delivers the route config there.
 */
export class ModController implements ModAPI {
  readonly sources = SOURCES;
  readonly triggerOuts = TRIGGER_OUTS;
  readonly triggerIns = TRIGGER_INS;
  readonly routing = new ModRouting();
  private srcVals = new Float32Array(NUM_SOURCES);
  private changed = new Emitter<[]>();
  private readout = new Emitter<[]>();
  /** internal clock: position, tempo, moving (ON and RUN) */
  beats = 0;
  bpm = 120;
  running = true;
  /** MIDI clock: position, measured tempo, moving (ON, Start / Stop) */
  midiBeats = 0;
  midiBpm = 120;
  midiRunning = false;

  constructor(
    private params: ParamStore,
    private send: (cfg: ModConfig) => void,
    private onResetClock: () => void = () => {},
  ) {
    this.routing.onChange(() => {
      const cfg = this.routing.config();
      const mask = new Uint8Array(NUM_PARAMS);
      for (const r of cfg.routes) {
        const tw = PARAMS[r.dst].twin;
        if (tw === undefined || routeHitsL(r.ch)) mask[r.dst] = 1;
        if (tw !== undefined && routeHitsR(r.ch)) mask[tw] = 1;
      }
      this.params.setModulated(mask);
      this.send(cfg);
      this.changed.emit();
    });
  }

  routes(): RouteInfo[] {
    return this.routing.routes();
  }
  routesTo(target: string): RouteInfo[] {
    return this.routes().filter((r) => r.target === target);
  }
  routesFrom(source: string): RouteInfo[] {
    return this.routes().filter((r) => r.source === source);
  }
  canRoute(source: string, target: string): RouteCheck {
    return this.routing.canRoute(source, target);
  }
  addRoute(source: string, target: string, depth = 0.5, ch: RouteChannel = 'LR') {
    const c = this.routing.canRoute(source, target);
    if (!c.ok) return c;
    // set the depth before the route goes live so it starts at the requested amount
    this.params.set(routeDepthId(this.nextFreeSlot()), Math.max(-1, Math.min(1, depth)));
    return this.routing.addRoute(source, target, ch);
  }
  setRouteChannel(slot: number, ch: RouteChannel): void {
    this.routing.setRouteChannel(slot, ch);
  }
  private nextFreeSlot(): number {
    const used = new Set(this.routing.routes().map((r) => r.slot));
    let s = 0;
    while (used.has(s)) s++;
    return s;
  }
  removeRoute(slot: number): void {
    this.routing.removeRoute(slot);
    this.params.set(routeDepthId(slot), 0);
  }
  triggerRoutes() {
    return this.routing.triggerRoutes();
  }
  canTriggerRoute(source: string, target: string) {
    return this.routing.canTriggerRoute(source, target);
  }
  addTriggerRoute(source: string, target: string) {
    return this.routing.addTriggerRoute(source, target);
  }
  removeTriggerRoute(source: string, target: string) {
    this.routing.removeTriggerRoute(source, target);
  }
  sourceValue(source: string): number {
    const s = SOURCE_BY_ID[source];
    return s ? this.srcVals[s.index] : 0;
  }
  resetClock(): void {
    this.onResetClock();
  }
  onChange(cb: () => void): Unsubscribe {
    return this.changed.on(cb);
  }
  onReadout(cb: () => void): Unsubscribe {
    return this.readout.on(cb);
  }

  /** worklet readout */
  applyFrame(f: ModFrame): void {
    this.srcVals.set(f.src.subarray(0, NUM_SOURCES));
    this.params.applyReadout(f.mod);
    this.beats = f.beats;
    this.bpm = f.bpm;
    this.running = f.run !== 0;
    this.midiBeats = f.midiBeats ?? 0;
    this.midiBpm = f.midiBpm ?? this.midiBpm;
    this.midiRunning = !!f.midiRun;
    this.readout.emit();
  }
}

