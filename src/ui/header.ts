import { Emitter } from '../core/Emitter';
import type { EngineAPI, EngineState, SourceKind, Unsubscribe } from '../core/types';
import { ParamToggle } from './components/toggle';
import { h, icon, s, toggleClass } from './dom';
import { nav } from './shell/tabs';
import { buildPresetBar } from './tabs/play/bar';
import type { ThemeController } from './theme';

export type Notify = (msg: string, tone?: 'error' | 'info') => void;

export interface HeaderHandle {
  el: HTMLElement;
  /** start the engine if needed (must be called from a user gesture) */
  ensureStarted(): Promise<boolean>;
  /** load a dropped / picked file */
  loadFile(file: File): Promise<void>;
}

/* ==========================================================================
   Transport: audio start, source, file, source level. One per engine, shared by the header
   and the CONFIG tab so both show the same state and nothing is done twice.
   ========================================================================== */

export const DEFAULT_SOURCE_LEVEL = 0.8;
const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac';

/** what went wrong opening an audio input, in words */
export function inputErrorText(err: unknown): string {
  switch ((err as DOMException | null)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Audio input is blocked here. Allow microphone access for this page, or open the standalone file in Chrome.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'That audio input is not connected.';
    case 'NotReadableError':
      return 'The audio input is busy or failed. Another app may be using it.';
    default:
      return 'Could not open the audio input. Load an audio file instead, or run the app locally for live input.';
  }
}

export class Transport {
  /** hidden file picker; the header keeps it in the DOM (some browsers want that for click()) */
  readonly fileInput: HTMLInputElement;
  private starting: Promise<boolean> | null = null;
  private busyE = new Emitter<[boolean]>();
  private levelE = new Emitter<[number]>();
  private labelE = new Emitter<[string]>();
  private _level = DEFAULT_SOURCE_LEVEL;
  private _label: string;

  constructor(
    readonly engine: EngineAPI,
    private notify: Notify,
  ) {
    this._label = engine.sources.find((x) => x.kind === engine.source)?.label ?? engine.source;
    engine.onSourceChange((_k, label) => {
      this._label = label;
      this.labelE.emit(label);
    });
    // the source gain only exists once audio runs: re-apply the chosen level then
    engine.onStateChange((st) => {
      if (st === 'running') engine.setSourceLevel(this._level);
    });
    engine.setSourceLevel(this._level);
    // plugged in, unplugged, could not open
    engine.input.onNotice((msg, tone) => this.notify(msg, tone));

    this.fileInput = h('input', { type: 'file', accept: AUDIO_ACCEPT, hidden: true });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.loadFile(f);
    });
  }

  /** shown name of the current source (the file name for an audio file) */
  get sourceLabel(): string {
    return this._label;
  }
  onSourceLabel(cb: (label: string) => void): Unsubscribe {
    return this.labelE.on(cb);
  }

  /** an engine start is in progress */
  get busy(): boolean {
    return this.starting !== null;
  }
  onBusy(cb: (busy: boolean) => void): Unsubscribe {
    return this.busyE.on(cb);
  }

  /** start the engine if needed (call from a user gesture) */
  ensureStarted(): Promise<boolean> {
    if (this.engine.state === 'running') return Promise.resolve(true);
    if (!this.starting) {
      this.starting = this.engine
        .start()
        .then(() => true)
        .catch((err: unknown) => {
          console.error(err);
          this.notify('Could not start audio. Check your browser’s audio permissions and try again.', 'error');
          return false;
        })
        .finally(() => {
          this.starting = null;
          this.busyE.emit(false);
        });
      this.busyE.emit(true);
    }
    return this.starting;
  }

  /** switch to a built-in source or the input; false if refused (the select reverts) */
  async setSource(k: Exclude<SourceKind, 'file'>): Promise<boolean> {
    if (k === 'mic') return this.useInput('');
    if (!(await this.ensureStarted())) return false;
    try {
      await this.engine.setSource(k);
      return true;
    } catch (err) {
      console.error(err);
      this.notify('Could not switch source.', 'error');
      return false;
    }
  }

  /** make an audio input the source ('' = automatic choice); false if refused or failed */
  async useInput(deviceId: string): Promise<boolean> {
    if (!(await this.ensureStarted())) return false;
    try {
      await this.engine.input.use(deviceId);
      return true;
    } catch (err) {
      console.error(err);
      this.notify(inputErrorText(err), 'error');
      return false;
    }
  }

  /** open the file picker */
  pickFile(): void {
    this.fileInput.click();
  }

  async loadFile(file: File): Promise<void> {
    if (!(await this.ensureStarted())) return;
    try {
      await this.engine.loadFile(file);
      if (!this.engine.playing) this.engine.setPlaying(true);
    } catch (err) {
      console.error(err);
      this.notify(`Couldn’t decode “${file.name}”.`, 'error');
    }
  }

  async togglePlay(): Promise<void> {
    if (!(await this.ensureStarted())) return;
    this.engine.setPlaying(!this.engine.playing);
  }

  /** source monitor level 0..1 */
  get level(): number {
    return this._level;
  }
  setLevel(v: number): void {
    const x = Math.max(0, Math.min(1, v));
    if (x === this._level) return;
    this._level = x;
    this.engine.setSourceLevel(x);
    this.levelE.emit(x);
  }
  onLevel(cb: (v: number) => void): Unsubscribe {
    return this.levelE.on(cb);
  }
}

const transports = new WeakMap<EngineAPI, Transport>();

/** the app-wide transport of an engine (created by the first caller) */
export function getTransport(engine: EngineAPI, notify: Notify): Transport {
  let t = transports.get(engine);
  if (!t) transports.set(engine, (t = new Transport(engine, notify)));
  return t;
}

/* ==========================================================================
   Builders shared by the header and CONFIG
   ========================================================================== */

export interface AudioStateText {
  /** short state ("Audio on") */
  label: string;
  /** what the start button does in this state, null while running */
  action: string | null;
  title: string;
}

export function audioStateText(st: EngineState): AudioStateText {
  switch (st) {
    case 'running':
      return { label: 'Audio on', action: null, title: 'Audio engine running' };
    case 'suspended':
      return { label: 'Resume audio', action: 'Resume audio', title: 'Audio is suspended — click to resume' };
    case 'error':
      return { label: 'Retry audio', action: 'Retry audio', title: 'Audio failed to start — click to retry' };
    default:
      return { label: 'Start audio', action: 'Start audio', title: 'Start the audio engine' };
  }
}

export function formatSampleRate(sr: number): string {
  return sr ? `${+(sr / 1000).toFixed(1)} kHz` : '';
}

/* audio inputs in a select: value 'in:<deviceId>' ('in:' = system default), 'in:?' asks for access */
const IN = 'in:';
const ASK = 'in:?';

/** select value of the current input */
function inputValue(engine: EngineAPI): string {
  return IN + engine.input.deviceId;
}

/** options for the audio inputs: the devices once access is allowed, else one entry that asks */
function inputOptions(engine: EngineAPI): HTMLOptionElement[] {
  const inp = engine.input;
  if (!inp.supported) return [h('option', { value: ASK, disabled: true }, 'Not available on this page')];
  const opts = inp.devices.map((d) => h('option', { value: IN + d.id }, d.label));
  if (!inp.allowed) opts.push(h('option', { value: ASK }, 'Audio input… (allow access)'));
  // the chosen device while it is not listed (unplugged, or names not known yet)
  if (engine.source === 'mic' && !inp.devices.some((d) => d.id === inp.deviceId))
    opts.unshift(h('option', { value: inputValue(engine) }, (inp.label || 'Audio input') + (inp.status === 'waiting' ? ' (not connected)' : '')));
  return opts;
}

/** read the input list again whenever a select is opened, so a device plugged in a moment ago shows up */
function rescanOnOpen(select: HTMLSelectElement, engine: EngineAPI): void {
  const rescan = () => void engine.input.rescan();
  select.addEventListener('pointerdown', rescan);
  select.addEventListener('focus', rescan);
}

/** handle a chosen input option; false if it was not an input option */
async function chooseInput(t: Transport, value: string, revert: () => void): Promise<boolean> {
  if (!value.startsWith(IN)) return false;
  if (!(await t.useInput(value === ASK ? '' : value.slice(IN.length)))) revert();
  return true;
}

/** source select (built-in sources, audio file…, audio inputs); stays in sync with the engine */
export function buildSourceSelect(t: Transport, opts: { label?: string } = {}): HTMLLabelElement {
  const { engine } = t;
  const select = h('select', { class: 'select-native', 'aria-label': 'Source' });
  for (const src of engine.sources)
    if (src.kind !== 'mic') select.append(h('option', { value: src.kind }, src.kind === 'file' ? 'Audio file…' : src.label));
  const fileOpt = select.querySelector<HTMLOptionElement>('option[value="file"]');
  const inputs = h('optgroup', { label: 'Audio inputs' });
  select.append(inputs);
  const sync = () => {
    inputs.replaceChildren(...inputOptions(engine));
    select.value = engine.source === 'mic' ? inputValue(engine) : engine.source;
    if (fileOpt) fileOpt.textContent = engine.source === 'file' ? t.sourceLabel : 'Audio file…';
    select.title = t.sourceLabel;
  };
  sync();
  engine.onSourceChange(sync);
  engine.input.onChange(sync);
  rescanOnOpen(select, engine);

  select.addEventListener('change', async () => {
    const k = select.value;
    if (await chooseInput(t, k, sync)) return;
    if (k === 'file') {
      sync(); // revert until a file is actually chosen
      t.pickFile();
      return;
    }
    if (!(await t.setSource(k as Exclude<SourceKind, 'file'>))) sync();
  });

  return h('label', { class: 'select' }, h('span', { class: 'select-label micro-label' }, opts.label ?? 'SRC'), select, icon('chevron', 'icon select-chevron'));
}

/** header: the current source as a button; a click shows the source in CONFIG instead of a list */
function buildSourceButton(t: Transport): HTMLButtonElement {
  const name = h('span', { class: 'src-btn-name' });
  const btn = h(
    'button',
    { type: 'button', class: 'select src-btn', 'aria-controls': 'tabpanel-config' },
    h('span', { class: 'select-label micro-label' }, 'SRC'),
    name,
    icon('chevron', 'icon select-chevron src-btn-go'),
  );
  const sync = () => {
    name.textContent = t.sourceLabel;
    btn.title = `${t.sourceLabel}: choose the source in CONFIG`;
    btn.setAttribute('aria-label', `Source ${t.sourceLabel}. Show the source in CONFIG`);
  };
  sync();
  t.onSourceLabel(sync);
  btn.addEventListener('click', () => nav.reveal('config.source'));
  // lit while CONFIG is the shown tab, like the preset name for PLAY/LOAD
  const syncTab = () => toggleClass(btn, 'is-open', nav.current === 'config');
  syncTab();
  nav.onChange(syncTab);
  return btn;
}

/** play / pause the source */
export function buildPlayButton(t: Transport): HTMLButtonElement {
  const play = h('button', { type: 'button', class: 'btn btn--icon play', 'aria-label': 'Play' });
  const sync = (on: boolean) => {
    play.replaceChildren(icon(on ? 'pause' : 'play'));
    play.setAttribute('aria-label', on ? 'Pause source' : 'Play source');
    play.setAttribute('aria-pressed', String(on));
    toggleClass(play, 'is-on', on);
  };
  sync(t.engine.playing);
  t.engine.onPlayingChange(sync);
  play.addEventListener('click', () => void t.togglePlay());
  return play;
}

/** source level slider (double-click resets) */
export function buildLevelSlider(t: Transport): HTMLInputElement {
  const level = h('input', { type: 'range', class: 'range', min: 0, max: 1, step: 0.01, value: t.level, 'aria-label': 'Source level' });
  const sync = (v: number) => {
    if (Number(level.value) !== v) level.value = String(v);
    level.style.setProperty('--fill', `${v * 100}%`);
    level.setAttribute('aria-valuetext', `${Math.round(v * 100)} %`);
  };
  sync(t.level);
  t.onLevel(sync);
  level.addEventListener('input', () => t.setLevel(Number(level.value)));
  level.addEventListener('dblclick', () => t.setLevel(DEFAULT_SOURCE_LEVEL));
  return level;
}

export function buildPanicButton(engine: EngineAPI): HTMLButtonElement {
  const panic = h('button', { type: 'button', class: 'btn btn--panic', title: 'Stop all feedback: band FB to 0, FB All off, ringing cleared', 'aria-label': 'Panic: stop all feedback and clear filter state' }, icon('panic'), h('span', null, 'PANIC'));
  panic.addEventListener('click', () => {
    engine.panic();
    panic.classList.remove('is-flash');
    void panic.offsetWidth;
    panic.classList.add('is-flash');
  });
  return panic;
}

/* ==========================================================================
   Header
   ========================================================================== */

function brandMark(): SVGSVGElement {
  // ten bars — a stylised filterbank
  const heights = [8, 12, 16, 11, 18, 14, 20, 13, 9, 6];
  const g = s('svg', { class: 'brand-mark', viewBox: '0 0 40 24', 'aria-hidden': 'true' });
  heights.forEach((ht, i) => g.append(s('rect', { x: 1 + i * 4, y: 22 - ht, width: 2, height: ht, rx: 1 })));
  return g;
}

export function buildHeader(engine: EngineAPI, theme: ThemeController, notify: Notify): HeaderHandle {
  const t = getTransport(engine, notify);

  /* ---------- power ---------- */
  const powerLabel = h('span', { class: 'power-label' });
  const powerSub = h('span', { class: 'power-sub' });
  const power = h(
    'button',
    { type: 'button', class: 'btn power', 'aria-live': 'polite' },
    h('span', { class: 'power-led', 'aria-hidden': 'true' }),
    h('span', { class: 'power-text' }, powerLabel, powerSub),
  );
  const syncState = (st: EngineState) => {
    const txt = audioStateText(st);
    power.dataset.state = st;
    powerLabel.textContent = txt.label;
    powerSub.textContent = st === 'running' ? formatSampleRate(engine.sampleRate) : '';
    power.title = txt.title;
    toggleClass(document.documentElement, 'audio-running', st === 'running');
  };
  syncState(engine.state);
  engine.onStateChange(syncState);
  t.onBusy((b) => toggleClass(power, 'is-busy', b));
  power.addEventListener('click', () => void t.ensureStarted());

  /* ---------- source (opens CONFIG), play, level ---------- */
  const source = buildSourceButton(t);
  const play = buildPlayButton(t);
  const levelWrap = h('div', { class: 'level', title: 'Source level' }, icon('volume', 'icon level-icon'), buildLevelSlider(t));

  /* ---------- right-side actions ---------- */
  const bypass = new ParamToggle(engine.params, 'bypass', { label: 'BYPASS', tone: 'neutral', ariaLabel: 'Bypass resonator' });
  const panic = buildPanicButton(engine);

  // rolls a new AUTO theme of any brightness on every click (DARK / LIGHT are in CONFIG)
  const themeBtn = h('button', { type: 'button', class: 'btn btn--icon theme-btn' }, icon('auto'));
  themeBtn.setAttribute('aria-label', 'New generated theme');
  const syncTheme = () => {
    const now = theme.generated ? `, now "${theme.generated.name}"` : '';
    themeBtn.title = `New generated theme, any brightness${now}`;
  };
  syncTheme();
  theme.onChange(syncTheme);
  themeBtn.addEventListener('click', () => theme.roll());

  /* ---------- presets: prev / name (opens PLAY/LOAD) / next ---------- */
  const presets = buildPresetBar(engine, notify);

  const el = h(
    'header',
    { class: 'hdr' },
    h(
      'div',
      { class: 'brand' },
      brandMark(),
      h('div', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'DA RESONATOR')),
    ),
    presets,
    h('div', { class: 'hdr-transport' }, power, h('div', { class: 'hdr-source' }, source, play, levelWrap), t.fileInput),
    h('div', { class: 'hdr-actions' }, bypass.el, panic, themeBtn),
  );

  return { el, ensureStarted: () => t.ensureStarted(), loadFile: (f) => t.loadFile(f) };
}
