/**
 * CONFIG tab: four pages, switched in the status line.
 * GENERAL: the source (select, play, level, file) with the audio input under it (channels,
 * Elektron AUTO; the device is chosen in the source list), the clocks as information (INT and
 * MIDI with tempo and beats, the MIDI source), the resonance setup (feedback route, what the
 * RESONANCE knob does, its curve and bands) over display (theme, window scale), and a short help.
 * The source controls share the header's Transport, so both always agree; SRC in the header opens
 * this page.
 * MIDI: device, channels and CC map (configMidi.ts).
 * CLOCK: the settings of the internal and the MIDI clock (configClock.ts).
 * FOOT: the footswitch and the MIDI note / CC that advances a pool (configFoot.ts).
 */
import '../../styles/tabs/config.css';
import type { EngineState, InputChannels, ParamStoreAPI } from '../../core/types';
import { clockInfo } from '../clock';
import { h, toggleClass } from '../dom';
import { audioStateText, buildLevelSlider, buildPlayButton, buildSourceSelect, formatSampleRate, getTransport } from '../header';
import { flash } from '../shell/panelHost';
import { DESIGN_H, DESIGN_W, onScaleChange, uiScale } from '../shell/stage';
import { registerTab } from '../shell/tabs';
import { stepper } from '../components/stepper';
import { getTheme, type ThemePref } from '../theme';
import { buildClockPage } from './configClock';
import { buildFootPage } from './configFoot';
import { buildMidiPage, runWhileVisible } from './configMidi';
import { playKit } from '../pool';
import { fbKeys, WOBBLE_MAX, WOBBLE_MIN } from '../fbKeys';
import { FADER_MAX_DB, FADER_MIN_DB } from '../../shared/params';

const HELP: [string, string][] = [
  ['Drag', 'Change a value (up / down)'],
  ['Shift + drag', 'Fine adjustment'],
  ['Wheel · ↑ ↓', 'Step a value'],
  ['Double-click', 'Back to default'],
  ['Right-click', 'Modulation and MIDI learn of that control'],
  ['ASSIGN', 'Arm a source, then drag a control'],
  ['← →', 'Next tab (on the tab row)'],
  ['Esc', 'Panic: all feedback off, ringing cleared'],
  ['Space', 'Footswitch (FOOT page)'],
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

type Page = 'general' | 'midi' | 'clock' | 'foot';

/** set while mounted: show the page of `id` (and flash the source card for 'config.source') */
let revealHere: ((id: string) => void) | null = null;

registerTab({
  id: 'config',
  // 'config.source' is not a param: SRC in the header asks for the source card
  reveal: (id) => {
    if (id !== 'config.source' && !id.startsWith('reso.') && !id.startsWith('clock.')) return false;
    revealHere?.(id);
    return true;
  },
  mount(tab) {
    const { engine } = tab;
    const t = getTransport(engine, tab.notify);
    const theme = getTheme();
    const body = tab.useBody();
    const general = h('div', { class: 'cfg' });
    const midiPage = buildMidiPage(engine, tab.notify);
    const clockPage = buildClockPage(engine);
    const footPage = buildFootPage(engine, tab.notify);
    body.append(general, midiPage.el, clockPage.el, footPage.el);

    /* ---------- source, with the audio input under LOAD FILE ---------- */
    const fileBtn = h('button', { type: 'button', class: 'btn cfg-file' }, 'LOAD FILE…');
    fileBtn.addEventListener('click', () => t.pickFile());
    const srcName = h('span', { class: 'cfg-srcname' });
    const syncSrc = (label: string) => {
      srcName.textContent = label;
      srcName.title = label;
    };
    syncSrc(t.sourceLabel);
    t.onSourceLabel(syncSrc);

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
      if (!inp.supported) text = 'Audio input not available on this page';
      else if (inp.status === 'open') text = `${inp.label}${ch}${inp.namesHidden ? ' · browser hides the other names' : ''}`;
      else if (inp.status === 'waiting') text = `${inp.label} not connected, waiting for it`;
      else if (engine.source === 'mic') text = `${inp.label || 'Audio input'} opens when audio starts`;
      else if (!inp.allowed) text = 'No input yet · pick one under SRC';
      else text = `Input not in use · ${inp.devices.length} input${inp.devices.length === 1 ? '' : 's'} found`;
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
      ? 'Audio inputs are in the SRC list. With AUTO, a plugged-in Elektron device (Digitakt, Digitone, Syntakt, Rytm …) becomes the input, also while audio runs. The browser takes the first two channels.'
      : 'This page may not use audio inputs (an embedded window, or plain http). Open resonator-standalone.html in Chrome, or run the app locally, to play your synths through it.';
    const note = h('p', { class: 'cfg-note cfg-src-note' }, NOTE);
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

    const source = card(
      'Source',
      'cfg-src',
      h('div', { class: 'cfg-row' }, buildSourceSelect(t), buildPlayButton(t)),
      h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'LEVEL'), buildLevelSlider(t)),
      h('div', { class: 'cfg-row' }, fileBtn, srcName),
      h('div', { class: 'cfg-row cfg-sep' }, h('span', { class: 'cfg-key' }, 'CHAN'), h('span', { class: 'inst', role: 'group', 'aria-label': 'Input channels' }, ...chanBtns.map((x) => x.b))),
      h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'AUTO'), autoBtn, h('span', { class: 'cfg-grow' }), h('span', { class: 'inst' }, checkBtn)),
      h('div', { class: 'cfg-row' }, inLed, inState),
      note,
    );

    /* ---------- clock: both clocks as information, settings on the CLOCK page ---------- */
    const clockSettings = h('button', { type: 'button', class: 'inst-btn', title: 'Settings of both clocks' }, 'SETTINGS');
    clockSettings.addEventListener('click', () => showPage('clock'));
    const clock = h(
      'section',
      { class: 'cfg-card cfg-clock' },
      h('div', { class: 'cfg-card-head' }, h('h3', { class: 'cfg-title micro-label' }, 'Clock'), h('span', { class: 'inst' }, clockSettings)),
      clockInfo(engine),
      h('p', { class: 'cfg-note' }, 'A lit LED: the clock is on. Each LFO and clock mod chooses INT or MIDI in its status line. Settings on the CLOCK page.'),
    );

    /* ---------- resonance setup ---------- */
    const p = engine.params;
    const resoNote = h('p', { class: 'cfg-note' });
    const syncReso = () => {
      const common = p.get('reso.route') >= 0.5;
      const knob = Math.round(p.get('reso.knob'));
      resoNote.textContent = [
        common ? 'Bands feed back after their faders into the shared input.' : 'Each band feeds back into itself.',
        knob === 2
          ? 'RESONANCE moves a resonance spot from band 1 to 10.'
          : knob === 1
            ? 'RESONANCE sets all feedback: centre none, right more, left inverted.'
            : 'RESONANCE shifts RES.',
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
        ['FEEDBACK', 'RESONANCE sets all feedback like the hardware: centre none, right more, left inverted'],
        ['FOCUS', 'Experimental: RESONANCE sweeps a resonance spotlight through the bands, left band 1, right band 10. Try an LFO on it'],
      ], 'What the RESONANCE knob does')),
      row('CURVE', paramButtons(p, 'reso.curve', [
        ['LIN', 'Even travel'],
        ['LOG', 'Fast at first, then fine'],
        ['EXP', 'Fine at first, then fast'],
        ['S', 'Balanced: fine around the centre and at the ends, fast in between'],
      ], 'Curve of the RESONANCE knob')),
      row('BANDS', paramButtons(p, 'reso.weight', [
        ['ALL', 'The knob reaches all bands alike'],
        ['HIGHS', 'The knob works more towards the high bands, not on band 1'],
        ['LOWS', 'The knob works more towards the low bands, not on band 10'],
      ], 'Bands the RESONANCE knob reaches')),
      resoNote,
    );

    /* ---------- spread: what the SPREAD knob does (centre = neutral) ---------- */
    const spreadNote = h('p', { class: 'cfg-note' });
    const syncSpread = () => {
      spreadNote.textContent =
        p.get('reso.spread') >= 0.5
          ? 'Right of centre: R up, L down (6 dB at the stop). Left: the other way round. FB shows L and R per band.'
          : 'Right of centre: odd bands to L, even to R. Left: the other way round. FB shows L and R per band.';
    };
    syncSpread();
    p.subscribe('reso.spread', syncSpread);
    const spreadCard = card(
      'Spread',
      'cfg-spread',
      row('MODE', paramButtons(p, 'reso.spread', [
        ['ODD/EVEN', 'Odd and even bands go to opposite sides'],
        ['CLASSIC', 'One channel up, the other down (hardware)'],
      ], 'What the SPREAD knob does')),
      spreadNote,
    );

    /* ---------- FB function keys, own card under Resonance: WOBBLE depth, DICE range (this browser, all presets) ---------- */
    const keys = fbKeys();
    const dB = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;
    const steps = [
      stepper('Wobble depth', () => keys.settings.wobble, (v) => keys.set({ wobble: v }), (v) => `±${v} %`),
      stepper('Dice lowest level', () => keys.settings.diceMin, (v) => keys.set({ diceMin: v }), dB),
      stepper('Dice highest level', () => keys.settings.diceMax, (v) => keys.set({ diceMax: v }), dB),
    ];
    keys.onChange(() => steps.forEach((s) => s.sync()));
    const keyRow = (key: string, title: string, el: HTMLElement) => h('div', { class: 'cfg-row', title: `${title}. Remembered in this browser, for all presets` }, h('span', { class: 'cfg-key' }, key), el);
    const keysCard = card(
      'Wobble · Dice',
      'cfg-fbkeys',
      keyRow('WOBBLE', `Holding the wave key (FB) swings the band this far around its fader, in % of fader travel (${WOBBLE_MIN}–${WOBBLE_MAX} %)`, steps[0].el),
      keyRow('DICE −', `Lowest level DICE (FB) can give a band (down to ${FADER_MIN_DB} dB = silent)`, steps[1].el),
      keyRow('DICE +', `Highest level DICE (FB) can give a band (up to +${FADER_MAX_DB} dB)`, steps[2].el),
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
    // one row with its title in it, so the column holds clock, spread and display
    const display = h(
      'section',
      { class: 'cfg-card cfg-display' },
      h(
        'div',
        { class: 'cfg-row' },
        h('h3', { class: 'cfg-title micro-label' }, 'Display'),
        h('span', { class: 'inst', role: 'group', 'aria-label': 'Theme' }, ...themeBtns.map((x) => x.b)),
        h('span', { class: 'cfg-grow' }),
        scale,
      ),
    );
    // the scale readout without its key (no room in the row); the tooltip says what it is
    scale.title = `Window scale. The window is a fixed ${DESIGN_W} × ${DESIGN_H} layout scaled to fit the browser. Use the browser's full screen for the largest view.`;

    /* ---------- help ---------- */
    const help = card(
      'Help',
      'cfg-help',
      h('dl', { class: 'cfg-help-list' }, ...HELP.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    );

    // columns: source | clock, spread, display | resonance with the FB keys | help
    general.append(source, h('div', { class: 'cfg-col cfg-col2' }, clock, spreadCard, display), h('div', { class: 'cfg-col cfg-col3' }, reso, keysCard), help);

    /* ---------- status line: state, page switch GENERAL · MIDI ---------- */
    const status = h('span', { class: 'cfg-status' });
    let page: Page = 'general';
    const PAGE_TITLES: Record<Page, string> = {
      general: 'Source, input, clocks, resonance, display',
      midi: 'MIDI device, channels and CC map',
      clock: 'Internal clock and MIDI clock',
      foot: 'Footswitch: actions, key, MIDI; MIDI advance of a pool',
    };
    const pageBtns = (['general', 'midi', 'clock', 'foot'] as const).map((pg) => {
      const b = h('button', { type: 'button', class: 'inst-btn', title: PAGE_TITLES[pg] }, pg.toUpperCase());
      b.addEventListener('click', () => showPage(pg));
      return { pg, b };
    });
    const showPage = (pg: Page) => {
      page = pg;
      general.hidden = pg !== 'general';
      midiPage.el.hidden = pg !== 'midi';
      clockPage.el.hidden = pg !== 'clock';
      footPage.el.hidden = pg !== 'foot';
      for (const { pg: x, b } of pageBtns) {
        toggleClass(b, 'is-selected', x === pg);
        b.setAttribute('aria-pressed', String(x === pg));
      }
      sync();
    };
    revealHere = (id) => {
      showPage(id.startsWith('clock.') ? 'clock' : 'general');
      if (id === 'config.source') requestAnimationFrame(() => flash(source));
    };
    tab.status.append(status, h('span', { class: 'tp-spacer' }), h('span', { class: 'inst', role: 'group', 'aria-label': 'Settings page' }, ...pageBtns.map((x) => x.b)));
    runWhileVisible(() => tab.visible && page === 'midi', midiPage.tick);
    runWhileVisible(() => tab.visible && page === 'clock', () => {
      clockPage.tick();
      const t = clockPage.status();
      if (status.textContent !== t) status.textContent = t;
    });
    engine.midi.onChange(() => sync());
    playKit(engine).foot.onChange(() => sync());
    const sync = (st: EngineState = engine.state) => {
      const txt = audioStateText(st);
      status.textContent =
        page === 'midi' ? midiPage.status() : page === 'clock' ? clockPage.status() : page === 'foot' ? footPage.status() : ['Settings', txt.label + (st === 'running' ? ` · ${formatSampleRate(engine.sampleRate)}` : ''), `Source ${t.sourceLabel}`].join(' · ');
    };
    showPage('general');
    engine.onStateChange(sync);
    t.onSourceLabel(() => sync());
  },
});
