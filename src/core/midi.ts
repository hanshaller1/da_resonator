/**
 * MIDI input (docs/midi-2026-10-16.md): one device chosen in CONFIG (ELEKTRON AUTO takes an Elektron
 * device, also when it is plugged in later), the channels IN / IN L / IN R, the CC map with MIDI
 * learn, Program Change and the clock. The clock (clock ticks, Start, Stop, Continue) can come from
 * a second device of its own; without one it comes from the MIDI device. Everything is remembered
 * in the browser.
 * The MIDI clock itself runs in the worklet, next to the internal clock: while it is on, clock
 * messages go out through `clock(ev, timeStampMs)`; the engine converts the time and sends them on.
 * Tempo and beat of the incoming clock are also followed here, for the display while audio is off
 * or the MIDI clock is off.
 * Triggers (docs/hardware-modi-und-pools-2026-10-16.md, points 9A and 11A): a learned note or CC
 * presses a named trigger ('pool' advances the running pool, 'foot' is the footswitch); note on /
 * off or CC ≥ 64 / < 64 press and release it. A CC belongs either to a control or to a trigger.
 * No MIDI out, no other notes, no SysEx.
 */
import { MIDI_CONTINUE, MIDI_START, MIDI_STOP, MIDI_TICK } from '../dsp/extClock';
import { Emitter } from './Emitter';
import { isElektron, type StorageLike } from './inputs';
import {
  DEFAULT_CHANNELS,
  applyCc,
  ccReserved,
  channelHits,
  cleanChannel,
  defaultMidiMap,
  midiMappable,
  parseMidiMapFile,
  sanitizeMidiMap,
  serializeMidiMap,
  type MidiChannels,
} from './midiMap';
import type { MidiAPI, MidiInputInfo, MidiStatus, MidiTrigger, ParamStoreAPI, Unsubscribe } from './types';

const STORE_KEY = 'resonator.midi';
export const OFFSET_MIN_MS = -50;
export const OFFSET_MAX_MS = 50;
/** MIDI clock: 24 ticks per beat; the display tempo averages up to 2 beats, from 6 tick gaps on */
const PPQ = 24;
const TEMPO_TICKS = 48;
const TEMPO_MIN_GAPS = 6;
/** a gap this long (ms) starts a new tempo measurement */
const TEMPO_GAP_MS = 250;

/* ---------- the part of Web MIDI used here (a stand-in in tests) ---------- */

export interface MidiMessageLike {
  data: Uint8Array | null;
  timeStamp: number;
}
export interface MidiInputLike {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer?: string | null;
  readonly state: string;
  onmidimessage: ((e: MidiMessageLike) => void) | null;
}
export interface MidiAccessLike {
  readonly inputs: { forEach(cb: (input: MidiInputLike) => void): void };
  onstatechange: ((e: unknown) => void) | null;
}

export interface MidiEnv {
  /** navigator.requestMIDIAccess without SysEx; undefined where the browser has no Web MIDI */
  request?: () => Promise<MidiAccessLike>;
  /** state of the MIDI permission ('granted', 'prompt', 'denied'), to switch on without asking */
  permission?: () => Promise<string>;
  /** false in an embedded window whose host does not allow MIDI */
  allowed?: boolean;
  storage?: StorageLike;
  /** clock time base for the activity LEDs (ms) */
  now?: () => number;
}

interface Stored {
  /** MIDI was switched on (it comes on again by itself when the browser keeps the permission) */
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  /** device of the clock ('' = the MIDI device) */
  clockDeviceId: string;
  clockDeviceName: string;
  autoElektron: boolean;
  channels: MidiChannels;
  /** the internal and the MIDI clock are on (both can be) */
  intClock: boolean;
  midiClock: boolean;
  offsetMs: number;
  map: Map<string, number>;
  /** trigger name → note or CC */
  triggers: Map<string, MidiTrigger>;
}

function cleanTrigger(v: unknown): MidiTrigger | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Partial<MidiTrigger>;
  if ((t.kind !== 'note' && t.kind !== 'cc') || !Number.isInteger(t.num) || t.num! < 0 || t.num! > 127) return null;
  if (t.kind === 'cc' && ccReserved(t.num!)) return null;
  return { kind: t.kind, num: t.num! };
}

/** "Note C3" / "CC 64" (middle C = C3, as Elektron devices count) */
export function triggerText(t: MidiTrigger): string {
  if (t.kind === 'cc') return `CC ${t.num}`;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `Note ${names[t.num % 12]}${Math.floor(t.num / 12) - 2}`;
}

function load(storage: StorageLike | undefined): Stored {
  const d: Stored = { enabled: false, deviceId: '', deviceName: '', clockDeviceId: '', clockDeviceName: '', autoElektron: true, channels: { ...DEFAULT_CHANNELS }, intClock: true, midiClock: false, offsetMs: 0, map: defaultMidiMap(), triggers: new Map() };
  try {
    const s = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null') as Record<string, unknown> | null;
    if (s && typeof s === 'object') {
      if (typeof s.enabled === 'boolean') d.enabled = s.enabled;
      if (typeof s.deviceId === 'string') d.deviceId = s.deviceId;
      if (typeof s.deviceName === 'string') d.deviceName = s.deviceName;
      if (typeof s.clockDeviceId === 'string') d.clockDeviceId = s.clockDeviceId;
      if (typeof s.clockDeviceName === 'string') d.clockDeviceName = s.clockDeviceName;
      if (typeof s.autoElektron === 'boolean') d.autoElektron = s.autoElektron;
      const c = s.channels as Partial<MidiChannels> | undefined;
      if (c && typeof c === 'object') d.channels = { in: cleanChannel(c.in, d.channels.in), l: cleanChannel(c.l, d.channels.l), r: cleanChannel(c.r, d.channels.r) };
      if (typeof s.intClock === 'boolean') d.intClock = s.intClock;
      if (typeof s.midiClock === 'boolean') d.midiClock = s.midiClock;
      // before 2026-10-16 one clock was chosen: 'midi' switches the MIDI clock on, INT stays on
      else if (s.clock === 'midi') d.midiClock = true;
      if (typeof s.offsetMs === 'number' && Number.isFinite(s.offsetMs)) d.offsetMs = clampOffset(s.offsetMs);
      if (s.map && typeof s.map === 'object') d.map = sanitizeMidiMap(s.map);
      if (s.triggers && typeof s.triggers === 'object')
        for (const [k, v] of Object.entries(s.triggers as Record<string, unknown>)) {
          const t = cleanTrigger(v);
          if (t) d.triggers.set(k, t);
        }
      // a CC is a control's or a trigger's
      for (const t of d.triggers.values()) if (t.kind === 'cc') for (const [id, cc] of d.map) if (cc === t.num) d.map.delete(id);
    }
  } catch {
    /* storage unavailable or broken: defaults */
  }
  return d;
}

/** which clocks run: the internal clock while it is on, the MIDI clock while it is on and MIDI is */
export function clocksOn(m: MidiAPI): { int: boolean; midi: boolean } {
  return { int: m.intClockOn, midi: m.midiClockOn && m.status === 'on' };
}

function clampOffset(ms: number): number {
  return Math.round(Math.min(OFFSET_MAX_MS, Math.max(OFFSET_MIN_MS, ms)));
}

/** port name without the "2- " numbering Windows adds to duplicates */
export function cleanPortName(name: string): string {
  return name.replace(/^\d+\s*-\s*/, '').trim();
}

/** False when this page may not use MIDI: an embedded window whose host does not allow it. */
export function midiAllowedHere(): boolean {
  if (typeof document === 'undefined') return false;
  type Policy = { allowsFeature(feature: string): boolean };
  const d = document as Document & { permissionsPolicy?: Policy; featurePolicy?: Policy };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  try {
    return policy ? policy.allowsFeature('midi') : true;
  } catch {
    return true;
  }
}

/** Web MIDI of this browser, if any */
export function browserMidiEnv(storage: StorageLike | undefined): MidiEnv {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { requestMIDIAccess?: (o?: { sysex?: boolean }) => Promise<unknown> }) : undefined;
  const req = nav?.requestMIDIAccess;
  return {
    request: req ? () => req.call(nav, { sysex: false }) as Promise<MidiAccessLike> : undefined,
    permission: async () => (await navigator.permissions.query({ name: 'midi' as PermissionName })).state,
    allowed: midiAllowedHere(),
    storage,
    now: () => performance.now(),
  };
}

export class MidiService implements MidiAPI {
  private st: Stored;
  private access: MidiAccessLike | null = null;
  private port: MidiInputLike | null = null;
  /** the clock device while it is another port than the MIDI device */
  private clockPort: MidiInputLike | null = null;
  /** the incoming clock as seen here: tick times for the tempo, ticks since Start, Stop */
  private tickTimes: number[] = [];
  private ticks = 0;
  private _clockRunning = true;
  private _clockBpm = 0;
  private list: MidiInputInfo[] = [];
  private _status: MidiStatus;
  private _learning: string | null = null;
  private changeE = new Emitter<[]>();
  private noticeE = new Emitter<[string, 'info' | 'error']>();
  private programE = new Emitter<[number]>();
  private learnE = new Emitter<[string, number]>();
  private triggerE = new Emitter<[string, boolean]>();
  private triggerLearnE = new Emitter<[string, MidiTrigger]>();
  private _triggerLearning: string | null = null;
  /** triggers held down now (a CC sweep presses once) */
  private held = new Set<string>();
  private now: () => number;
  /** activity, in `now` time (ms); -Infinity = never */
  clockAt = -Infinity;
  ccAt = -Infinity;
  pcAt = -Infinity;
  /** last CC seen on a listened channel, for the CONFIG page */
  lastCc: { ch: number; cc: number; value: number } | null = null;

  /**
   * @param clock receives clock messages (extClock.ts MIDI_TICK …) with their timeStamp (ms, performance
   *   time) while the clock follows MIDI
   */
  constructor(
    private env: MidiEnv,
    private params: Pick<ParamStoreAPI, 'spec' | 'setNorm'>,
    private clock: (ev: number, timeStampMs: number) => void = () => {},
  ) {
    this.st = load(env.storage);
    this.now = env.now ?? (() => Date.now());
    this._status = !env.request ? 'unsupported' : env.allowed === false ? 'blocked' : 'off';
    // switched on last time and the browser still allows it: on again without asking
    if (this.st.enabled && this._status === 'off' && env.permission) {
      env.permission().then(
        (s) => {
          if (s === 'granted' && this._status === 'off') void this.enable();
        },
        () => {},
      );
    }
  }

  get status() { return this._status; }
  get devices(): readonly MidiInputInfo[] { return this.list; }
  get deviceId() { return this.st.deviceId; }
  get deviceName() { return this.st.deviceName; }
  /** the chosen device is plugged in and listened to */
  get connected() { return this.port !== null; }
  /** device of the clock ('' = the MIDI device) and its name */
  get clockDeviceId() { return this.st.clockDeviceId; }
  get clockDeviceName() { return this.st.clockDeviceId ? this.st.clockDeviceName : ''; }
  /** name of the device the clock comes from ('' = none chosen) */
  get clockFrom() { return this.st.clockDeviceId ? this.st.clockDeviceName : this.st.deviceName; }
  /** the device of the clock is plugged in and listened to */
  get clockConnected() { return this.clockShared() ? this.port !== null : this.clockPort !== null; }
  /** tempo of the incoming clock (0 = not measured yet), its position in beats since Start, and whether it runs */
  get clockBpm() { return this._clockBpm; }
  get clockBeats() { return this.ticks / PPQ; }
  get clockRunning() { return this._clockRunning; }
  get autoElektron() { return this.st.autoElektron; }
  get channels(): MidiChannels { return { ...this.st.channels }; }
  get intClockOn() { return this.st.intClock; }
  get midiClockOn() { return this.st.midiClock; }
  get offsetMs() { return this.st.offsetMs; }
  get learning() { return this._learning; }
  /** MIDI was on last time but needs a click (the browser asks again) */
  get wasEnabled() { return this.st.enabled; }

  onChange(cb: () => void): Unsubscribe { return this.changeE.on(cb); }
  onNotice(cb: (msg: string, tone: 'info' | 'error') => void): Unsubscribe { return this.noticeE.on(cb); }
  /** Program Change n (0–127) on a listened channel */
  onProgram(cb: (n: number) => void): Unsubscribe { return this.programE.on(cb); }
  /** MIDI learn mapped a CC */
  onLearn(cb: (id: string, cc: number) => void): Unsubscribe { return this.learnE.on(cb); }
  /** a trigger was pressed (true) or released (false) */
  onTrigger(cb: (name: string, down: boolean) => void): Unsubscribe { return this.triggerE.on(cb); }
  /** a trigger learned its note or CC */
  onTriggerLearn(cb: (name: string, t: MidiTrigger) => void): Unsubscribe { return this.triggerLearnE.on(cb); }
  /** trigger waiting for its note or CC */
  get triggerLearning() { return this._triggerLearning; }

  /* ---------- access ---------- */

  async enable(): Promise<void> {
    if (!this.env.request || this._status === 'on' || this._status === 'asking') return;
    if (this._status === 'blocked') {
      this.noticeE.emit('This page may not use MIDI. Open resonator-standalone.html in Chrome or Edge.', 'error');
      return;
    }
    this._status = 'asking';
    this.changeE.emit();
    try {
      const a = await this.env.request();
      this.access = a;
      a.onstatechange = () => this.refresh(true);
      this._status = 'on';
      this.st.enabled = true;
      this.refresh(false);
      this.save();
    } catch (e) {
      // an embedded window without MIDI in its permissions policy, or the person said no
      const blocked = e instanceof Error && /policy/i.test(e.message);
      this._status = blocked ? 'blocked' : 'denied';
      this.st.enabled = false;
      this.save();
      this.noticeE.emit(
        blocked ? 'This page may not use MIDI. Open resonator-standalone.html in Chrome or Edge.' : 'MIDI access was refused. Allow MIDI in the site settings of the browser, then switch it on again.',
        'error',
      );
    }
  }

  disable(): void {
    if (this._status !== 'on') return;
    this.detach();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.list = [];
    this._status = 'off';
    this.st.enabled = false;
    this._learning = null;
    this._triggerLearning = null;
    this.save();
  }

  /* ---------- devices ---------- */

  private inputs(): MidiInputLike[] {
    const out: MidiInputLike[] = [];
    this.access?.inputs.forEach((i) => {
      if (i.state !== 'disconnected') out.push(i);
    });
    return out;
  }

  /** read the port list again; plug = a device came or went while MIDI was on */
  private refresh(plug: boolean): void {
    if (!this.access) return;
    const before = new Set(this.list.map((d) => d.id));
    const wasConnected = this.port !== null;
    const clockBefore = this.clockPort !== null;
    const ports = this.inputs();
    this.list = ports.map((p) => {
      const name = cleanPortName(p.name ?? '') || 'MIDI input';
      return { id: p.id, name, elektron: isElektron(`${p.manufacturer ?? ''} ${name}`) };
    });
    const arrived = plug ? this.list.filter((d) => !before.has(d.id)) : [];
    const el = this.st.autoElektron ? (arrived.find((d) => d.elektron) ?? (!plug ? this.list.find((d) => d.elektron) : undefined)) : undefined;
    if (el && el.id !== this.port?.id) {
      this.use(el);
      this.noticeE.emit(plug ? `${el.name} connected: MIDI comes from it.` : `MIDI from ${el.name}.`, 'info');
    } else {
      this.attach();
      if (plug && wasConnected && !this.port) this.noticeE.emit(`${this.st.deviceName || 'The MIDI device'} disconnected. It is used again when you plug it back in.`, 'info');
      else if (plug && !wasConnected && this.port) this.noticeE.emit(`${this.st.deviceName} is back.`, 'info');
    }
    const clockNow = this.clockPort !== null;
    if (plug && !this.clockShared() && clockBefore !== clockNow)
      this.noticeE.emit(clockNow ? `${this.st.clockDeviceName} is back: the clock comes from it.` : `${this.st.clockDeviceName} (clock) disconnected. It is used again when you plug it back in.`, 'info');
    this.changeE.emit();
  }

  /** a port by id, else by name */
  private find(ports: MidiInputLike[], id: string, name: string): MidiInputLike | undefined {
    if (!id) return undefined;
    return ports.find((x) => x.id === id) ?? ports.find((x) => name && cleanPortName(x.name ?? '') === name);
  }

  /** the clock comes from the MIDI device (none of its own, or the same one) */
  private clockShared(): boolean {
    return !this.st.clockDeviceId || this.st.clockDeviceId === this.st.deviceId;
  }

  /** listen to the chosen devices, if they are there (by id, else by name) */
  private attach(): void {
    const ports = this.inputs();
    const p = this.find(ports, this.st.deviceId, this.st.deviceName);
    if (p !== this.port || !p) {
      this.detach();
      if (p) {
        if (p.id !== this.st.deviceId) {
          this.st.deviceId = p.id;
          this.persist();
        }
        this.port = p;
        p.onmidimessage = this.onMessage;
      }
    }
    // the clock device, unless it is the MIDI device (one port has one listener)
    let c = this.find(ports, this.st.clockDeviceId, this.st.clockDeviceName);
    if (c && c.id !== this.st.clockDeviceId) {
      this.st.clockDeviceId = c.id;
      this.persist();
    }
    if (c && c === this.port) c = undefined;
    if (c === this.clockPort && c) return;
    this.detachClock();
    if (!c) return;
    this.clockPort = c;
    c.onmidimessage = this.onClockMessage;
  }

  private detach(): void {
    if (this.port && this.port.onmidimessage === this.onMessage) this.port.onmidimessage = null;
    this.port = null;
    this.detachClock();
  }

  private detachClock(): void {
    if (this.clockPort && this.clockPort.onmidimessage === this.onClockMessage) this.clockPort.onmidimessage = null;
    this.clockPort = null;
  }

  private use(d: MidiInputInfo): void {
    this.st.deviceId = d.id;
    this.st.deviceName = d.name;
    this.detach();
    this.attach();
    this.save();
  }

  /** the device to listen to ('' = none) */
  choose(id: string): void {
    const d = this.list.find((x) => x.id === id);
    if (!d) {
      this.detach();
      this.st.deviceId = '';
      this.st.deviceName = '';
      this.save();
      return;
    }
    this.use(d);
  }

  /** the device of the clock ('' = the MIDI device) */
  chooseClock(id: string): void {
    const d = id ? this.list.find((x) => x.id === id) : undefined;
    this.st.clockDeviceId = d?.id ?? '';
    this.st.clockDeviceName = d?.name ?? '';
    this.detachClock();
    this.attach();
    this.resetTempo();
    this.save();
  }

  setAutoElektron(on: boolean): void {
    if (on === this.st.autoElektron) return;
    this.st.autoElektron = on;
    this.save();
    if (on && this.access) this.refresh(false);
  }

  setChannel(which: keyof MidiChannels, ch: number): void {
    const v = cleanChannel(ch, this.st.channels[which]);
    if (v === this.st.channels[which]) return;
    this.st.channels[which] = v;
    this.save();
  }

  /* ---------- clock ---------- */

  setClockOn(which: 'int' | 'midi', on: boolean): void {
    const key = which === 'int' ? 'intClock' : 'midiClock';
    if (on === this.st[key]) return;
    this.st[key] = on;
    this.save();
  }

  setOffset(ms: number): void {
    const v = clampOffset(ms);
    if (v === this.st.offsetMs) return;
    this.st.offsetMs = v;
    this.save();
  }

  /* ---------- map ---------- */

  ccOf(id: string): number | undefined {
    return this.st.map.get(id);
  }

  paramOf(cc: number): string | undefined {
    for (const [id, c] of this.st.map) if (c === cc) return id;
    return undefined;
  }

  /** [param id, CC] by CC number */
  mapEntries(): [string, number][] {
    return [...this.st.map].sort((a, b) => a[1] - b[1]);
  }

  /** give param `id` CC `cc` (a param or CC mapped before lets go); null removes its CC */
  setCc(id: string, cc: number | null): void {
    if (!midiMappable(id)) return;
    if (cc === null) {
      if (!this.st.map.delete(id)) return;
    } else {
      if (!Number.isInteger(cc) || cc < 0 || cc > 127 || ccReserved(cc)) return;
      const other = this.paramOf(cc);
      if (other === id) return;
      if (other) this.st.map.delete(other);
      this.st.map.set(id, cc);
      for (const [k, t] of this.st.triggers) if (t.kind === 'cc' && t.num === cc) this.st.triggers.delete(k);
    }
    this.save();
  }

  /** wait for the next CC and map it to `id` (null cancels) */
  learn(id: string | null): void {
    const next = id && midiMappable(id) ? id : null;
    if (next === this._learning) return;
    this._learning = next;
    if (next) this._triggerLearning = null;
    this.changeE.emit();
  }

  /* ---------- triggers ---------- */

  triggerOf(name: string): MidiTrigger | undefined {
    return this.st.triggers.get(name);
  }

  /** give trigger `name` a note or CC (taken from another trigger or control); null removes it */
  setTrigger(name: string, t: MidiTrigger | null): void {
    if (t === null) {
      if (!this.st.triggers.delete(name)) return;
    } else {
      const c = cleanTrigger(t);
      if (!c) return;
      for (const [k, x] of this.st.triggers) if (k !== name && x.kind === c.kind && x.num === c.num) this.st.triggers.delete(k);
      if (c.kind === 'cc') {
        const id = this.paramOf(c.num);
        if (id) this.st.map.delete(id);
      }
      this.st.triggers.set(name, c);
    }
    this.held.delete(name);
    this.save();
  }

  /** wait for the next note or CC and give it to trigger `name` (null cancels) */
  learnTrigger(name: string | null): void {
    if (name === this._triggerLearning) return;
    this._triggerLearning = name;
    if (name) this._learning = null;
    this.changeE.emit();
  }

  private press(name: string, down: boolean): void {
    if (down === this.held.has(name)) return;
    if (down) this.held.add(name);
    else this.held.delete(name);
    this.triggerE.emit(name, down);
  }

  /** a note or CC: learned by a waiting trigger, or pressing / releasing the trigger it belongs to; true if it was a trigger's */
  private trigger(kind: 'note' | 'cc', num: number, down: boolean): boolean {
    if (this._triggerLearning && down) {
      const name = this._triggerLearning;
      this._triggerLearning = null;
      this.setTrigger(name, { kind, num });
      this.triggerLearnE.emit(name, { kind, num });
      return true;
    }
    let hit = false;
    for (const [name, t] of this.st.triggers) {
      if (t.kind !== kind || t.num !== num) continue;
      hit = true;
      this.press(name, down);
    }
    return hit;
  }

  resetMap(): void {
    this.st.map = defaultMidiMap();
    this.dropMappedTriggers();
    this.save();
  }

  /** a new map wins: triggers on CCs it maps let go */
  private dropMappedTriggers(): void {
    const mapped = new Set(this.st.map.values());
    for (const [k, t] of this.st.triggers) if (t.kind === 'cc' && mapped.has(t.num)) this.st.triggers.delete(k);
  }

  exportMap(): { fileName: string; text: string } {
    return { fileName: 'resonator-midi-map.json', text: serializeMidiMap(this.st.map, this.st.channels) };
  }

  /** replace the map (and the channels, if the file has them) by a map file */
  importMap(text: string): { ok: true; count: number; skipped: number } | { ok: false; reason: string } {
    const r = parseMidiMapFile(text);
    if (!r.ok) return r;
    this.st.map = r.map;
    if (r.channels) this.st.channels = r.channels;
    this.dropMappedTriggers();
    this.save();
    return { ok: true, count: r.map.size, skipped: r.skipped };
  }

  /* ---------- messages ---------- */

  private onMessage = (e: MidiMessageLike): void => {
    const d = e.data;
    if (!d || !d.length) return;
    this.handle(d, e.timeStamp);
  };

  private onClockMessage = (e: MidiMessageLike): void => {
    const d = e.data;
    if (!d || !d.length) return;
    this.handle(d, e.timeStamp, 'clock');
  };

  private resetTempo(): void {
    this.tickTimes.length = 0;
    this._clockBpm = 0;
  }

  /** follow the incoming clock for the display: ticks since Start, Stop / Continue, tempo from the tick gaps */
  private track(ev: number, t: number): void {
    if (ev === MIDI_START) {
      this.ticks = 0;
      this._clockRunning = true;
    } else if (ev === MIDI_CONTINUE) this._clockRunning = true;
    else if (ev === MIDI_STOP) this._clockRunning = false;
    else if (ev === MIDI_TICK) {
      if (this._clockRunning) this.ticks++;
      const tt = this.tickTimes;
      if (tt.length && t - tt[tt.length - 1] > TEMPO_GAP_MS) tt.length = 0;
      tt.push(t);
      if (tt.length > TEMPO_TICKS + 1) tt.shift();
      const gaps = tt.length - 1;
      if (gaps >= TEMPO_MIN_GAPS) this._clockBpm = 60000 / (((tt[gaps] - tt[0]) / gaps) * PPQ);
    }
  }

  /**
   * One message (exposed for tests). `from`: the MIDI device, or the clock device of its own.
   * The clock is taken from the clock device only; CCs and Program Change from the MIDI device only.
   */
  handle(d: ArrayLike<number>, timeStamp: number, from: 'main' | 'clock' = 'main'): void {
    const s = d[0];
    if (s >= 0xf8) {
      // system real-time: clock, Start, Continue, Stop
      if (from === 'main' && !this.clockShared()) return;
      const ev = s === 0xf8 ? MIDI_TICK : s === 0xfa ? MIDI_START : s === 0xfb ? MIDI_CONTINUE : s === 0xfc ? MIDI_STOP : -1;
      if (ev < 0) return;
      this.clockAt = this.now();
      this.track(ev, timeStamp);
      if (this.st.midiClock) this.clock(ev, timeStamp);
      return;
    }
    if (from === 'clock') return;
    const kind = s & 0xf0;
    if (kind !== 0xb0 && kind !== 0xc0 && kind !== 0x90 && kind !== 0x80) return; // pressure, pitch bend, SysEx: not used
    const ch = (s & 0x0f) + 1;
    const hit = channelHits(ch, this.st.channels);
    if (!hit.left && !hit.right) return;
    if (kind === 0x90 || kind === 0x80) {
      // notes only press triggers (note on with velocity 0 is a note off)
      if (d.length < 3) return;
      this.trigger('note', d[1] & 0x7f, kind === 0x90 && (d[2] & 0x7f) > 0);
      return;
    }
    if (kind === 0xc0) {
      if (d.length < 2) return;
      this.pcAt = this.now();
      this.programE.emit(d[1] & 0x7f);
      return;
    }
    if (d.length < 3) return;
    const cc = d[1] & 0x7f;
    const v = d[2] & 0x7f;
    if (ccReserved(cc)) return;
    this.ccAt = this.now();
    this.lastCc = { ch, cc, value: v };
    if (this.trigger('cc', cc, v >= 64)) return;
    if (this._learning) {
      const id = this._learning;
      this._learning = null;
      this.setCc(id, cc);
      this.learnE.emit(id, cc);
      this.changeE.emit();
    }
    const id = this.paramOf(cc);
    if (id) applyCc(this.params, id, v, hit.left, hit.right);
  }

  private save(): void {
    this.persist();
    this.changeE.emit();
  }

  private persist(): void {
    const s = this.st;
    try {
      this.env.storage?.setItem(
        STORE_KEY,
        JSON.stringify({ enabled: s.enabled, deviceId: s.deviceId, deviceName: s.deviceName, clockDeviceId: s.clockDeviceId, clockDeviceName: s.clockDeviceName, autoElektron: s.autoElektron, channels: s.channels, intClock: s.intClock, midiClock: s.midiClock, offsetMs: s.offsetMs, map: Object.fromEntries(s.map), triggers: Object.fromEntries(s.triggers) }),
      );
    } catch {
      /* not persisted */
    }
  }
}
