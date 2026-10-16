/**
 * Fake engine for UI development and screenshots. In-memory param store,
 * synthetic meters at ~30 Hz that react to faders / resonance / feedback,
 * no audio and no analysers.
 */
import { ModController } from '../core/ModController';
import { ParamStore } from '../core/ParamStore';
import { InputDevices } from '../core/inputs';
import { MidiService, clocksOn, type MidiInputLike } from '../core/midi';
import { StateHub } from '../core/state';
import type { EngineAPI, EngineState, MeterBusAPI, SourceInfo, SourceKind, Unsubscribe } from '../core/types';
import type { MeterFrame } from '../shared/messages';
import type { ModConfig } from '../shared/mod/rules';
import { MAX_BLOCK, ModEngine } from '../dsp/ModEngine';
import { NUM_BANDS, bandParamId, bandParamIdR, dbToGain } from '../shared/params';
import { bandResFb } from './response';

export interface MockEngineOptions {
  /** demo LFO modulation on a couple of params so mod rings can be seen */
  demoModulation?: boolean;
}

function emitter<A extends unknown[]>() {
  const set = new Set<(...a: A) => void>();
  return {
    on(cb: (...a: A) => void): Unsubscribe {
      set.add(cb);
      return () => set.delete(cb);
    },
    emit(...a: A) {
      for (const cb of set) cb(...a);
    },
  };
}

const PROFILES: Record<SourceKind, number[]> = {
  pulses: [0.5, 0.55, 0.6, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.25],
  noise: [0.3, 0.35, 0.4, 0.42, 0.45, 0.45, 0.45, 0.42, 0.4, 0.35],
  drums: [0.8, 0.7, 0.45, 0.35, 0.3, 0.3, 0.35, 0.4, 0.45, 0.4],
  chords: [0.15, 0.35, 0.6, 0.7, 0.65, 0.5, 0.35, 0.22, 0.12, 0.06],
  file: [0.5, 0.55, 0.55, 0.5, 0.5, 0.45, 0.4, 0.35, 0.3, 0.2],
  mic: [0.1, 0.2, 0.35, 0.45, 0.5, 0.45, 0.35, 0.25, 0.15, 0.1],
};

export function createMockEngine(opts: MockEngineOptions = { demoModulation: true }): EngineAPI {
  /* ---------- params + modulation (same classes as the real engine, simulated readouts) ---------- */
  const params = new ParamStore();
  // the real worklet modulation engine, driven by a timer instead of audio blocks
  // (no audio, so envelope followers and band dynamics stay at 0)
  const modEngine = new ModEngine(48000, (f) => mod.applyFrame(f));
  const mod = new ModController(
    params,
    (c: ModConfig) => modEngine.setConfig(c),
    () => modEngine.resetClock(),
  );
  const stateHub = new StateHub(params, mod);
  params.subscribeAll(() => modEngine.setBase(params.baseValues()));
  let lastMod = performance.now();
  let blockDebt = 0;
  const simulateMod = () => {
    const now = performance.now();
    blockDebt = Math.min(64, blockDebt + ((now - lastMod) / 1000) * (48000 / MAX_BLOCK));
    lastMod = now;
    for (; blockDebt >= 1; blockDebt--) {
      modEngine.beginBlock(MAX_BLOCK);
      modEngine.endBlock();
    }
  };
  if (opts.demoModulation) {
    params.set('lfo1.on', 1);
    params.set('lfo1.rate', 0.18);
    mod.addRoute('lfo1', 'band5.res', 0.22);
    params.set('lfo2.on', 1);
    params.set('lfo2.rate', 0.11);
    mod.addRoute('lfo2', 'spread', 0.125);
  }

  /* ---------- engine state ---------- */
  let state: EngineState = 'idle';
  let source: SourceKind = 'pulses';
  let playing = false;
  let srcLevel = 0.8;
  const stateEv = emitter<[EngineState]>();
  const sourceEv = emitter<[SourceKind, string]>();
  const playEv = emitter<[boolean]>();

  const sources: SourceInfo[] = [
    { kind: 'pulses', label: 'Pulses', builtin: true },
    { kind: 'noise', label: 'Pink noise', builtin: true },
    { kind: 'drums', label: 'Drum loop', builtin: true },
    { kind: 'chords', label: 'Chords', builtin: true },
    { kind: 'file', label: 'Audio file', builtin: false },
    { kind: 'mic', label: 'Audio input', builtin: false },
  ];

  /* ---------- audio inputs: three pretend devices, access granted on first use ---------- */
  const fakeInputs = [
    { kind: 'audioinput', deviceId: 'mock-builtin', label: 'MacBook Pro Microphone (Built-in)' },
    { kind: 'audioinput', deviceId: 'mock-digitakt', label: 'Elektron Digitakt (1935:000c)' },
    { kind: 'audioinput', deviceId: 'mock-scarlett', label: 'Scarlett 2i2 USB' },
  ];
  let inputsAllowed = false;
  const input: InputDevices = new InputDevices(
    {
      enumerateDevices: async () => (inputsAllowed ? fakeInputs : [{ kind: 'audioinput', deviceId: '', label: '' }]),
      addEventListener() {},
    },
    undefined,
    async (id) => {
      inputsAllowed = true;
      await input.refresh();
      const d = input.find(id || (input.autoChoice() ?? '')) ?? input.elektron() ?? input.devices[0];
      input.opened(d.id, input.fullName(d.id), 2);
      source = 'mic';
      sourceEv.emit('mic', d.label);
    },
  );

  /* ---------- MIDI: two pretend devices that send nothing, access granted on the first click ---------- */
  const fakeMidi = new Map<string, MidiInputLike>(
    [
      { id: 'mock-midi-digitakt', name: 'Elektron Digitakt', manufacturer: 'Elektron Music Machines', state: 'connected', onmidimessage: null },
      { id: 'mock-midi-iac', name: 'IAC Driver Bus 1', manufacturer: 'Apple Inc.', state: 'connected', onmidimessage: null },
    ].map((i) => [i.id, i]),
  );
  const midi = new MidiService(
    { request: async () => ({ inputs: fakeMidi, onstatechange: null }), permission: async () => 'prompt', allowed: true, now: () => performance.now() },
    params,
    (ev, ms) => modEngine.pushClock(ev, modEngine.now + (ms - performance.now()) / 1000),
  );
  const clockOn = () => {
    const on = clocksOn(midi);
    modEngine.setClockOn(on.int, on.midi);
  };
  clockOn();
  midi.onChange(clockOn);

  /* ---------- meters ---------- */
  const meterEv = emitter<[MeterFrame]>();
  let latest: MeterFrame | null = null;
  const env = new Float32Array(NUM_BANDS);
  const smooth = new Float32Array(NUM_BANDS);
  let inS = 0;
  let outS = 0;
  let timer = 0;

  const step = () => {
    const t = performance.now() / 1000;
    const prof = PROFILES[source];
    const active = state === 'running' && playing;
    const inGain = dbToGain(params.get('inputGain')) * srcLevel;
    let inSum = 0;
    let outSum = 0;
    let hot = false;
    const bands = new Float32Array(NUM_BANDS);
    for (let i = 0; i < NUM_BANDS; i++) {
      let e: number;
      switch (source) {
        case 'pulses': e = Math.exp(-((t * 2) % 1) * 5); break;
        case 'drums': {
          const beat = (t * 2.1) % 1;
          e = i < 3 ? Math.exp(-beat * 7) : i > 6 ? Math.exp(-((t * 4.2) % 1) * 12) : 0.4 + 0.3 * Math.exp(-((beat + 0.5) % 1) * 6);
          break;
        }
        case 'chords': e = 0.7 + 0.3 * Math.sin(t * 0.8 + i); break;
        default: e = 0.75 + 0.25 * Math.random();
      }
      e *= prof[i] * (0.85 + 0.3 * Math.random());
      env[i] = active ? e : env[i] * 0.85;
      const rf = bandResFb(params, i);
      const res = Math.min(1, Math.max(0, rf.res));
      const fb = Math.max(0, rf.fb);
      const lvl = env[i] * inGain * dbToGain(params.get(bandParamId(i, 'gain'))) * (0.55 + 1.3 * res) * (1 + 2.6 * fb * fb);
      smooth[i] = lvl > smooth[i] ? lvl : smooth[i] * 0.9 + lvl * 0.1;
      bands[i] = smooth[i] * 0.6;
      if (fb > 0.8 && smooth[i] > 0.3) hot = true;
      inSum += env[i] * inGain * 0.35;
      outSum += bands[i] * 0.35;
    }
    const mix = params.get('mix');
    const bypass = params.get('bypass') >= 0.5;
    const out = (bypass ? inSum : outSum * mix + inSum * (1 - mix)) * dbToGain(params.get('outputGain'));
    inS = inSum > inS ? inSum : inS * 0.8 + inSum * 0.2;
    outS = out > outS ? out : outS * 0.8 + out * 0.2;
    const spread = Math.abs(params.get('spread'));
    // band dynamics: static curve on the simulated band levels (+ = reduction), 0 while off
    const dynGR = new Float32Array(NUM_BANDS);
    if (params.get('dyn.on') >= 0.5 && active) {
      const thr = params.get('dyn.threshold');
      const slope = 1 - 1 / params.get('dyn.ratio');
      const range = params.get('dyn.range');
      for (let i = 0; i < NUM_BANDS; i++) {
        const over = 20 * Math.log10(Math.max(1e-6, bands[i] * 1.6)) - thr;
        const gc = over > 0 ? Math.max(-range, Math.min(range, over * slope)) : 0;
        dynGR[i] = gc * params.get(`band${i}.dyn`);
      }
    }
    latest = {
      inPeak: [inS, inS * (0.94 + 0.06 * Math.random())],
      outPeak: [outS * (1 - spread * 0.2), outS * (1 - spread * 0.05) * (0.95 + 0.05 * Math.random())],
      bands,
      dynGR,
      dynLvl: bands,
      scanDb: new Float32Array(NUM_BANDS * 2),
      scanPos: [-1, -1],
      hot: hot && !bypass,
    };
    meterEv.emit(latest);
  };
  // modulation readouts run even when "audio" is stopped so the rings move in screenshots
  window.setInterval(simulateMod, 33);

  const meters: MeterBusAPI = {
    subscribe: (cb) => meterEv.on(cb),
    latest: () => latest,
  };

  const setState = (s: EngineState) => {
    state = s;
    stateEv.emit(s);
  };

  const engine: EngineAPI = {
    params,
    meters,
    sources,
    async start() {
      if (state === 'running') return;
      setState('running');
      if (!timer) timer = window.setInterval(step, 33);
    },
    get state() {
      return state;
    },
    onStateChange: (cb) => stateEv.on(cb),
    sampleRate: 48000,
    get source() {
      return source;
    },
    onSourceChange: (cb) => sourceEv.on(cb),
    async setSource(kind) {
      if (kind === 'mic') return input.use('');
      input.closed();
      source = kind;
      sourceEv.emit(kind, sources.find((s) => s.kind === kind)?.label ?? kind);
    },
    async loadFile(file) {
      input.closed();
      source = 'file';
      sourceEv.emit('file', file.name);
    },
    setPlaying(on) {
      playing = on;
      playEv.emit(on);
    },
    get playing() {
      return playing;
    },
    onPlayingChange: (cb) => playEv.on(cb),
    setSourceLevel(v) {
      srcLevel = v;
    },
    input,
    midi,
    panic() {
      for (let b = 0; b < NUM_BANDS; b++) {
        params.set(bandParamId(b, 'fb'), 0);
        params.set(bandParamIdR(b, 'fb'), 0);
      }
      params.set('fbAllOn', 0);
      params.set('fbAllOnR', 0);
      env.fill(0);
      smooth.fill(0);
    },
    analyserOut: null,
    analyserIn: null,
    mod,
    getState: () => stateHub.get(),
    setState: (s) => stateHub.set(s),
    registerStateProvider: (key, p) => stateHub.register(key, p),
  };
  return engine;
}
