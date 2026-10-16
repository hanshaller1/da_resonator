/**
 * CONFIG → CLOCK page: the settings of both clocks. Both can be on and run side by side; each LFO
 * and clock mod chooses one with INT · MIDI in LFO MOD and CLK MOD and follows the other one while
 * its own is off. USED BY lists who chose a clock.
 * INT: ON, TEMPO, TAP, RUN, RESET and its beat LEDs. TEMPO is saved with the preset.
 * MIDI: ON, the device of the clock (the MIDI device of the CCs, or one of its own: clock and Start /
 * Stop from one device, CCs from another), its tempo and beat LEDs, and OFFSET.
 * The ONs, the device and OFFSET are remembered in the browser.
 */
import { OFFSET_MAX_MS, OFFSET_MIN_MS } from '../../core/midi';
import type { EngineAPI } from '../../core/types';
import { beatLeds, bpmText, clockOn, clockState, clockUsers, clockView, intClockControls, setClockOn, type ClockName } from '../clock';
import { h, icon, toggleClass } from '../dom';

function card(title: string, cls: string, head: HTMLElement | null, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: `cfg-card ${cls}` }, h('div', { class: 'cfg-card-head' }, h('h3', { class: 'cfg-title micro-label' }, title), head), ...children);
}

/** ON of one clock; the two are independent */
function onToggle(engine: EngineAPI, which: ClockName): { el: HTMLButtonElement; sync(): void } {
  const m = engine.midi;
  const el = h('button', { type: 'button', class: 'toggle toggle--accent cfg-auto clk-on' }, h('span', { class: 'led', 'aria-hidden': 'true' }), h('span', { class: 'toggle-label' }, 'ON'));
  el.addEventListener('click', () => void setClockOn(engine, which, !clockOn(engine, which)));
  const sync = () => {
    const on = clockOn(engine, which);
    toggleClass(el, 'is-on', on);
    el.setAttribute('aria-pressed', String(on));
    const other = which === 'int' ? 'MIDI' : 'internal';
    el.title = on ? `Switch off: what chose it follows the ${other} clock` : which === 'midi' ? 'Switch the MIDI clock on (MIDI comes on with it)' : 'Switch the internal clock on';
    el.disabled = which === 'midi' && !on && (m.status === 'unsupported' || m.status === 'blocked');
  };
  return { el, sync };
}

export function buildClockPage(engine: EngineAPI): { el: HTMLElement; status(): string; tick(): void } {
  const m = engine.midi;
  const stateRow = () => {
    const led = h('span', { class: 'cfg-led', 'aria-hidden': 'true' });
    const text = h('span', { class: 'cfg-instate' });
    return { led, text, el: h('div', { class: 'cfg-row' }, led, text) };
  };
  const usersRow = () => {
    const text = h('span', { class: 'cfg-instate clk-users' });
    return { text, el: h('div', { class: 'cfg-row', title: 'LFOs and clock mods that are on and chose this clock (RATE · INT · MIDI in LFO MOD, INT · MIDI in CLK MOD)' }, h('span', { class: 'cfg-key' }, 'USED BY'), text) };
  };

  /* ---------- internal clock ---------- */
  const intOn = onToggle(engine, 'int');
  const ic = intClockControls(engine);
  const intState = stateRow();
  const intUsers = usersRow();
  const intCard = card(
    'Internal clock',
    'cfg-cint',
    intOn.el,
    h('div', { class: 'cfg-row' }, ic.tempo, h('span', { class: 'cfg-grow' }), ic.tap),
    h('div', { class: 'cfg-row' }, ic.run, ic.reset, h('span', { class: 'cfg-grow' }), beatLeds(engine, 'int')),
    intUsers.el,
    intState.el,
    h('p', { class: 'cfg-note' }, 'TEMPO is saved with the preset. TAP: tap the beat a few times.'),
  );

  /* ---------- MIDI clock ---------- */
  const midiOn = onToggle(engine, 'midi');
  const srcSel = h('select', { class: 'select-native', 'aria-label': 'Device of the MIDI clock' });
  srcSel.addEventListener('change', () => m.chooseClock(srcSel.value));
  const midiBpm = h('b', { class: 'cfg-val' });
  const offset = h('input', { type: 'range', class: 'range', min: OFFSET_MIN_MS, max: OFFSET_MAX_MS, step: 1, 'aria-label': 'MIDI clock offset' });
  const offVal = h('b', { class: 'cfg-val cfg-offval' });
  offset.addEventListener('input', () => m.setOffset(Number(offset.value)));
  offset.addEventListener('dblclick', () => m.setOffset(0));
  const midiState = stateRow();
  const midiUsers = usersRow();
  const midiCard = card(
    'MIDI clock',
    'cfg-cmidi',
    midiOn.el,
    h(
      'div',
      { class: 'cfg-row', title: 'Clock, Start, Stop and Continue come from this device. CCs and program changes come from the device on the MIDI page.' },
      h('label', { class: 'select' }, h('span', { class: 'select-label micro-label' }, 'SOURCE'), srcSel, icon('chevron', 'icon select-chevron')),
    ),
    h('div', { class: 'cfg-row' }, h('span', { class: 'cfg-key' }, 'TEMPO'), midiBpm, h('span', { class: 'cfg-grow' }), beatLeds(engine, 'midi')),
    h('div', { class: 'cfg-row', title: 'Shifts the MIDI clock against the audio. + moves the LFOs and clock mods later, e.g. by the latency of the audio input. Double-click: 0' }, h('span', { class: 'cfg-key' }, 'OFFSET'), offset, offVal),
    midiUsers.el,
    midiState.el,
    h('p', { class: 'cfg-note' }, 'Start begins at beat 1, Stop holds, Continue goes on. Without clock the last tempo runs on.'),
  );

  /* ---------- how it works ---------- */
  const help = card(
    'Clock',
    'cfg-chelp',
    null,
    h(
      'p',
      { class: 'cfg-note' },
      'Both clocks can be on at once. Each clock mod chooses its clock with INT · MIDI in CLK MOD, each LFO with RATE · INT · MIDI in LFO MOD (RATE: free on its RATE knob). The choice is saved with the preset. While its clock is off a module follows the other one; with both off it stands still.',
    ),
    h(
      'p',
      { class: 'cfg-note' },
      'The MIDI clock can come from a device of its own, for example the clock and Start / Stop from a drum machine and the CCs from a synth. Without one it comes from the MIDI device (MIDI page).',
    ),
    h('p', { class: 'cfg-note' }, 'The ONs, the source and OFFSET are remembered in this browser, for all presets.'),
  );

  const el = h('div', { class: 'cfg-clk' }, intCard, midiCard, help);

  const syncSettings = () => {
    intOn.sync();
    midiOn.sync();
    const on = m.status === 'on';
    const same = `MIDI device${m.deviceName ? ` (${m.deviceName})` : ''}`;
    const opts = [h('option', { value: '' }, on ? same : 'MIDI is off')];
    for (const d of m.devices) opts.push(h('option', { value: d.id }, d.name));
    if (m.clockDeviceId && !m.devices.some((d) => d.id === m.clockDeviceId)) opts.push(h('option', { value: m.clockDeviceId, disabled: true }, `${m.clockDeviceName} (not connected)`));
    srcSel.replaceChildren(...opts);
    srcSel.value = on ? m.clockDeviceId : '';
    srcSel.disabled = !on;
    srcSel.title = on ? '' : 'Switch MIDI on (ON here, or on the MIDI page) to choose a device';
    offset.value = String(m.offsetMs);
    // fill from the centre (0 ms) to the value
    const pos = ((m.offsetMs - OFFSET_MIN_MS) / (OFFSET_MAX_MS - OFFSET_MIN_MS)) * 100;
    offset.style.setProperty('--fill', `${pos}%`);
    offset.setAttribute('aria-valuetext', `${m.offsetMs} ms`);
    offVal.textContent = `${m.offsetMs > 0 ? '+' : ''}${m.offsetMs} ms`;
  };
  syncSettings();
  m.onChange(syncSettings);

  /* tempo and state lines, while the page is shown */
  const tick = () => {
    for (const [which, row] of [['int', intState], ['midi', midiState]] as const) {
      const cs = clockState(engine, which);
      toggleClass(row.led, 'is-on', cs.led === 'on');
      toggleClass(row.led, 'is-wait', cs.led === 'wait');
      if (row.text.textContent !== cs.text) row.text.textContent = row.text.title = cs.text;
    }
    for (const [which, row] of [['int', intUsers], ['midi', midiUsers]] as const) {
      const u = clockUsers(engine, which).join(' · ') || 'none';
      if (row.text.textContent !== u) row.text.textContent = row.text.title = u;
    }
    const v = clockView(engine, 'midi');
    const t = bpmText(v.live ? v.bpm : 0);
    if (midiBpm.textContent !== t) midiBpm.textContent = t;
    toggleClass(intCard, 'is-used', clockOn(engine, 'int'));
    toggleClass(midiCard, 'is-used', clockOn(engine, 'midi'));
  };

  const status = () => {
    const part = (which: ClockName, label: string) => `${label} ${clockOn(engine, which) ? bpmText(clockView(engine, which).bpm) : 'off'}`;
    return ['Clock', part('int', 'INT'), part('midi', 'MIDI')].join(' · ');
  };
  return { el, status, tick };
}
