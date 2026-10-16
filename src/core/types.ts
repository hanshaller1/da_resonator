/**
 * Public interfaces between the core engine and the UI.
 * The UI must only depend on these (plus src/shared/*), never on engine internals.
 */
import type { ParamSpec } from '../shared/params';
import type { MeterFrame } from '../shared/messages';
import type { RouteChannel, RouteCheck } from '../shared/mod/rules';
import type { RouteInfo, TriggerRouteInfo } from '../shared/mod/routing';
import type { ModSourceSpec, TriggerPortSpec } from '../shared/mod/sources';

export type { RouteChannel, RouteCheck, RouteInfo, TriggerRouteInfo, ModSourceSpec, TriggerPortSpec };

export type Unsubscribe = () => void;

export interface ParamStoreAPI {
  readonly specs: readonly ParamSpec[];
  spec(id: string): ParamSpec;
  /** plain value (dB, Hz, 0..1 …) */
  get(id: string): number;
  getNorm(id: string): number;
  set(id: string, plain: number): void;
  setNorm(id: string, norm: number): void;
  reset(id: string): void;
  /** value after modulation, normalized 0..1 (for UI mod rings); equals getNorm when unmodulated */
  getEffectiveNorm(id: string): number;
  /** true if any modulation route targets this param */
  isModulated(id: string): boolean;
  /** called with the new plain value whenever the base value changes */
  subscribe(id: string, cb: (plain: number) => void): Unsubscribe;
  /** called whenever any base value changes */
  subscribeAll(cb: (id: string, plain: number) => void): Unsubscribe;
  /** gestures: lets future undo / automation recording group changes */
  beginGesture(id: string): void;
  endGesture(id: string): void;
}

export interface MeterBusAPI {
  subscribe(cb: (f: MeterFrame) => void): Unsubscribe;
  latest(): MeterFrame | null;
}

export type SourceKind = 'pulses' | 'noise' | 'drums' | 'chords' | 'file' | 'mic';

export interface SourceInfo {
  kind: SourceKind;
  label: string;
  /** test sources are generated in the browser */
  builtin: boolean;
}

export type EngineState = 'idle' | 'running' | 'suspended' | 'error';

/** which channels of an audio input reach the resonator (L or R goes to both sides) */
export type InputChannels = 'stereo' | 'left' | 'right';

export interface AudioInputInfo {
  /** browser device id */
  id: string;
  /** device name as the system shows it */
  label: string;
  /** an Elektron device (Digitakt, Digitone, Syntakt, Analog Rytm / Four / Heat …) */
  elektron: boolean;
}

/**
 * Live audio inputs: interfaces, synths, Elektron devices over USB. The source kind of an input is
 * 'mic'. Device, channels and AUTO are remembered between visits.
 */
export interface InputAPI {
  /** this page may use audio input at all (needs https or a local file; an embedded window needs its host's permission) */
  readonly supported: boolean;
  /** the browser has allowed audio input, so the devices are listed */
  readonly allowed: boolean;
  /** the browser lists devices without names (Elektron devices can't be recognised then) */
  readonly namesHidden: boolean;
  /** inputs of this computer; empty until allowed */
  readonly devices: readonly AudioInputInfo[];
  /** off: no input open (the source is something else, or audio has not started) · open: an input runs · waiting: the chosen device is not connected */
  readonly status: 'off' | 'open' | 'waiting';
  /** the chosen device ('' = system default) and its name */
  readonly deviceId: string;
  readonly label: string;
  /** channels the open device delivers (0 when unknown or closed) */
  readonly deviceChannels: number;
  readonly channels: InputChannels;
  /** an Elektron device becomes the input when it is plugged in and when audio starts */
  readonly autoElektron: boolean;
  /** make a device the source; '' = automatic (Elektron with AUTO, else the last device, else the default). Asks for access if needed */
  use(deviceId: string): Promise<void>;
  /** read the device list again (a plugged-in Elektron device takes over with AUTO) */
  rescan(): Promise<void>;
  /** what the browser reports (browser, page, access, raw device list), to find out why a device is missing */
  report(): Promise<string[]>;
  setChannels(c: InputChannels): void;
  setAutoElektron(on: boolean): void;
  /** device list, choice, status, channels or AUTO changed */
  onChange(cb: () => void): Unsubscribe;
  /** something to tell the user (a device plugged in or out, a device that could not be opened) */
  onNotice(cb: (msg: string, tone: 'info' | 'error') => void): Unsubscribe;
}

export interface EngineAPI {
  readonly params: ParamStoreAPI;
  readonly meters: MeterBusAPI;
  readonly sources: readonly SourceInfo[];
  /** must be called from a user gesture (creates/resumes the AudioContext) */
  start(): Promise<void>;
  readonly state: EngineState;
  onStateChange(cb: (s: EngineState) => void): Unsubscribe;
  readonly sampleRate: number;

  /** currently selected source */
  readonly source: SourceKind;
  onSourceChange(cb: (k: SourceKind, label: string) => void): Unsubscribe;
  setSource(kind: Exclude<SourceKind, 'file'>): Promise<void>;
  loadFile(file: File): Promise<void>;
  /** play/pause the current source (input: mute/unmute) */
  setPlaying(on: boolean): void;
  readonly playing: boolean;
  onPlayingChange(cb: (on: boolean) => void): Unsubscribe;
  /** source monitor level 0..1 (pre-resonator) */
  setSourceLevel(v: number): void;
  /** audio inputs (the 'mic' source) */
  readonly input: InputAPI;

  /** stop all feedback (band FB to 0, Feedback All off) and clear all filter / feedback state */
  panic(): void;

  /** post-resonator analyser for visualisation (null before start) */
  readonly analyserOut: AnalyserNode | null;
  /** pre-resonator analyser (null before start) */
  readonly analyserIn: AnalyserNode | null;

  /** modulation: sources, routes, live values */
  readonly mod: ModAPI;

  /** full snapshot (params, routes, module UI state) – the preset format */
  getState(): EngineSnapshot;
  /** restore a snapshot; also accepts the v1 format (flat { paramId: value }) */
  setState(s: EngineSnapshot | Record<string, number>): void;
  /** modules with state outside params (macro names …) plug into snapshots here */
  registerStateProvider(key: string, p: StateProvider): Unsubscribe;
}

export interface ModAPI {
  readonly sources: readonly ModSourceSpec[];
  readonly triggerOuts: readonly TriggerPortSpec[];
  readonly triggerIns: readonly TriggerPortSpec[];
  routes(): RouteInfo[];
  routesTo(target: string): RouteInfo[];
  routesFrom(source: string): RouteInfo[];
  /** may `source` modulate param `target` right now (rules + loop check)? */
  canRoute(source: string, target: string): RouteCheck;
  /**
   * creates the route with the given depth (-1..1, default 0.5) and, on an L/R pair, channel
   * (default L+R); returns the reason if refused
   */
  addRoute(source: string, target: string, depth?: number, ch?: RouteChannel): RouteInfo | RouteCheck;
  removeRoute(slot: number): void;
  /** channel of a route onto an L/R pair (L+R, L, R, INV); ignored on other targets */
  setRouteChannel(slot: number, ch: RouteChannel): void;
  triggerRoutes(): TriggerRouteInfo[];
  canTriggerRoute(source: string, target: string): RouteCheck;
  addTriggerRoute(source: string, target: string): RouteCheck;
  removeTriggerRoute(source: string, target: string): void;
  /** latest value of a source (bipolar -1..1 or unipolar 0..1) */
  sourceValue(source: string): number;
  /** clock position in beats and tempo from the latest readout */
  readonly beats: number;
  readonly bpm: number;
  resetClock(): void;
  /** routes changed */
  onChange(cb: () => void): Unsubscribe;
  /** a modulation readout arrived (~60 Hz while running) */
  onReadout(cb: () => void): Unsubscribe;
}

export interface StateProvider {
  getState(): unknown;
  /** called with undefined when a snapshot has no entry for this key (reset to defaults) */
  setState(s: unknown): void;
}

export interface EngineSnapshot {
  format: 'da-resonator';
  /** 4 since 2026-10-16, L/R per band (older ones are migrated on load, core/state.ts) */
  version: number;
  /** base value of every param, by id */
  params: Record<string, number>;
  /** ch: channel of a route onto an L/R pair, missing = L+R */
  routes: { slot: number; source: string; target: string; ch?: RouteChannel }[];
  triggers: TriggerRouteInfo[];
  /** state of registered providers (macro names …) */
  modules: Record<string, unknown>;
}
