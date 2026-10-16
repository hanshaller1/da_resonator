/**
 * CONFIG → FOOT page (docs/hardware-modi-und-pools-2026-10-16.md, point 11A): the footswitch
 * stand-in. A short press and holding it each do an action (presets/foot.ts); it is pressed by the
 * FOOT button (here and in PLAY/LOAD), a key (Space unless set otherwise) and a learned MIDI note or
 * CC. Next to it the MIDI note or CC that advances a running pool (PLAY/LOAD, ADVANCE MIDI).
 * Everything here is remembered in this browser, for all presets.
 */
import { triggerText } from '../../core/midi';
import type { EngineAPI } from '../../core/types';
import { FOOT_ACTIONS, FOOT_ACTION_LABELS, HOLD_MS, keyName, type FootAction } from '../../presets/foot';
import { h, icon, toggleClass } from '../dom';
import { playKit } from '../pool';

function card(title: string, cls: string, head: HTMLElement | null, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: `cfg-card ${cls}` }, h('div', { class: 'cfg-card-head' }, h('h3', { class: 'cfg-title micro-label' }, title), head), ...children);
}

/** LEARN / ✕ and the learned note or CC of one MIDI trigger */
function triggerRow(engine: EngineAPI, name: string, label: string, title: string, notify: (m: string, tone?: 'error' | 'info') => void): { el: HTMLElement; sync(): void } {
  const m = engine.midi;
  const text = h('span', { class: 'cfg-instate ft-trig' });
  const learn = h('button', { type: 'button', class: 'btn ft-btn' }, 'LEARN');
  const clear = h('button', { type: 'button', class: 'btn ft-btn', 'aria-label': `Remove the MIDI note or CC of the ${label.toLowerCase()}`, title: 'Remove' }, '✕');
  learn.addEventListener('click', () => {
    if (m.status !== 'on') return notify('Switch MIDI on first (MIDI page).', 'error');
    m.learnTrigger(m.triggerLearning === name ? null : name);
  });
  clear.addEventListener('click', () => m.setTrigger(name, null));
  const sync = () => {
    const t = m.triggerOf(name);
    const learning = m.triggerLearning === name;
    text.textContent = learning ? 'play a note or move a CC…' : t ? triggerText(t) : 'none';
    toggleClass(text, 'is-set', !!t && !learning);
    learn.textContent = learning ? 'CANCEL' : 'LEARN';
    toggleClass(learn, 'is-on', learning);
    learn.title = m.status === 'on' ? 'Play the note or move the CC (a button that sends 127 / 0, or a note)' : 'Switch MIDI on first (MIDI page)';
    clear.hidden = !t || learning;
  };
  return { el: h('div', { class: 'cfg-row', title }, h('span', { class: 'cfg-key' }, 'MIDI'), text, clear, learn), sync };
}

export function buildFootPage(engine: EngineAPI, notify: (m: string, tone?: 'error' | 'info') => void): { el: HTMLElement; status(): string } {
  const kit = playKit(engine);
  const { foot } = kit;

  /* ---------- the footswitch ---------- */
  const actionSel = (which: 'short' | 'hold', aria: string) => {
    const sel = h('select', { class: 'select-native', 'aria-label': aria }, ...FOOT_ACTIONS.map((a) => h('option', { value: a }, FOOT_ACTION_LABELS[a])));
    sel.addEventListener('change', () => foot.set({ [which]: sel.value as FootAction }));
    return { sel, el: h('label', { class: 'select ft-select' }, h('span', { class: 'select-label micro-label' }, which === 'short' ? 'SHORT' : 'HOLD'), sel, icon('chevron', 'icon select-chevron')) };
  };
  const short = actionSel('short', 'Action of a short press');
  const hold = actionSel('hold', 'Action of holding the footswitch');

  const keyText = h('b', { class: 'cfg-val ft-key' });
  const keySet = h('button', { type: 'button', class: 'btn ft-btn' }, 'SET');
  const keyOff = h('button', { type: 'button', class: 'btn ft-btn', title: 'No key presses the footswitch' }, 'OFF');
  let keyLearning = false;
  const endKeyLearn = () => {
    keyLearning = false;
    kit.keyLearning = false;
    window.removeEventListener('keydown', onKeyLearn, true);
    syncFoot();
  };
  const onKeyLearn = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== 'Escape' && !['Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) foot.set({ key: e.code });
    endKeyLearn();
  };
  keySet.addEventListener('click', () => {
    if (keyLearning) return endKeyLearn();
    keyLearning = true;
    kit.keyLearning = true;
    window.addEventListener('keydown', onKeyLearn, true);
    syncFoot();
  });
  keyOff.addEventListener('click', () => foot.set({ key: '' }));

  const midiFoot = triggerRow(engine, 'foot', 'Footswitch', 'A note or CC that presses the footswitch: note on / off, or CC 64 and up / below 64', notify);

  const test = h('button', { type: 'button', class: 'btn ft-test', title: 'Press it like the footswitch: short, or hold' }, h('span', { class: 'led', 'aria-hidden': 'true' }), 'FOOT');
  test.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    test.setPointerCapture?.(e.pointerId);
    foot.press('button', e.timeStamp);
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) test.addEventListener(ev, () => foot.release('button'));
  const fired = h('span', { class: 'cfg-instate ft-fired' }, '—');
  foot.onFire((a, isHold) => {
    fired.textContent = `${isHold ? 'Hold' : 'Short'}: ${FOOT_ACTION_LABELS[a]}`;
  });

  const footCard = card(
    'Footswitch',
    'ft-card',
    null,
    h('div', { class: 'cfg-row' }, short.el),
    h('div', { class: 'cfg-row' }, hold.el),
    h('div', { class: 'cfg-row', title: 'The key that presses the footswitch (not while typing in a field). SET, then press the key' }, h('span', { class: 'cfg-key' }, 'KEY'), keyText, h('span', { class: 'cfg-grow' }), keyOff, keySet),
    midiFoot.el,
    h('div', { class: 'cfg-row' }, test, fired),
  );

  /* ---------- pool advance by MIDI ---------- */
  const midiPool = triggerRow(engine, 'pool', 'Pool advance', 'A note or CC that advances a running pool whose ADVANCE is MIDI', notify);
  const poolCard = card(
    'Pool',
    'ft-card',
    null,
    midiPool.el,
    h('p', { class: 'cfg-note' }, 'Advances a running pool whose ADVANCE is MIDI (PLAY/LOAD).'),
    h('p', { class: 'cfg-note' }, 'While a pool runs, Program Change n jumps to its entry n. Otherwise it loads preset n of the library.'),
  );

  const help = card(
    'How it works',
    'ft-help',
    null,
    h('p', { class: 'cfg-note' }, `Like the footswitch of the hardware: a short press does SHORT, holding it longer than ${HOLD_MS} ms does HOLD. With HOLD on Nothing, SHORT fires as you press, so TAP and STEP land on the beat.`),
    h('p', { class: 'cfg-note' }, 'It is pressed by FOOT (here and in PLAY/LOAD), the key and the MIDI note or CC. The key works anywhere except in text fields; on a focused button it is the footswitch, Enter still clicks.'),
    h('p', { class: 'cfg-note' }, 'All of this is remembered in this browser, for all presets.'),
  );

  const el = h('div', { class: 'cfg-foot' }, footCard, poolCard, help);

  const syncFoot = () => {
    const s = foot.settings;
    short.sel.value = s.short;
    hold.sel.value = s.hold;
    keyText.textContent = keyLearning ? 'press a key…' : keyName(s.key);
    toggleClass(keyText, 'is-off', !s.key && !keyLearning);
    keySet.textContent = keyLearning ? 'CANCEL' : 'SET';
    toggleClass(keySet, 'is-on', keyLearning);
    keyOff.disabled = !s.key;
    toggleClass(test, 'is-on', foot.pressed);
  };
  syncFoot();
  foot.onChange(syncFoot);
  const syncMidi = () => {
    midiFoot.sync();
    midiPool.sync();
  };
  syncMidi();
  engine.midi.onChange(syncMidi);

  const status = () => {
    const s = foot.settings;
    return ['Footswitch', `short ${FOOT_ACTION_LABELS[s.short]}`, `hold ${FOOT_ACTION_LABELS[s.hold]}`, `key ${keyName(s.key)}`].join(' · ');
  };
  return { el, status };
}
