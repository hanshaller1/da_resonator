/**
 * MIDI on the controls (docs/midi-2026-10-16.md): the MIDI row of the right-click popover
 * ("MIDI learn" / remove), the CC number in the tooltip of a mapped control, and the highlight of
 * the control that waits for MIDI learn. Controls reach the MIDI API through `setMidiApi()`
 * (called once from mountApp), so their constructors don't need the engine.
 */
import '../../styles/components/midi.css';
import { midiMappable } from '../../core/midiMap';
import type { MidiAPI, Unsubscribe } from '../../core/types';
import { h, toggleClass } from '../dom';

let api: MidiAPI | null = null;
let offChange: Unsubscribe | null = null;
let learnShown: string | null = null;

export function getMidiApi(): MidiAPI | null {
  return api;
}

/** connect the controls to the engine's MIDI (call once, before panels mount) */
export function setMidiApi(m: MidiAPI | null): void {
  offChange?.();
  offChange = null;
  api = m;
  if (m) offChange = m.onChange(syncLearn);
  syncLearn();
}

/** popover and context menus: does this param offer MIDI learn? */
export function midiOffered(id: string): boolean {
  return !!api && api.status !== 'unsupported' && midiMappable(id);
}

/** the control waiting for MIDI learn pulses */
function syncLearn(): void {
  if (typeof document === 'undefined') return;
  const id = api?.learning ?? null;
  if (id === learnShown) return;
  const mark = (pid: string | null, on: boolean) => {
    if (!pid) return;
    for (const el of document.querySelectorAll<HTMLElement>(`[data-param="${CSS.escape(pid)}"]`)) toggleClass(el, 'is-midi-learn', on);
  };
  mark(learnShown, false);
  mark(id, true);
  learnShown = id;
}

/* ---------- CC number in the tooltip ---------- */

const CC_SUFFIX = /(?:\s·\s)?MIDI CC \d+$/;

if (typeof document !== 'undefined') {
  // set at hover time: controls are built and re-titled (assign mode) at any time
  document.addEventListener(
    'pointerover',
    (e) => {
      if (!api || !(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>('[data-param]');
      if (!el) return;
      const base = (el.getAttribute('title') ?? '').replace(CC_SUFFIX, '');
      const cc = api.ccOf(el.dataset.param!);
      const next = cc === undefined ? base : `${base ? `${base} · ` : ''}MIDI CC ${cc}`;
      if (next) el.title = next;
      else el.removeAttribute('title');
    },
    true,
  );
}

/* ---------- popover row ---------- */

/** "MIDI · CC 20 · LEARN · ✕" for the route popover of param `id`; null where MIDI is not offered */
export function midiPopoverRow(id: string): { el: HTMLElement; dispose(): void } | null {
  const m = api;
  if (!m || !midiOffered(id)) return null;
  const state = h('span', { class: 'mod-pop-midi-state' });
  const learn = h('button', { type: 'button', class: 'mod-pop-midi-btn' });
  const rm = h('button', { type: 'button', class: 'mod-pop-remove', 'aria-label': 'Remove MIDI CC', title: 'Remove MIDI CC' }, '✕');
  const el = h('div', { class: 'mod-pop-midi', role: 'group', 'aria-label': 'MIDI' }, h('span', { class: 'mod-pop-midi-key micro-label' }, 'MIDI'), state, learn, rm);
  const sync = () => {
    const cc = m.ccOf(id);
    const waiting = m.learning === id;
    const usable = m.status !== 'blocked';
    toggleClass(el, 'is-learning', waiting);
    state.textContent = waiting ? 'Waiting for a CC…' : cc === undefined ? 'No CC' : `CC ${cc}`;
    state.title = waiting ? `Move a control on ${m.connected ? m.deviceName : 'your MIDI device'}` : cc === undefined ? '' : `MIDI CC ${cc}`;
    learn.textContent = waiting ? 'CANCEL' : 'LEARN';
    learn.disabled = !usable;
    learn.title = !usable ? 'This page may not use MIDI (CONFIG → MIDI)' : waiting ? 'Stop waiting for a CC' : m.status === 'on' ? 'MIDI learn: the next CC from your device controls this' : 'Switches MIDI on, then waits for the next CC';
    rm.hidden = cc === undefined || waiting;
  };
  learn.addEventListener('click', async () => {
    if (m.learning === id) return m.learn(null);
    if (m.status !== 'on') await m.enable();
    if (m.status === 'on') m.learn(id);
  });
  rm.addEventListener('click', () => m.setCc(id, null));
  sync();
  const off = m.onChange(sync);
  return {
    el,
    dispose() {
      off();
      // closing the popover ends a learn it started
      if (m.learning === id) m.learn(null);
    },
  };
}
