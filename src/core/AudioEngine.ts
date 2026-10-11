import workletCode from '../dsp/resonator.worklet.ts?worklet';
import { WORKLET_NAME, type FromWorklet, type MeterFrame, type ToWorklet } from '../shared/messages';
import { NUM_BANDS, bandParamId } from '../shared/params';
import { Emitter } from './Emitter';
import { InputDevices, cleanLabel, inputAllowedHere, pageStorage } from './inputs';
import { InsertChain } from './InsertChain';
import { ModController } from './ModController';
import { ParamStore } from './ParamStore';
import { StateHub } from './state';
import { renderTestSignal, type TestSignalKind } from './testSignals';
import type { AudioInputInfo, EngineAPI, EngineSnapshot, EngineState, InputChannels, MeterBusAPI, SourceInfo, SourceKind, StateProvider, Unsubscribe } from './types';

class MeterBus implements MeterBusAPI {
  private e = new Emitter<[MeterFrame]>();
  private last: MeterFrame | null = null;
  subscribe(cb: (f: MeterFrame) => void): Unsubscribe {
    return this.e.on(cb);
  }
  latest(): MeterFrame | null {
    return this.last;
  }
  push(f: MeterFrame): void {
    this.last = f;
    this.e.emit(f);
  }
}

const SOURCES: SourceInfo[] = [
  { kind: 'pulses', label: 'Pulses', builtin: true },
  { kind: 'drums', label: 'Drums', builtin: true },
  { kind: 'chords', label: 'Chords', builtin: true },
  { kind: 'noise', label: 'Pink noise', builtin: true },
  { kind: 'file', label: 'Audio file…', builtin: false },
  { kind: 'mic', label: 'Audio input', builtin: false },
];

/** an instrument input: no voice processing, both channels if the device has them */
function inputConstraints(deviceId: string): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
  };
}

/**
 * Signal flow:
 *   source -> sourceGain -> analyserIn -> preInserts -> [worklet: pre filter -> resonator -> post filter] -> postInserts -> analyserOut -> destination
 *
 * Everything the instrument does (resonator, band dynamics, filters, LFOs, clock mods, env followers,
 * macros, clock) runs inside the worklet and is controlled by params (shared/params.ts) plus the
 * modulation routes (engine.mod). The main thread only sends base values and the route config.
 * preInserts / postInserts remain for external Web Audio nodes.
 */
export class AudioEngine implements EngineAPI {
  readonly params = new ParamStore();
  readonly meters = new MeterBus();
  readonly mod: ModController = new ModController(
    this.params,
    (config) => this.post({ type: 'modConfig', config }),
    () => this.post({ type: 'clockReset' }),
  );
  private stateHub = new StateHub(this.params, this.mod);
  readonly sources = SOURCES;
  readonly input = new InputDevices(
    typeof navigator !== 'undefined' && inputAllowedHere() ? navigator.mediaDevices : undefined,
    pageStorage(),
    (id) => this.useInput(id),
  );

  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  preInserts: InsertChain | null = null;
  postInserts: InsertChain | null = null;
  analyserIn: AnalyserNode | null = null;
  analyserOut: AnalyserNode | null = null;

  private _state: EngineState = 'idle';
  private stateE = new Emitter<[EngineState]>();
  private _source: SourceKind = 'pulses';
  private sourceLabel = 'Pulses';
  private sourceE = new Emitter<[SourceKind, string]>();
  private _playing = true;
  private playingE = new Emitter<[boolean]>();

  private sourceGain: GainNode | null = null;
  private bufferNode: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private inStream: MediaStream | null = null;
  private inNode: MediaStreamAudioSourceNode | null = null;
  /** channel pick between inNode and sourceGain (empty for stereo) */
  private inRoute: AudioNode[] = [];
  /** the input node that feeds sourceGain */
  private inOut: AudioNode | null = null;
  private routed: InputChannels | null = null;
  private bufferCache = new Map<string, AudioBuffer>();

  private sentVersion = -1;
  private flushQueued = false;
  private starting: Promise<void> | null = null;

  constructor() {
    // base values go to the worklet once per task, however many params changed
    this.params.subscribeAll(() => {
      if (this.flushQueued) return;
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        this.flushParams(false);
      });
    });

    // an input that was the source last time is the source again; it opens when audio starts
    if (this.input.active) {
      this._source = 'mic';
      this.sourceLabel = this.input.label || 'Audio input';
    }
    this.input.onArrive((devices) => void this.inputsArrived(devices));
    this.input.onChange(() => {
      if (this.inNode && this.routed !== this.routeMode()) this.routeInput();
    });
    // with AUTO, a connected Elektron device is the source from the start (names need earlier access)
    void this.input.refresh().then(() => {
      const el = this.input.autoElektron ? this.input.elektron() : undefined;
      if (el && !this.ctx) void this.useInput(el.id);
    });
  }

  get state() { return this._state; }
  get source() { return this._source; }
  get playing() { return this._playing; }
  get sampleRate() { return this.ctx?.sampleRate ?? 48000; }

  onStateChange(cb: (s: EngineState) => void) { return this.stateE.on(cb); }
  onSourceChange(cb: (k: SourceKind, label: string) => void) { return this.sourceE.on(cb); }
  onPlayingChange(cb: (on: boolean) => void) { return this.playingE.on(cb); }

  private setStateInternal(s: EngineState) {
    this._state = s;
    this.stateE.emit(s);
  }

  start(): Promise<void> {
    if (this.ctx) {
      return this.ctx.resume().then(() => this.setStateInternal('running'));
    }
    return (this.starting ??= this.init().catch((e) => {
      console.error(e);
      this.starting = null;
      this.setStateInternal('error');
      throw e;
    }));
  }

  private async init() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Blob URL first; some sandboxed hosts only allow data: URLs for module scripts.
    const url = URL.createObjectURL(new Blob([workletCode], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } catch {
      await ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,' + encodeURIComponent(workletCode));
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.node = node;
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
      const m = e.data;
      if (m.type === 'meters') this.meters.push(m);
      else if (m.type === 'mod') this.mod.applyFrame(m);
    };
    node.onprocessorerror = (e) => {
      console.error('worklet error', e);
      this.setStateInternal('error');
    };

    this.sourceGain = new GainNode(ctx, { gain: 0.8 });
    this.analyserIn = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0.75 });
    this.analyserOut = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0.75 });
    this.preInserts = new InsertChain(ctx);
    this.postInserts = new InsertChain(ctx);

    this.sourceGain.connect(this.analyserIn);
    this.analyserIn.connect(this.preInserts.input);
    this.preInserts.output.connect(node);
    node.connect(this.postInserts.input);
    this.postInserts.output.connect(this.analyserOut);
    this.analyserOut.connect(ctx.destination);

    ctx.onstatechange = () => {
      this.setStateInternal(ctx.state === 'running' ? 'running' : ctx.state === 'suspended' ? 'suspended' : 'idle');
    };

    this.flushParams(true);
    this.post({ type: 'modConfig', config: this.mod.routing.config() });
    await ctx.resume();
    this.setStateInternal(ctx.state === 'running' ? 'running' : 'suspended');
    // start the chosen source: an input (asks for access if needed), a loaded file or a test signal
    if (this._source === 'mic') await this.startInput();
    else if (this._source === 'file' && this.currentBuffer) this.playBuffer(this.currentBuffer);
    else if (this._source !== 'file') await this.setSource(this._source);
  }

  /* ---------------- param transport ---------------- */

  private flushParams(force: boolean) {
    if (!this.node) return;
    if (!force && this.sentVersion === this.params.version) return;
    this.sentVersion = this.params.version;
    this.post({ type: 'params', values: this.params.baseValues() });
  }

  private post(m: ToWorklet) {
    this.node?.port.postMessage(m);
  }

  /* ---------------- sources ---------------- */

  private stopSource() {
    if (this.bufferNode) {
      try { this.bufferNode.stop(); } catch { /* already stopped */ }
      this.bufferNode.disconnect();
      this.bufferNode = null;
    }
    if (this.inNode) {
      this.inNode.disconnect();
      this.inNode = null;
    }
    for (const n of this.inRoute) n.disconnect();
    this.inRoute = [];
    this.inOut = null;
    this.routed = null;
    if (this.inStream) {
      const stream = this.inStream;
      this.inStream = null;
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  private setSourceInternal(kind: SourceKind, label: string) {
    if (kind !== 'mic') this.input.closed();
    this._source = kind;
    this.sourceLabel = label;
    this.sourceE.emit(kind, label);
  }

  private playBuffer(buf: AudioBuffer) {
    const ctx = this.ctx!;
    this.stopSource();
    this.currentBuffer = buf;
    if (!this._playing) return;
    const n = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    n.connect(this.sourceGain!);
    n.start();
    this.bufferNode = n;
  }

  async setSource(kind: Exclude<SourceKind, 'file'>): Promise<void> {
    if (kind === 'mic') return this.useInput('');
    const info = SOURCES.find((s) => s.kind === kind)!;
    if (!this.ctx) {
      this.setSourceInternal(kind, info.label);
      return;
    }
    let buf = this.bufferCache.get(kind);
    if (!buf) {
      buf = renderTestSignal(this.ctx, kind as TestSignalKind);
      this.bufferCache.set(kind, buf);
    }
    this.setSourceInternal(kind, info.label);
    this.playBuffer(buf);
  }

  async loadFile(file: File): Promise<void> {
    if (!this.ctx) await this.start();
    const data = await file.arrayBuffer();
    const buf = await this.ctx!.decodeAudioData(data);
    this.setSourceInternal('file', file.name);
    if (!this._playing) this.setPlaying(true);
    this.playBuffer(buf);
  }

  setPlaying(on: boolean): void {
    if (on === this._playing) return;
    this._playing = on;
    if (this.ctx) {
      if (this._source === 'mic') {
        if (on) this.inOut?.connect(this.sourceGain!);
        else this.inOut?.disconnect();
      } else if (on && this.currentBuffer) this.playBuffer(this.currentBuffer);
      else if (!on && this.bufferNode) {
        try { this.bufferNode.stop(); } catch { /* noop */ }
        this.bufferNode.disconnect();
        this.bufferNode = null;
      }
    }
    this.playingE.emit(on);
  }

  /* ---------------- audio inputs ---------------- */

  /**
   * Make an audio input the source. '' = automatic: an Elektron device (AUTO), else the last
   * device, else the system default. A remembered device that is not connected waits for its
   * return instead of falling back to another one (a laptop mic next to the speakers would howl).
   * Throws when access is refused or the device can't be opened; the current source keeps playing.
   */
  async useInput(deviceId: string): Promise<void> {
    if (!this.ctx) {
      // remembered; it opens when audio starts
      const d = deviceId ? this.input.find(deviceId) : undefined;
      if (deviceId) this.input.choose(deviceId, d?.label ?? '');
      else this.input.choose(this.input.deviceId, this.input.label);
      this.setSourceInternal('mic', this.input.label || 'Audio input');
      return;
    }
    const id = deviceId || this.input.autoChoice();
    if (id === null) return this.waitForInput();
    let stream: MediaStream;
    try {
      // ask first, so a refused permission leaves the current source playing
      stream = await navigator.mediaDevices.getUserMedia({ audio: inputConstraints(id) });
    } catch (e) {
      const name = (e as DOMException | null)?.name;
      // the remembered device is gone (only found out now when names were unknown)
      if (!deviceId && id && (name === 'OverconstrainedError' || name === 'NotFoundError')) return this.waitForInput();
      throw e;
    }
    this.attachInput(stream);
    await this.input.refresh(); // names appear with the first access
    const track = stream.getAudioTracks()[0];
    const set = track?.getSettings() ?? {};
    const dev = this.input.resolve(set.deviceId ?? id, track?.label ?? '');
    // first access with AUTO: an Elektron device whose name was unknown until now takes over
    if (!deviceId && this.input.autoElektron && !dev?.elektron) {
      const el = this.input.elektron();
      if (el) return this.useInput(el.id);
    }
    // (a mono device skips the channel pick: onChange re-routes)
    this.input.opened(dev?.id ?? set.deviceId ?? id, dev?.label ?? (cleanLabel(track?.label ?? '') || 'Audio input'), set.channelCount ?? 0);
    this.setSourceInternal('mic', this.input.label);
  }

  /** the input chosen before audio started; Pulses if it can't be opened */
  private async startInput() {
    try {
      await this.useInput('');
    } catch (e) {
      console.error(e);
      this.input.notice(`${this.input.label || 'The audio input'} could not be opened. Playing Pulses instead.`, 'error');
      await this.setSource('pulses');
    }
  }

  /** the remembered device is the source but not connected: silence until it is plugged in */
  private waitForInput() {
    this.stopSource();
    this.currentBuffer = null;
    this.input.waiting(this.input.deviceId, this.input.label);
    this.setSourceInternal('mic', this.input.label);
    this.input.notice(`${this.input.label} is not connected. It becomes the input when you plug it in.`);
  }

  private attachInput(stream: MediaStream) {
    this.stopSource();
    this.currentBuffer = null;
    this.inStream = stream;
    this.inNode = new MediaStreamAudioSourceNode(this.ctx!, { mediaStream: stream });
    this.routeInput();
    // unplugged, or taken away by the system
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.inputEnded(stream));
  }

  /** a mono device feeds both sides as it is; L or R of a stereo device goes to both sides */
  private routeMode(): InputChannels {
    return this.input.deviceChannels === 1 ? 'stereo' : this.input.channels;
  }

  /** inNode -> (channel pick) -> sourceGain */
  private routeInput() {
    const ctx = this.ctx;
    const src = this.inNode;
    if (!ctx || !src) return;
    src.disconnect();
    for (const n of this.inRoute) n.disconnect();
    this.inRoute = [];
    const mode = this.routeMode();
    let out: AudioNode = src;
    if (mode !== 'stereo') {
      const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
      const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
      const ch = mode === 'left' ? 0 : 1;
      src.connect(split);
      split.connect(merge, ch, 0);
      split.connect(merge, ch, 1);
      this.inRoute = [split, merge];
      out = merge;
    }
    this.inOut = out;
    this.routed = mode;
    if (this._playing) out.connect(this.sourceGain!);
  }

  private inputEnded(stream: MediaStream) {
    if (stream !== this.inStream) return;
    this.stopSource();
    this.input.waiting(this.input.deviceId, this.input.label);
    this.input.notice(`${this.input.label} disconnected. It becomes the input again when you plug it back in.`);
  }

  /** hot-plug: with AUTO an Elektron device takes over; the chosen device returns when plugged back in */
  private async inputsArrived(devices: AudioInputInfo[]) {
    const el = this.input.autoElektron ? devices.find((d) => d.elektron) : undefined;
    const back = this._source === 'mic' && !this.inStream ? devices.find((d) => d.id === this.input.deviceId || d.label === this.input.label) : undefined;
    const pick = el ?? back;
    if (!pick || (this.inStream && pick.id === this.input.deviceId)) return;
    if (!this.ctx) {
      await this.useInput(pick.id);
      this.input.notice(`${pick.label} connected. It is the input when audio starts.`);
      return;
    }
    try {
      await this.useInput(pick.id);
      this.input.notice(pick === back ? `${pick.label} is back.` : `${pick.label} connected and is now the input.`);
    } catch (e) {
      console.error(e);
      this.input.notice(`${pick.label} connected but could not be opened.`, 'error');
    }
  }

  setSourceLevel(v: number): void {
    if (this.sourceGain && this.ctx) this.sourceGain.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02);
  }

  panic(): void {
    // every band's feedback to 0 and Feedback All off (its amount is kept)
    for (let b = 0; b < NUM_BANDS; b++) this.params.set(bandParamId(b, 'fb'), 0);
    this.params.set('fbAllOn', 0);
    // the new values reach the worklet before the reset, so the loops restart without feedback
    this.flushParams(false);
    this.post({ type: 'reset' });
  }

  getState(): EngineSnapshot {
    return this.stateHub.get();
  }
  setState(s: EngineSnapshot | Record<string, number>): void {
    this.stateHub.set(s);
  }
  registerStateProvider(key: string, p: StateProvider): Unsubscribe {
    return this.stateHub.register(key, p);
  }

  get currentSourceLabel(): string {
    return this.sourceLabel;
  }

  dispose() {
    this.stopSource();
    void this.ctx?.close();
  }
}
