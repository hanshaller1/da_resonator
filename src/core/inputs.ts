/**
 * Audio inputs (interfaces, synths): the device list with hot-plug, which device and channels to
 * use, Elektron detection and what is remembered between visits. No audio here: AudioEngine opens
 * the stream and reports back with opened() / waiting() / closed().
 */
import { Emitter } from './Emitter';
import type { AudioInputInfo, InputAPI, InputChannels, Unsubscribe } from './types';

const STORE_KEY = 'resonator.input';

/** Elektron device names as the system shows them (Overbridge or class compliant USB audio) */
const ELEKTRON = /\belektron\b|digitakt|digitone|syntakt|analog\s*(rytm|four|keys|heat)|model\s*:\s*(cycles|samples)/i;

export function isElektron(label: string): boolean {
  return ELEKTRON.test(label);
}

/** device name without the "Default - " alias prefix and the USB id suffix Chrome adds */
export function cleanLabel(label: string): string {
  return label
    .replace(/^(default|communications)\s*-\s*/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .trim();
}

/** the part of navigator.mediaDevices used here (a stand-in in tests and the mock engine) */
export interface MediaDevicesLike {
  enumerateDevices(): Promise<{ kind: string; deviceId: string; label: string }[]>;
  addEventListener(type: 'devicechange', cb: () => void): void;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

interface Stored {
  /** last device chosen ('' = system default) */
  deviceId: string;
  label: string;
  channels: InputChannels;
  autoElektron: boolean;
  /** an input was the source when the page was left */
  active: boolean;
}

const CHANNELS: InputChannels[] = ['stereo', 'left', 'right'];

function load(storage: StorageLike | undefined): Stored {
  const d: Stored = { deviceId: '', label: '', channels: 'stereo', autoElektron: true, active: false };
  try {
    const s = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null') as Partial<Stored> | null;
    if (s && typeof s === 'object') {
      if (typeof s.deviceId === 'string') d.deviceId = s.deviceId;
      if (typeof s.label === 'string') d.label = s.label;
      if (CHANNELS.includes(s.channels as InputChannels)) d.channels = s.channels as InputChannels;
      if (typeof s.autoElektron === 'boolean') d.autoElektron = s.autoElektron;
      if (typeof s.active === 'boolean') d.active = s.active;
    }
  } catch {
    /* storage unavailable or broken: defaults */
  }
  return d;
}

/**
 * False when this page may not use audio input at all: an embedded window whose host does not
 * allow the microphone. Browsers without the policy API find out on the first try instead.
 */
export function inputAllowedHere(): boolean {
  if (typeof document === 'undefined') return false;
  type Policy = { allowsFeature(feature: string): boolean };
  const d = document as Document & { permissionsPolicy?: Policy; featurePolicy?: Policy };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  try {
    return policy ? policy.allowsFeature('microphone') : true;
  } catch {
    return true;
  }
}

/** localStorage if the page may use it */
export function pageStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export class InputDevices implements InputAPI {
  private list: AudioInputInfo[] = [];
  private _allowed = false;
  private _status: InputAPI['status'] = 'off';
  private _deviceChannels = 0;
  private st: Stored;
  private queue: Promise<void> = Promise.resolve();
  private changeE = new Emitter<[]>();
  private arriveE = new Emitter<[AudioInputInfo[]]>();
  private noticeE = new Emitter<[string, 'info' | 'error']>();

  /**
   * @param media navigator.mediaDevices (undefined where the browser offers no input)
   * @param open opens a device as the source (AudioEngine.useInput)
   */
  constructor(
    private media: MediaDevicesLike | undefined,
    private storage: StorageLike | undefined,
    private open: (deviceId: string) => Promise<void>,
  ) {
    this.st = load(storage);
    media?.addEventListener('devicechange', () => void this.refresh(true));
  }

  get supported() { return !!this.media; }
  get allowed() { return this._allowed; }
  get devices(): readonly AudioInputInfo[] { return this.list; }
  get status() { return this._status; }
  get deviceId() { return this.st.deviceId; }
  get label() { return this.st.label; }
  get deviceChannels() { return this._deviceChannels; }
  get channels() { return this.st.channels; }
  get autoElektron() { return this.st.autoElektron; }
  /** an input was the source last time (it opens again when audio starts) */
  get active() { return this.st.active; }

  use(deviceId: string): Promise<void> {
    return this.open(deviceId);
  }

  setChannels(c: InputChannels): void {
    if (c === this.st.channels) return;
    this.st.channels = c;
    this.save();
  }

  setAutoElektron(on: boolean): void {
    if (on === this.st.autoElektron) return;
    this.st.autoElektron = on;
    this.save();
  }

  onChange(cb: () => void): Unsubscribe { return this.changeE.on(cb); }
  onNotice(cb: (msg: string, tone: 'info' | 'error') => void): Unsubscribe { return this.noticeE.on(cb); }
  /** devices that appeared while the page was open (hot-plug) */
  onArrive(cb: (devices: AudioInputInfo[]) => void): Unsubscribe { return this.arriveE.on(cb); }

  notice(msg: string, tone: 'info' | 'error' = 'info'): void {
    this.noticeE.emit(msg, tone);
  }

  find(id: string): AudioInputInfo | undefined {
    return this.list.find((d) => d.id === id);
  }

  /** the listed device a stream opened (by id, else by name: Chrome reports 'default' for the default device) */
  resolve(id: string, trackLabel: string): AudioInputInfo | undefined {
    const name = cleanLabel(trackLabel);
    return this.find(id) ?? (name ? this.list.find((d) => d.label === name) : undefined);
  }

  /** first Elektron device in the list */
  elektron(): AudioInputInfo | undefined {
    return this.list.find((d) => d.elektron);
  }

  /**
   * The device to open for an automatic choice: an Elektron device (AUTO), else the remembered
   * device, else '' (system default). null = the remembered device is known to be missing.
   */
  autoChoice(): string | null {
    const el = this.st.autoElektron ? this.elektron() : undefined;
    if (el) return el.id;
    if (!this.st.deviceId) return '';
    if (!this._allowed) return this.st.deviceId; // can't check without names: try it
    const d = this.find(this.st.deviceId) ?? (this.st.label ? this.list.find((x) => x.label === this.st.label) : undefined);
    return d ? d.id : null;
  }

  /** read the device list again; on a hot-plug event, report the devices that appeared */
  refresh(plug = false): Promise<void> {
    // serialized, so overlapping devicechange events report an arrival once
    return (this.queue = this.queue.then(() => this.doRefresh(plug)));
  }

  private async doRefresh(plug: boolean): Promise<void> {
    if (!this.media) return;
    let all: { kind: string; deviceId: string; label: string }[];
    try {
      all = await this.media.enumerateDevices();
    } catch {
      return;
    }
    const wasAllowed = this._allowed;
    const before = new Set(this.list.map((d) => d.id));
    const inputs = all.filter((d) => d.kind === 'audioinput');
    this._allowed = inputs.some((d) => d.label !== '');
    // Chrome adds 'default' and 'communications' as aliases of real devices
    const real = inputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const use = real.length ? real : inputs.filter((d) => d.deviceId);
    const list = this._allowed ? use.map((d) => ({ id: d.deviceId, label: cleanLabel(d.label) || 'Audio input', elektron: isElektron(d.label) })) : [];
    const changed = wasAllowed !== this._allowed || JSON.stringify(list) !== JSON.stringify(this.list);
    this.list = list;
    if (changed) this.changeE.emit();
    // names only appear after access: devices that "appear" with it were there all along
    const arrived = plug && wasAllowed ? list.filter((d) => !before.has(d.id)) : [];
    if (arrived.length) this.arriveE.emit(arrived);
  }

  /** a device is the source before audio runs; it opens when audio starts */
  choose(id: string, label: string): void {
    this.st.deviceId = id;
    this.st.label = label;
    this.st.active = true;
    this.save();
  }

  /** the engine opened a device */
  opened(id: string, label: string, channels: number): void {
    this.st.deviceId = id;
    this.st.label = label;
    this.st.active = true;
    this._status = 'open';
    this._deviceChannels = channels;
    this.save();
  }

  /** the chosen device is the source but not connected; it opens when it appears */
  waiting(id: string, label: string): void {
    this.st.deviceId = id;
    this.st.label = label;
    this.st.active = true;
    this._status = 'waiting';
    this._deviceChannels = 0;
    this.save();
  }

  /** the source is no longer an input */
  closed(): void {
    if (this._status === 'off' && !this.st.active) return;
    this.st.active = false;
    this._status = 'off';
    this._deviceChannels = 0;
    this.save();
  }

  private save(): void {
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify(this.st));
    } catch {
      /* not persisted */
    }
    this.changeE.emit();
  }
}
