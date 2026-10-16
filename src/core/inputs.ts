/**
 * Audio inputs (interfaces, synths): the device list with hot-plug, which device and channels to
 * use, Elektron detection and what is remembered between visits. No audio here: AudioEngine opens
 * the stream and reports back with opened() / waiting() / closed().
 */
import { Emitter } from './Emitter';
import type { AudioInputInfo, InputAPI, InputChannels, Unsubscribe } from './types';

const STORE_KEY = 'resonator.input';
/** a device list that takes longer than this is given up (some browsers hold it back until the page has focus) */
const ENUM_TIMEOUT_MS = 2500;
/** after an input opens, the list is read again at these delays until the browser shows the names */
const NAME_RETRY_MS = [300, 1200, 3000];

/** Elektron device names as the system shows them (Overbridge or class compliant USB audio) */
const ELEKTRON = /\belektron\b|digitakt|digitone|syntakt|analog\s*(rytm|four|keys|heat)|model\s*:\s*(cycles|samples)/i;

export function isElektron(label: string): boolean {
  return ELEKTRON.test(label);
}

/** device name without the alias prefix ("Default - ", German Windows: "Standard - ") and the USB id suffix Chrome adds */
export function cleanLabel(label: string): string {
  return label
    .replace(/^(default|communications|standard|kommunikation|par défaut|predeterminado|comunicaciones|predefinito|comunicazioni)\s+-\s+/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .trim();
}

/**
 * Windows names an input "Input (Device)", e.g. "Digitale Audioschnittstelle (Elektron Syntakt)":
 * the input and the device ("2- " numbering of duplicates removed). null if the name has no such form.
 */
export function splitWindowsName(label: string): { input: string; device: string } | null {
  const s = label.trim();
  if (!s.endsWith(')')) return null;
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ')') depth++;
    else if (s[i] === '(' && --depth === 0) {
      const input = s.slice(0, i).trim();
      const device = s.slice(i + 1, -1).replace(/^\d+\s*-\s*/, '').trim();
      return input && device ? { input, device } : null;
    }
  }
  return null;
}

/**
 * The shown name of an input: on Windows the device ("Elektron Syntakt"); where one device has
 * several inputs (MiniFuse 4: Mic/Line/Inst 1-2, Line 3-4 …) the device and the input.
 * @param all full names of every listed input
 */
export function displayName(full: string, all: readonly string[], windows: boolean): string {
  const p = windows ? splitWindowsName(full) : null;
  if (!p) return full;
  const sameDevice = all.filter((x) => splitWindowsName(x)?.device === p.device).length;
  return sameDevice > 1 ? `${p.device} · ${p.input}` : p.device;
}

/** the part of navigator.mediaDevices used here (a stand-in in tests and the mock engine) */
export interface MediaDevicesLike {
  enumerateDevices(): Promise<{ kind: string; deviceId: string; label: string; groupId?: string }[]>;
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

/** browser name and major version, for the input report */
export function browserName(): string {
  if (typeof navigator === 'undefined') return 'unknown browser';
  const ua = navigator.userAgent;
  const v = (re: RegExp) => ua.match(re)?.[1] ?? '';
  if ('brave' in navigator) return `Brave ${v(/Chrome\/(\d+)/)}`;
  if (/Edg\//.test(ua)) return `Edge ${v(/Edg\/(\d+)/)}`;
  if (/OPR\//.test(ua)) return `Opera ${v(/OPR\/(\d+)/)}`;
  if (/Firefox\//.test(ua)) return `Firefox ${v(/Firefox\/(\d+)/)}`;
  if (/Chrome\//.test(ua)) return `Chrome ${v(/Chrome\/(\d+)/)}`;
  if (/Safari\//.test(ua)) return `Safari ${v(/Version\/(\d+)/)}`;
  return 'unknown browser';
}

/** how this page is opened, for the input report */
export function pageKind(): string {
  if (typeof location === 'undefined') return 'no page';
  if (location.protocol === 'file:') return 'local file';
  let embedded = false;
  try {
    embedded = window.top !== window;
  } catch {
    embedded = true;
  }
  return embedded ? `embedded window (${location.hostname || 'no host'})` : location.hostname;
}

/** p, or a rejection after ms */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
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
  private _namesHidden = false;
  /** device id -> group id (the physical device; the 'default' alias shares it) */
  private groups = new Map<string, string>();
  /** group of the open device (to replace the 'default' alias by the real device) */
  private openGroup = '';
  /** device id -> full name as the browser gives it (alias prefix and USB id removed); shown names derive from it */
  private fulls = new Map<string, string>();
  private retryTimers: ReturnType<typeof setTimeout>[] = [];
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
    /** Windows input names: show the device in brackets instead of the input name */
    private windowsNames = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent),
  ) {
    this.st = load(storage);
    media?.addEventListener('devicechange', () => void this.refresh(true));
    // not every browser reports plugging reliably: look again when the page comes back into view
    if (media && typeof window !== 'undefined') {
      window.addEventListener('focus', () => void this.refresh(true));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.refresh(true);
      });
    }
  }

  get supported() { return !!this.media; }
  get allowed() { return this._allowed; }
  get namesHidden() { return this._namesHidden; }
  get devices(): readonly AudioInputInfo[] { return this.list; }
  get status() { return this._status; }
  get deviceId() { return this.st.deviceId; }
  get label() { return this.show(this.st.label); }
  get deviceChannels() { return this._deviceChannels; }
  get channels() { return this.st.channels; }
  get autoElektron() { return this.st.autoElektron; }
  /** an input was the source last time (it opens again when audio starts) */
  get active() { return this.st.active; }

  use(deviceId: string): Promise<void> {
    return this.open(deviceId);
  }

  rescan(): Promise<void> {
    return this.refresh(true);
  }

  async report(): Promise<string[]> {
    let access = 'unknown';
    try {
      access = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
    } catch {
      /* no permissions API for the microphone here */
    }
    const lines = [`${browserName()} · ${pageKind()}`, `Access ${access} · input ${this._status}${this._namesHidden ? ' · names hidden' : ''}`];
    if (!this.media) return [...lines, 'Audio input is not available on this page.'];
    try {
      const inputs = (await within(this.media.enumerateDevices(), ENUM_TIMEOUT_MS)).filter((d) => d.kind === 'audioinput');
      const noIds = inputs.filter((d) => !d.deviceId).length;
      lines.push(`Browser lists ${inputs.length} input${inputs.length === 1 ? '' : 's'}${noIds ? ` (${noIds} without id)` : ''}:`);
      lines.push(inputs.map((d) => d.label || '(no name)').join(' · ') || '(none)');
    } catch (e) {
      lines.push(`Device list failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return lines;
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

  /** full name of a listed device ('' if unknown) */
  fullName(id: string): string {
    return this.fulls.get(id) ?? '';
  }

  /** this listed device is the chosen one (same id, or the same name under a new id) */
  isChosen(d: AudioInputInfo): boolean {
    return d.id === this.st.deviceId || (this.st.label !== '' && this.fulls.get(d.id) === this.st.label);
  }

  /** listed device with this full name */
  private byName(name: string): AudioInputInfo | undefined {
    return name ? this.list.find((d) => this.fulls.get(d.id) === name) : undefined;
  }

  /** shown name for a full name, against the current list */
  private show(full: string): string {
    return displayName(full, [...this.fulls.values()], this.windowsNames);
  }

  /** the listed device a stream opened: by id, else by name or group (Chrome reports 'default' for the default device) */
  resolve(id: string, trackLabel: string, groupId?: string): AudioInputInfo | undefined {
    return this.find(id) ?? this.byName(cleanLabel(trackLabel)) ?? (groupId ? this.list.find((d) => this.groups.get(d.id) === groupId) : undefined);
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
    const d = this.find(this.st.deviceId) ?? this.byName(this.st.label);
    return d ? d.id : null;
  }

  /** read the device list again; on a hot-plug event, report the devices that appeared */
  refresh(plug = false): Promise<void> {
    // serialized, so overlapping devicechange events report an arrival once
    return (this.queue = this.queue.then(() => this.doRefresh(plug)));
  }

  private async doRefresh(plug: boolean): Promise<void> {
    if (!this.media) return;
    let all: { kind: string; deviceId: string; label: string; groupId?: string }[];
    try {
      all = await within(this.media.enumerateDevices(), ENUM_TIMEOUT_MS);
    } catch {
      return;
    }
    const wasAllowed = this._allowed;
    const before = new Set(this.list.map((d) => d.id));
    const inputs = all.filter((d) => d.kind === 'audioinput');
    // Chrome adds 'default' and 'communications' as aliases of real devices
    const real = inputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const use = real.length ? real : inputs.filter((d) => d.deviceId);
    const named = inputs.some((d) => d.label !== '');
    this.groups = new Map(use.filter((d) => d.groupId).map((d) => [d.deviceId, d.groupId!]));
    // an open 'default' alias becomes the real device it stands for
    let moved = false;
    if (this._status === 'open' && this.openGroup && !use.some((d) => d.deviceId === this.st.deviceId)) {
      const realDev = use.find((d) => d.groupId === this.openGroup);
      if (realDev) {
        this.st.deviceId = realDev.deviceId;
        this.persist();
        moved = true;
      }
    }
    // an open input proves access, even where the browser hides the names (they stay selectable)
    this._allowed = named || (this._status === 'open' && use.length > 0);
    this._namesHidden = this._allowed && use.some((d) => d.label === '');
    const fulls = new Map<string, string>();
    if (this._allowed)
      use.forEach((d, i) => {
        const own = d.deviceId === this.st.deviceId ? this.st.label : '';
        fulls.set(d.deviceId, cleanLabel(d.label) || own || `Input ${i + 1} (name hidden)`);
      });
    this.fulls = fulls;
    const list = [...fulls].map(([id, full]) => ({ id, label: this.show(full), elektron: isElektron(full) }));
    const changed = moved || wasAllowed !== this._allowed || JSON.stringify(list) !== JSON.stringify(this.list);
    this.list = list;
    if (changed) this.changeE.emit();
    // names only appear after access: devices that "appear" with it were there all along
    const arrived = plug && wasAllowed ? list.filter((d) => !before.has(d.id)) : [];
    if (arrived.length) this.arriveE.emit(arrived);
  }

  /** a device is the source before audio runs; it opens when audio starts (label: its full name) */
  choose(id: string, label = this.fulls.get(id) ?? (id === this.st.deviceId ? this.st.label : '')): void {
    this.st.deviceId = id;
    this.st.label = label;
    this.st.active = true;
    this.save();
  }

  /** the engine opened a device (label: its full name) */
  opened(id: string, label: string, channels: number, groupId = ''): void {
    this.openGroup = groupId;
    this.st.deviceId = id;
    this.st.label = label;
    this.st.active = true;
    this._status = 'open';
    this._deviceChannels = channels;
    this.save();
    // access is certain now: read the list again, and once more later if the browser is slow to show names
    this.retryTimers.forEach(clearTimeout);
    void this.refresh().then(() => {
      if (this._allowed && !this._namesHidden) return;
      this.retryTimers = NAME_RETRY_MS.map((ms) =>
        setTimeout(() => {
          if (this._status === 'open' && (!this._allowed || this._namesHidden)) void this.refresh(true);
        }, ms),
      );
    });
  }

  /** the chosen device is the source but not connected; it opens when it appears */
  waiting(id = this.st.deviceId, label = this.st.label): void {
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
    this.persist();
    this.changeE.emit();
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify(this.st));
    } catch {
      /* not persisted */
    }
  }
}
