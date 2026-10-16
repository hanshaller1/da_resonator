import '../styles/main.css';
import './tabs/index';
import type { EngineAPI } from '../core/types';
import { h, icon, toggleClass } from './dom';
import { buildHeader } from './header';
import { triggerText } from '../core/midi';
import { setMidiApi } from './midi/hook';
import { buildAssignBanner } from './mod/banner';
import { targetLabel } from './mod/labels';
import './mod/popover'; // registers the route list popover with the controls
import { setModApi } from './mod/targets';
import { buildFaders } from './shell/faders';
import { buildGlobalColumn } from './shell/globalColumn';
import { buildTabs } from './shell/panelHost';
import { mountStage } from './shell/stage';
import { mountPlay } from './pool';
import { getTheme } from './theme';

export { registerTab, nav } from './shell/tabs';

function isAudioFile(f: File): boolean {
  return f.type.startsWith('audio/') || /\.(wav|mp3|ogg|oga|flac|m4a|aac|aif|aiff|webm|opus)$/i.test(f.name);
}

/**
 * Mount the whole instrument UI into `root`: a fixed 1200 × 700 stage (scaled to the window)
 * with the header, the 10 function tabs over one fixed panel, the band faders under it and the
 * global column on the right.
 */
export function mountApp(root: HTMLElement, engine: EngineAPI): void {
  const theme = getTheme();
  // controls reach the modulation API through this hook (assign mode, route popovers)
  setModApi(engine.mod, engine.params);
  setMidiApi(engine.midi);

  /* ---------- toast ---------- */
  const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  let toastTimer = 0;
  const notify = (msg: string, tone: 'error' | 'info' = 'info') => {
    toast.textContent = msg;
    toast.dataset.tone = tone;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-shown'), 4200);
  };

  const header = buildHeader(engine, theme, notify);
  const { tabRow, panels } = buildTabs(engine, notify);
  const faders = buildFaders(engine);
  const globals = buildGlobalColumn(engine);

  const hint = h(
    'footer',
    { class: 'hint' },
    h('span', null, h('kbd', null, 'Shift'), ' fine'),
    h('span', null, h('kbd', null, 'Double-click'), ' reset'),
    h('span', null, h('kbd', null, 'Wheel'), ' / ', h('kbd', null, '↑↓'), ' adjust'),
    h('span', null, h('kbd', null, 'Right-click'), ' modulation'),
    h('span', null, 'Drop an audio file anywhere to load it'),
  );

  const stage = h('div', { class: 'stage' }, header.el, tabRow, panels, faders, globals, hint);
  const frame = h('div', { class: 'stage-frame' }, stage);
  const dropZone = h('div', { class: 'drop-overlay', 'aria-hidden': 'true' }, h('div', { class: 'drop-card' }, icon('drop', 'icon drop-icon'), h('span', null, 'Drop audio to load as source')));

  const app = h('div', { class: 'app' }, frame, buildAssignBanner(engine.mod), dropZone, toast);
  root.replaceChildren(app);
  mountStage(frame, stage);

  /* ---------- MIDI: notices, learn; pools, footswitch, Program Change (ui/pool.ts) ---------- */
  engine.midi.onNotice(notify);
  engine.midi.onLearn((id, cc) => notify(`MIDI CC ${cc} → ${targetLabel(id)}`));
  engine.midi.onTriggerLearn((name, t) => notify(`MIDI ${triggerText(t)} → ${name === 'pool' ? 'pool advance' : 'footswitch'}`));
  mountPlay(engine, notify);

  /* ---------- bypass styling ---------- */
  const syncBypass = (v: number) => toggleClass(app, 'is-bypassed', v >= 0.5);
  syncBypass(engine.params.get('bypass'));
  engine.params.subscribe('bypass', syncBypass);

  /* ---------- drag & drop ---------- */
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  app.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    app.classList.add('is-dropping');
  });
  app.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  app.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) app.classList.remove('is-dropping');
  });
  app.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    app.classList.remove('is-dropping');
    const file = Array.from(e.dataTransfer?.files ?? []).find(isAudioFile);
    if (!file) {
      notify('That doesn’t look like an audio file.', 'error');
      return;
    }
    void header.loadFile(file);
  });

  /* ---------- global keyboard: Escape = panic when focus is on body ---------- */
  window.addEventListener('keydown', (e) => {
    // defaultPrevented: Esc already closed a popover / ended assign mode
    if (e.key === 'Escape' && !e.defaultPrevented && (document.activeElement === document.body || !document.activeElement)) engine.panic();
  });
}
