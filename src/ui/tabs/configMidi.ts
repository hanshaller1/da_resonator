/**
 * CONFIG → MIDI page (docs/midi-2026-10-16.md): MIDI on/off and the device (ELEKTRON AUTO),
 * activity, the channels IN / IN L / IN R, the clock source with OFFSET, and the CC map as a table
 * with DEFAULT, export and import. Everything here is remembered in the browser, for all presets.
 */
import { OFFSET_MAX_MS, OFFSET_MIN_MS } from '../../core/midi';
import type { EngineAPI, MidiAPI } from '../../core/types';
import { readTextFile, saveText } from '../../presets/files';
import { h, icon, toggleClass } from '../dom';
import { targetLabel } from '../mod/labels';
import { frameLoop } from '../scheduler';
import type { Notify } from '../shell/tabs';

/** an activity LED stays lit this long after a message (ms) */
const LIT_MS = 120;

function card(title: string, cls: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: `cfg-card ${cls}` }, h('h3', { class: 'cfg-title micro-label' }, title), ...children);
}

function statusText(m: MidiAPI): string {
  switch (m.status) {
    case 'unsupported':
      return 'This browser has no MIDI. Use Chrome, Edge or Opera.';
    case 'blocked':
      return 'This page may not use MIDI. Open resonator-standalone.html in Chrome.';
    case 'asking':
      return 'Waiting for the browser to allow MIDI…';
    case 'denied':
      return 'MIDI was refused. Allow it in the site settings, then switch it on.';
    case 'off':
      return m.wasEnabled ? 'Off · switch on to ask the browser again' : 'Off · switch on to use MIDI';
    case 'on': {
      const n = m.devices.length;
      if (!m.deviceId) return `On · ${n} device${n === 1 ? '' : 's'} · choose one`;
      return m.connected ? `On · listening to ${m.deviceName}` : `${m.deviceName} not connected, waiting for it`;
    }
  }
}

/** channel select: OFF, 1 … 16 */
function channelSelect(m: MidiAPI, which: 'in' | 'l' | 'r', label: string, title: string): HTMLElement {
  const sel = h('select', { class: 'select-native', 'aria-label': `MIDI channel ${label}`, title }, h('option', { value: '0' }, 'OFF'), ...Array.from({ length: 16 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
  const sync = () => (sel.value = String(m.channels[which]));
  sync();
  m.onChange(sync);
  sel.addEventListener('change', () => m.setChannel(which, Number(sel.value)));
  return h('label', { class: 'select cfg-mch', title }, h('span', { class: 'select-label micro-label' }, label), sel, icon('chevron', 'icon select-chevron'));
}

export function buildMidiPage(engine: EngineAPI, notify: Notify): { el: HTMLElement; status(): string; tick(): void } {
  const m = engine.midi;

  /* ---------- device ---------- */
  const onBtn = h('button', { type: 'button', class: 'toggle toggle--accent cfg-auto cfg-midi-on' }, h('span', { class: 'led', 'aria-hidden': 'true' }), h('span', { class: 'toggle-label' }, 'MIDI'));
  onBtn.addEventListener('click', () => (m.status === 'on' ? m.disable() : void m.enable()));
  const state = h('span', { class: 'cfg-instate' });
  const devSel = h('select', { class: 'select-native', 'aria-label': 'MIDI device' });
  devSel.addEventListener('change', () => m.choose(devSel.value));
  const autoBtn = h(
    'button',
    { type: 'button', class: 'toggle toggle--accent cfg-auto', title: 'An Elektron device becomes the MIDI device when MIDI comes on and when it is plugged in' },
    h('span', { class: 'led', 'aria-hidden': 'true' }),
    h('span', { class: 'toggle-label' }, 'ELEKTRON AUTO'),
  );
  autoBtn.addEventListener('click', () => m.setAutoElektron(!m.autoElektron));
  const act = (label: string, title: string) => {
    const led = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
    return { led, el: h('span', { class: 'cfg-act', title }, led, label) };
  };
  const actClock = act('CLOCK', 'MIDI clock comes in');
  const actCc = act('CC', 'A CC on a listened channel');
  const actPc = act('PC', 'A program change on a listened channel');
  const lastCc = h('span', { class: 'cfg-lastcc' });

  const syncDevice = () => {
    const on = m.status === 'on';
    toggleClass(onBtn, 'is-on', on);
    onBtn.setAttribute('aria-pressed', String(on));
    onBtn.disabled = m.status === 'unsupported' || m.status === 'blocked' || m.status === 'asking';
    onBtn.title = on ? 'Switch MIDI off' : 'Switch MIDI on (the browser asks once)';
    state.textContent = statusText(m);
    state.title = state.textContent;
    const opts = [h('option', { value: '' }, on ? 'No device' : 'MIDI is off')];
    for (const d of m.devices) opts.push(h('option', { value: d.id }, d.name));
    if (m.deviceId && !m.devices.some((d) => d.id === m.deviceId)) opts.push(h('option', { value: m.deviceId, disabled: true }, `${m.deviceName} (not connected)`));
    devSel.replaceChildren(...opts);
    devSel.value = m.deviceId;
    devSel.disabled = !on;
    toggleClass(autoBtn, 'is-on', m.autoElektron);
    autoBtn.setAttribute('aria-pressed', String(m.autoElektron));
  };

  const device = card(
    'MIDI',
    'cfg-mdev',
    h('div', { class: 'cfg-row' }, onBtn, state),
    h('div', { class: 'cfg-row' }, h('label', { class: 'select' }, h('span', { class: 'select-label micro-label' }, 'DEVICE'), devSel, icon('chevron', 'icon select-chevron'))),
    h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'AUTO'), autoBtn),
    h('div', { class: 'cfg-row cfg-acts' }, actClock.el, actCc.el, actPc.el, lastCc),
    h('h3', { class: 'cfg-title micro-label cfg-sub' }, 'Channels'),
    h(
      'div',
      { class: 'cfg-row cfg-mchs' },
      channelSelect(m, 'in', 'IN', 'Moves both sides'),
      channelSelect(m, 'l', 'L', 'Moves only L of the band values and FB ALL'),
      channelSelect(m, 'r', 'R', 'Moves only R of the band values and FB ALL'),
    ),
    h('p', { class: 'cfg-note' }, 'IN moves L and R, IN L and IN R only one side. Other controls follow all three. Program change n loads preset n (numbers in the preset list).'),
  );

  /* ---------- clock ---------- */
  const srcBtns = (['int', 'midi'] as const).map((src) => {
    const b = h('button', { type: 'button', class: 'inst-btn', title: src === 'int' ? 'TEMPO, RUN and TAP in CLK MOD' : 'Tempo, Start, Stop and Continue from the MIDI device' }, src.toUpperCase());
    b.addEventListener('click', async () => {
      if (src === 'midi' && m.status !== 'on') await m.enable();
      if (src === 'int' || m.status === 'on') m.setClockSource(src);
    });
    return { src, b };
  });
  const offset = h('input', { type: 'range', class: 'range', min: OFFSET_MIN_MS, max: OFFSET_MAX_MS, step: 1, 'aria-label': 'MIDI clock offset' });
  const offVal = h('b', { class: 'cfg-val cfg-offval' });
  offset.addEventListener('input', () => m.setOffset(Number(offset.value)));
  offset.addEventListener('dblclick', () => m.setOffset(0));
  const clkLed = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
  const clkState = h('span', { class: 'cfg-instate' });
  const syncClock = () => {
    for (const { src, b } of srcBtns) {
      toggleClass(b, 'is-selected', m.clockSource === src);
      b.setAttribute('aria-pressed', String(m.clockSource === src));
    }
    offset.value = String(m.offsetMs);
    // fill from the centre (0 ms) to the value
    const pos = ((m.offsetMs - OFFSET_MIN_MS) / (OFFSET_MAX_MS - OFFSET_MIN_MS)) * 100;
    offset.style.setProperty('--fill', `${pos}%`);
    offset.setAttribute('aria-valuetext', `${m.offsetMs} ms`);
    offVal.textContent = `${m.offsetMs > 0 ? '+' : ''}${m.offsetMs} ms`;
  };
  const clock = card(
    'Clock',
    'cfg-mclk',
    h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'SOURCE'), h('span', { class: 'inst', role: 'group', 'aria-label': 'Clock source' }, ...srcBtns.map((x) => x.b))),
    h('div', { class: 'cfg-row', title: 'Shifts the MIDI clock against the audio. + moves the LFOs and clock mods later, e.g. by the latency of the audio input. Double-click: 0' }, h('span', { class: 'cfg-key' }, 'OFFSET'), offset, offVal),
    h('div', { class: 'cfg-row' }, clkLed, clkState),
    h('p', { class: 'cfg-note' }, 'On MIDI, LFOs with SYNC and the clock mods follow the device. Start begins at beat 1, Stop holds, Continue goes on. Without clock the last tempo keeps running.'),
  );

  /* ---------- CC map ---------- */
  const rows = h('div', { class: 'cfg-map', role: 'table', 'aria-label': 'MIDI CC map' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const btn = (label: string, title: string, fn: () => void) => {
    const b = h('button', { type: 'button', class: 'inst-btn', title }, label);
    b.addEventListener('click', fn);
    return b;
  };
  const defBtn = btn('DEFAULT', 'Back to the default map (learned CCs are lost)', () => {
    m.resetMap();
    notify('MIDI map: default');
  });
  const expBtn = btn('EXPORT', 'Save the map and the channels as a file', async () => {
    const f = m.exportMap();
    const r = await saveText(f.fileName, f.text);
    if (r === 'failed') notify('The file could not be saved here.', 'error');
  });
  const impBtn = btn('IMPORT', 'Load a map file (replaces the map and the channels)', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const text = await readTextFile(file);
    const r = text === null ? ({ ok: false, reason: `Couldn’t read “${file.name}”.` } as const) : m.importMap(text);
    if (!r.ok) return notify(r.reason, 'error');
    notify(`MIDI map loaded: ${r.count} CC${r.count === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped` : ''}`);
  });
  let mapSig = '';
  const rowEls = new Map<number, HTMLElement>();
  const syncMap = () => {
    const entries = m.mapEntries();
    const sig = entries.map(([id, cc]) => `${id}:${cc}`).join('|');
    if (sig === mapSig) return;
    mapSig = sig;
    rowEls.clear();
    const list = entries.map(([id, cc]) => {
      const rm = h('button', { type: 'button', class: 'mod-pop-remove', 'aria-label': `Remove CC ${cc}`, title: 'Remove' }, '✕');
      rm.addEventListener('click', () => m.setCc(id, null));
      const row = h('div', { class: 'cfg-map-row', role: 'row' }, h('span', { class: 'cfg-map-cc', role: 'cell' }, String(cc)), h('span', { class: 'cfg-map-name', role: 'cell', title: targetLabel(id) }, targetLabel(id)), rm);
      rowEls.set(cc, row);
      return row;
    });
    rows.replaceChildren(...(list.length ? list : [h('p', { class: 'cfg-note' }, 'No CCs mapped. Right-click a control → LEARN, or DEFAULT.')]));
  };
  const map = card(
    'CC map',
    'cfg-mmap',
    h('div', { class: 'cfg-map-head' }, h('span', { class: 'cfg-map-cc micro-label' }, 'CC'), h('span', { class: 'cfg-map-name micro-label' }, 'Control'), h('span', { class: 'inst' }, defBtn, expBtn, impBtn)),
    rows,
    h('p', { class: 'cfg-note' }, 'Right-click any control → LEARN, then move a control on the device. One CC per control.'),
    fileInput,
  );

  const el = h('div', { class: 'cfg-midi' }, device, clock, map);

  const sync = () => {
    syncDevice();
    syncClock();
    syncMap();
  };
  sync();
  m.onChange(sync);

  /* activity LEDs and the clock line, while the page is shown */
  let lastHit = -1;
  let hitRow: HTMLElement | null = null;
  const tick = () => {
    const now = performance.now();
    toggleClass(actClock.led, 'is-on', now - m.clockAt < LIT_MS);
    toggleClass(actCc.led, 'is-on', now - m.ccAt < LIT_MS);
    toggleClass(actPc.led, 'is-on', now - m.pcAt < LIT_MS);
    const c = m.lastCc;
    lastCc.textContent = c ? `ch ${c.ch} · CC ${c.cc} · ${c.value}` : '';
    // the row of the CC that just came in lights up
    const hit = c && now - m.ccAt < LIT_MS ? c.cc : -1;
    if (hit !== lastHit) {
      hitRow?.classList.remove('is-hit');
      hitRow = rowEls.get(hit) ?? null;
      hitRow?.classList.add('is-hit');
      lastHit = hit;
    }
    const fresh = now - m.clockAt < 500;
    const ext = m.clockSource === 'midi';
    toggleClass(clkLed, 'is-on', ext && fresh && engine.mod.running);
    toggleClass(clkLed, 'is-wait', ext && fresh && !engine.mod.running);
    const live = engine.state === 'running';
    clkState.textContent = !ext
      ? `Internal · ${engine.params.get('clock.bpm').toFixed(1)} BPM`
      : !fresh
        ? `No MIDI clock · ${live ? `${engine.mod.bpm.toFixed(1)} BPM runs on` : 'waiting'}`
        : `MIDI clock · ${engine.mod.bpm.toFixed(1)} BPM · ${engine.mod.running ? 'running' : 'stopped'}${live ? '' : ' (start audio)'}`;
  };

  const status = () => ['MIDI', m.status === 'on' ? (m.connected ? m.deviceName : 'no device') : m.status === 'off' ? 'off' : m.status, `clock ${m.clockSource === 'midi' ? 'MIDI' : 'INT'}`].join(' · ');
  return { el, status, tick };
}

/** keep the page's activity LEDs moving while it is shown */
export function runWhileVisible(visible: () => boolean, tick: () => void): void {
  frameLoop.add(() => {
    if (visible()) tick();
  });
}
