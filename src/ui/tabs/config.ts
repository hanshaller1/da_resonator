/**
 * CONFIG tab: two pages, switched in the status line.
 * GENERAL: audio (engine state, start, panic, bypass) and source (select, play, level, file), the
 * audio input (device, channels, Elektron AUTO), the resonance setup (feedback route, what the
 * RESONANCE knob does, its curve and bands), the Analog character, display (theme, window scale)
 * and a short help. The source and audio controls share the header's Transport, so both always agree.
 * MIDI: device, channels, clock and CC map (configMidi.ts).
 */
import '../../styles/tabs/config.css';
import type { EngineState, InputChannels, ParamStoreAPI } from '../../core/types';
import { Knob } from '../components/knob';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { audioStateText, buildInputSelect, buildLevelSlider, buildPanicButton, buildPlayButton, buildSourceSelect, formatSampleRate, getTransport } from '../header';
import { DESIGN_H, DESIGN_W, onScaleChange, uiScale } from '../shell/stage';
import { registerTab } from '../shell/tabs';
import { getTheme, type ThemePref } from '../theme';
import { buildMidiPage, runWhileVisible } from './configMidi';

const HELP: [string, string][] = [
  ['Drag', 'Change a value (up / down)'],
  ['Shift + drag', 'Fine adjustment'],
  ['Wheel · ↑ ↓', 'Step a value'],
  ['Double-click', 'Back to default'],
  ['Right-click', 'Modulation and MIDI learn of that control'],
  ['ASSIGN', 'Arm a source, then drag a control'],
  ['← →', 'Next tab (on the tab row)'],
  ['Esc', 'Panic: all feedback off, ringing cleared'],
  ['Drop a file', 'Load audio anywhere in the window'],
];

function card(title: string, cls: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: `cfg-card ${cls}` }, h('h3', { class: 'cfg-title micro-label' }, title), ...children);
}

/** segmented buttons for a discrete param (one button per option, [label, title]) */
function paramButtons(p: ParamStoreAPI, id: string, items: [string, string][], ariaLabel: string): HTMLElement {
  const btns = items.map(([label, title], i) => {
    const b = h('button', { type: 'button', class: 'inst-btn', title }, label);
    b.addEventListener('click', () => p.set(id, i));
    return b;
  });
  const sync = () => {
    const v = Math.round(p.get(id));
    btns.forEach((b, i) => {
      toggleClass(b, 'is-selected', v === i);
      b.setAttribute('aria-pressed', String(v === i));
    });
  };
  sync();
  p.subscribe(id, sync);
  return h('span', { class: 'inst', role: 'group', 'aria-label': ariaLabel }, ...btns);
}

registerTab({
  id: 'config',
  reveal: (id) => id === 'analog' || id.startsWith('reso.'),
  mount(tab) {
    const { engine } = tab;
    const t = getTransport(engine, tab.notify);
    const theme = getTheme();
    const body = tab.useBody();
    const general = h('div', { class: 'cfg' });
    const midiPage = buildMidiPage(engine, tab.notify);
    body.append(general, midiPage.el);

    /* ---------- audio + source ---------- */
    const stLed = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
    const stLabel = h('b', { class: 'cfg-state' });
    const stRate = h('span', { class: 'cfg-rate' });
    const startBtn = h('button', { type: 'button', class: 'btn cfg-start' });
    startBtn.addEventListener('click', () => void t.ensureStarted());
    const bypass = new ParamToggle(engine.params, 'bypass', { label: 'BYPASS', tone: 'neutral', ariaLabel: 'Bypass resonator' });
    const fileBtn = h('button', { type: 'button', class: 'btn cfg-file' }, 'LOAD FILE…');
    fileBtn.addEventListener('click', () => t.pickFile());
    const srcName = h('span', { class: 'cfg-srcname' });
    const syncSrc = (label: string) => {
      srcName.textContent = label;
      srcName.title = label;
    };
    syncSrc(t.sourceLabel);
    t.onSourceLabel(syncSrc);

    const audio = card(
      'Audio',
      'cfg-audio',
      h('div', { class: 'cfg-row' }, stLed, stLabel, stRate, h('span', { class: 'cfg-grow' }), startBtn),
      h('div', { class: 'cfg-row' }, bypass.el, buildPanicButton(engine)),
      h('h3', { class: 'cfg-title micro-label cfg-sub' }, 'Source'),
      h('div', { class: 'cfg-row' }, buildSourceSelect(t), buildPlayButton(t)),
      h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'LEVEL'), buildLevelSlider(t)),
      h('div', { class: 'cfg-row' }, fileBtn, srcName),
    );

    /* ---------- audio input ---------- */
    const inp = engine.input;
    const CHANNELS: [InputChannels, string, string][] = [
      ['stereo', 'STEREO', 'Both channels as they are'],
      ['left', 'LEFT', 'Left channel only, on both sides'],
      ['right', 'RIGHT', 'Right channel only, on both sides'],
    ];
    const chanBtns = CHANNELS.map(([c, label, title]) => {
      const b = h('button', { type: 'button', class: 'inst-btn', title }, label);
      b.addEventListener('click', () => inp.setChannels(c));
      return { c, b, title };
    });
    const autoBtn = h(
      'button',
      { type: 'button', class: 'toggle toggle--accent cfg-auto', title: 'An Elektron device becomes the input when it is plugged in and when audio starts' },
      h('span', { class: 'led', 'aria-hidden': 'true' }),
      h('span', { class: 'toggle-label' }, 'ELEKTRON AUTO'),
    );
    autoBtn.addEventListener('click', () => inp.setAutoElektron(!inp.autoElektron));
    const inLed = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
    const inState = h('span', { class: 'cfg-instate' });
    const syncInput = () => {
      const mono = inp.status === 'open' && inp.deviceChannels === 1;
      for (const { c, b, title } of chanBtns) {
        toggleClass(b, 'is-selected', inp.channels === c);
        b.setAttribute('aria-pressed', String(inp.channels === c));
        b.disabled = mono && c !== 'stereo';
        b.title = mono ? 'Mono device: it feeds both sides' : title;
      }
      toggleClass(autoBtn, 'is-on', inp.autoElektron);
      autoBtn.setAttribute('aria-pressed', String(inp.autoElektron));
      const ch = inp.deviceChannels ? ` · ${inp.deviceChannels} ch` : '';
      let text: string;
      if (!inp.supported) text = 'Not available on this page';
      else if (inp.status === 'open') text = `${inp.label}${ch}${inp.namesHidden ? ' · browser hides the other names' : ''}`;
      else if (inp.status === 'waiting') text = `${inp.label} not connected, waiting for it`;
      else if (engine.source === 'mic') text = `${inp.label || 'Audio input'} opens when audio starts`;
      else if (!inp.allowed) text = 'Not in use · choose a device to allow access';
      else text = `Not in use · ${inp.devices.length} input${inp.devices.length === 1 ? '' : 's'} found`;
      inState.textContent = text;
      inState.title = text;
      toggleClass(inLed, 'is-on', inp.status === 'open');
      toggleClass(inLed, 'is-wait', inp.status === 'waiting');
    };
    syncInput();
    inp.onChange(syncInput);
    engine.onSourceChange(() => syncInput());

    // CHECK: what the browser reports, in place of the note (to find out why a device is missing)
    const NOTE = inp.supported
      ? 'With AUTO, a plugged-in Elektron device (Digitakt, Digitone, Syntakt, Rytm, Four, Heat …) becomes the input, also while audio runs. The browser takes the first two channels (with Overbridge: the main out).'
      : 'This page may not use audio inputs (an embedded window, or plain http). Open resonator-standalone.html in Chrome, or run the app locally, to play your synths through it.';
    const note = h('p', { class: 'cfg-note' }, NOTE);
    const checkBtn = h('button', { type: 'button', class: 'inst-btn cfg-check', title: 'Show what the browser reports about audio inputs (click again to hide)' }, 'CHECK');
    checkBtn.addEventListener('click', async () => {
      if (note.classList.contains('is-report')) {
        note.classList.remove('is-report');
        note.textContent = NOTE;
        toggleClass(checkBtn, 'is-selected', false);
        return;
      }
      await inp.rescan();
      const lines = await inp.report();
      console.info('[input report]\n' + lines.join('\n'));
      note.textContent = lines.join('\n');
      note.classList.add('is-report');
      toggleClass(checkBtn, 'is-selected', true);
    });

    const input = card(
      'Input',
      'cfg-input',
      h('div', { class: 'cfg-row' }, buildInputSelect(t)),
      h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'CHAN'), h('span', { class: 'inst', role: 'group', 'aria-label': 'Input channels' }, ...chanBtns.map((x) => x.b))),
      h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'AUTO'), autoBtn, h('span', { class: 'cfg-grow' }), h('span', { class: 'inst' }, checkBtn)),
      h('div', { class: 'cfg-row' }, inLed, inState),
      note,
    );

    /* ---------- resonance setup ---------- */
    const p = engine.params;
    const resoNote = h('p', { class: 'cfg-note' });
    const syncReso = () => {
      const common = p.get('reso.route') >= 0.5;
      const fb = p.get('reso.knob') >= 0.5;
      resoNote.textContent = [
        common ? 'Bands feed back after their faders into the shared input.' : 'Each band feeds back into itself.',
        fb ? 'RESONANCE scales all feedback, left inverts.' : 'RESONANCE shifts RES.',
      ].join(' ');
    };
    syncReso();
    p.subscribe('reso.route', syncReso);
    p.subscribe('reso.knob', syncReso);
    const row = (key: string, el: HTMLElement) => h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, key), el);
    const reso = card(
      'Resonance',
      'cfg-reso',
      row('FB', paramButtons(p, 'reso.route', [
        ['BAND', 'Each band feeds back into itself, before its fader'],
        ['COMMON', 'The bands feed back after their faders into the shared input of all bands (hardware)'],
      ], 'Feedback route')),
      row('KNOB', paramButtons(p, 'reso.knob', [
        ['RES', 'RESONANCE shifts RES of the bands'],
        ['FEEDBACK', 'RESONANCE scales all feedback, left of centre inverted (hardware)'],
      ], 'What the RESONANCE knob does')),
      row('CURVE', paramButtons(p, 'reso.curve', [
        ['LIN', 'Even travel'],
        ['LOG', 'Fast at first, then fine'],
        ['EXP', 'Fine at first, then fast'],
      ], 'Curve of the RESONANCE knob')),
      row('BANDS', paramButtons(p, 'reso.weight', [
        ['ALL', 'The knob reaches all bands alike'],
        ['HIGHS', 'The knob works more towards the high bands, not on band 1'],
        ['LOWS', 'The knob works more towards the low bands, not on band 10'],
      ], 'Bands the RESONANCE knob reaches')),
      resoNote,
    );

    /* ---------- analog ---------- */
    const analog = new Knob(engine.params, 'analog', { size: 'sm', label: 'ANALOG' });
    const character = card(
      'Character',
      'cfg-analog',
      h(
        'div',
        { class: 'cfg-row', title: 'Saturation, detune, Q tolerance, drift and a −96 dBFS noise floor per band' },
        analog.el,
        h('p', { class: 'cfg-note' }, 'Saturation, detune, drift and noise per band. 0 is clean.'),
      ),
    );

    /* ---------- display ---------- */
    const themeBtns = (['auto', 'light', 'dark'] as ThemePref[]).map((pref) => {
      const b = h('button', { type: 'button', class: 'inst-btn' }, pref.toUpperCase());
      b.addEventListener('click', () => theme.set(pref));
      return { pref, b };
    });
    const syncTheme = () =>
      themeBtns.forEach(({ pref, b }) => {
        toggleClass(b, 'is-selected', theme.pref === pref);
        b.setAttribute('aria-pressed', String(theme.pref === pref));
      });
    syncTheme();
    theme.onChange(syncTheme);
    const scale = h('b', { class: 'cfg-val' });
    const syncScale = (k: number) => (scale.textContent = `${Math.round(k * 100)} %`);
    syncScale(uiScale());
    onScaleChange(syncScale);
    audio.append(
      h('h3', { class: 'cfg-title micro-label cfg-sub' }, 'Display'),
      h(
        'div',
        { class: 'cfg-row' },
        h('span', { class: 'inst', role: 'group', 'aria-label': 'Theme' }, ...themeBtns.map((x) => x.b)),
        h('span', { class: 'cfg-grow' }),
        h('span', { class: 'cfg-key cfg-key--auto', title: `The window is a fixed ${DESIGN_W} × ${DESIGN_H} layout scaled to fit the browser. Use the browser's full screen for the largest view.` }, 'SCALE'),
        scale,
      ),
    );

    /* ---------- help ---------- */
    const help = card(
      'Help',
      'cfg-help',
      h('dl', { class: 'cfg-help-list' }, ...HELP.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    );

    general.append(audio, input, reso, character, help);

    /* ---------- status line: state, page switch GENERAL · MIDI ---------- */
    const status = h('span', { class: 'cfg-status' });
    let page: 'general' | 'midi' = 'general';
    const pageBtns = (['general', 'midi'] as const).map((pg) => {
      const b = h('button', { type: 'button', class: 'inst-btn', title: pg === 'general' ? 'Audio, input, resonance, display' : 'MIDI device, channels, clock and CC map' }, pg.toUpperCase());
      b.addEventListener('click', () => showPage(pg));
      return { pg, b };
    });
    const showPage = (pg: 'general' | 'midi') => {
      page = pg;
      general.hidden = pg !== 'general';
      midiPage.el.hidden = pg !== 'midi';
      for (const { pg: x, b } of pageBtns) {
        toggleClass(b, 'is-selected', x === pg);
        b.setAttribute('aria-pressed', String(x === pg));
      }
      sync();
    };
    tab.status.append(status, h('span', { class: 'tp-spacer' }), h('span', { class: 'inst', role: 'group', 'aria-label': 'Settings page' }, ...pageBtns.map((x) => x.b)));
    runWhileVisible(() => tab.visible && page === 'midi', midiPage.tick);
    engine.midi.onChange(() => sync());
    const sync = (st: EngineState = engine.state) => {
      const txt = audioStateText(st);
      stLabel.textContent = txt.label;
      stRate.textContent = st === 'running' ? formatSampleRate(engine.sampleRate) : '';
      toggleClass(stLed, 'is-on', st === 'running');
      toggleClass(stLed, 'is-error', st === 'error');
      startBtn.hidden = !txt.action;
      startBtn.textContent = (txt.action ?? '').toUpperCase();
      startBtn.title = txt.title;
      status.textContent =
        page === 'midi' ? midiPage.status() : ['Settings', txt.label + (st === 'running' ? ` · ${formatSampleRate(engine.sampleRate)}` : ''), `Source ${t.sourceLabel}`].join(' · ');
    };
    showPage('general');
    engine.onStateChange(sync);
    t.onSourceLabel(() => sync());
    t.onBusy((b) => toggleClass(startBtn, 'is-busy', b));
  },
});
