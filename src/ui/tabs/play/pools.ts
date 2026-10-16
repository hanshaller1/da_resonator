/**
 * Pool area of PLAY/LOAD (right column; docs/hardware-modi-und-pools-2026-10-16.md, points 8A–12A):
 * - head: pool choice, NEW, RENAME, DELETE (rename and delete confirm in place);
 * - the entries: click plays one, drag to reorder (Alt + ↑ ↓ too), × removes; a library row dragged
 *   in, or "Add loaded preset", adds one; deleted presets show as missing and are skipped;
 * - transport: START / STOP, STEP, STEP+MORPH, RESET and FOOT (the footswitch, CONFIG → FOOT);
 * - how the pool plays: DIR, MORPH time (ms or beats), ADVANCE by HAND, CLOCK (every N bars of
 *   INT or MIDI) or MIDI (a learned note or CC), and AUTO MORPH for clock, MIDI and Program Change.
 * The pools' file buttons sit in the middle column (Pools row).
 */
import type { EngineAPI } from '../../../core/types';
import { triggerText } from '../../../core/midi';
import { readTextFile, saveText } from '../../../presets/files';
import { MORPH_BEATS_MAX, MORPH_MS_MAX, POOL_BARS, POOL_DIRS, POOL_DIR_LABELS, type PoolAdvance } from '../../../presets/pools';
import { h, icon, toggleClass } from '../../dom';
import { frameLoop } from '../../scheduler';
import { playKit, poolNotice, type PlayKit } from '../../pool';
import { PRESET_DRAG_TYPE, type Notify } from './browser';

const ENTRY_DRAG_TYPE = 'application/x-resonator-pool-entry';
const ADVANCE_LABELS: Record<PoolAdvance, [string, string]> = {
  hand: ['HAND', 'Only STEP, STEP+MORPH and the footswitch advance'],
  clock: ['CLOCK', 'While it runs, the pool advances every N bars of its clock'],
  midi: ['MIDI', 'While it runs, a learned MIDI note or CC advances the pool'],
};

type HeadMode = 'pick' | 'rename' | 'delete';

/** segmented buttons ([value, label, title]) with one pressed */
function segs<T extends string>(items: [T, string, string][], aria: string, pick: (v: T) => void): { el: HTMLElement; set(v: T): void } {
  const btns = items.map(([v, label, title]) => {
    const b = h('button', { type: 'button', class: 'pb-seg', 'aria-pressed': 'false', title }, label);
    b.addEventListener('click', () => pick(v));
    return { v, b };
  });
  return {
    el: h('div', { class: 'pb-segs', role: 'group', 'aria-label': aria }, ...btns.map((x) => x.b)),
    set: (v: T) => btns.forEach((x) => x.b.setAttribute('aria-pressed', String(x.v === v))),
  };
}

function select(label: string, aria: string, options: [string, string][], change: (v: string) => void): { el: HTMLElement; sel: HTMLSelectElement } {
  const sel = h('select', { class: 'select-native', 'aria-label': aria }, ...options.map(([v, t]) => h('option', { value: v }, t)));
  sel.addEventListener('change', () => change(sel.value));
  return { el: h('label', { class: 'select pl-select' }, h('span', { class: 'select-label micro-label' }, label), sel, icon('chevron', 'icon select-chevron')), sel };
}

export class PoolPanel {
  readonly el: HTMLElement;
  /** EXPORT and IMPORT of the pool file (placed in the middle column by the tab) */
  readonly fileButtons: HTMLElement[];
  private kit: PlayKit;
  private head = h('div', { class: 'pl-head' });
  private poolSel: HTMLSelectElement;
  private pick: HTMLElement;
  private renameRow: HTMLFormElement;
  private renameInput = h('input', { type: 'text', class: 'pb-input', maxlength: 48, 'aria-label': 'Pool name', autocomplete: 'off', spellcheck: 'false' });
  private delRow: HTMLElement;
  private delText = h('span', { class: 'pl-del-text' });
  private list = h('ul', { class: 'pl-list', 'aria-label': 'Pool entries' });
  private listSig = '';
  private startBtn = h('button', { type: 'button', class: 'btn pb-btn pl-start' }, h('span', { class: 'led', 'aria-hidden': 'true' }), h('span', { class: 'pl-start-label' }, 'START'));
  private footBtn = h('button', { type: 'button', class: 'btn pb-btn pl-foot', title: 'The footswitch: short press and hold do what CONFIG → FOOT says (also the key and a learned MIDI note or CC)' }, h('span', { class: 'led', 'aria-hidden': 'true' }), 'FOOT');
  private dir: HTMLSelectElement;
  private morphIn = h('input', { type: 'number', class: 'pb-input pl-morph-in', min: 0, step: 1, 'aria-label': 'Morph time' });
  private unit: ReturnType<typeof segs<'ms' | 'beats'>>;
  private adv: ReturnType<typeof segs<PoolAdvance>>;
  private autoMorph = h('button', { type: 'button', class: 'toggle toggle--accent pl-auto', title: 'Advancing by clock, MIDI and Program Change morphs over the MORPH time' }, h('span', { class: 'led', 'aria-hidden': 'true' }), h('span', { class: 'toggle-label' }, 'AUTO MORPH'));
  private ctx = h('div', { class: 'pl-row pl-ctx' });
  private bars: HTMLSelectElement;
  private clockSegs: ReturnType<typeof segs<'int' | 'midi'>>;
  private clockRow: HTMLElement;
  private midiRow: HTMLElement;
  private learnBtn = h('button', { type: 'button', class: 'pb-chip pl-learn' }, 'LEARN');
  private trigText = h('span', { class: 'pl-trig' });
  private trigClear = h('button', { type: 'button', class: 'pb-chip pl-x', 'aria-label': 'Remove the MIDI note or CC', title: 'Remove' }, '×');
  private handRow = h('p', { class: 'pl-hint' }, 'STEP or the footswitch advance. While it runs, Program Change n jumps to entry n.');
  private progress = h('span', { class: 'pl-progress', 'aria-hidden': 'true' });
  private fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });

  constructor(
    private engine: EngineAPI,
    private notify: Notify,
  ) {
    const kit = (this.kit = playKit(engine));
    const { pools, player, session } = kit;

    /* ---------- head: choice, new, rename, delete ---------- */
    const pickSel = select('POOL', 'Pool', [], (id) => pools.select(id));
    this.poolSel = pickSel.sel;
    const chip = (label: string, title: string, fn: () => void) => {
      const b = h('button', { type: 'button', class: 'pb-chip', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    this.pick = h(
      'div',
      { class: 'pl-pick' },
      pickSel.el,
      chip('NEW', 'A new empty pool', () => {
        const p = pools.add();
        if (!p) return notify('That is as many pools as fit.', 'error');
        this.setHead('rename');
      }),
      chip('REN', 'Rename this pool', () => this.setHead('rename')),
      chip('DEL', 'Delete this pool', () => this.setHead('delete')),
    );
    const ok = h('button', { type: 'submit', class: 'pb-chip' }, 'OK');
    const cancel = chip('CANCEL', '', () => this.setHead('pick'));
    this.renameRow = h('form', { class: 'pl-pick', novalidate: true }, this.renameInput, ok, cancel);
    this.renameRow.addEventListener('submit', (e) => {
      e.preventDefault();
      pools.rename(pools.selected.id, this.renameInput.value);
      this.setHead('pick');
    });
    const delYes = h('button', { type: 'button', class: 'pb-chip pl-danger' }, 'DELETE');
    delYes.addEventListener('click', () => {
      const name = pools.selected.name;
      const last = pools.pools().length === 1;
      pools.remove(pools.selected.id);
      this.setHead('pick');
      notify(last ? `Emptied “${name}” (one pool always stays)` : `Deleted “${name}”`);
    });
    this.delRow = h('div', { class: 'pl-pick pl-confirm' }, this.delText, delYes, chip('CANCEL', '', () => this.setHead('pick')));
    this.head.append(this.pick, this.renameRow, this.delRow);
    for (const row of [this.renameRow, this.delRow])
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        this.setHead('pick');
      });

    /* ---------- entries: drop zone for library rows and reordering ---------- */
    this.list.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (!types.includes(PRESET_DRAG_TYPE) && !types.includes(ENTRY_DRAG_TYPE)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes(ENTRY_DRAG_TYPE) ? 'move' : 'copy';
      this.markDrop(this.dropIndex(e));
    });
    this.list.addEventListener('dragleave', (e) => {
      if (!this.list.contains(e.relatedTarget as Node | null)) this.markDrop(-1);
    });
    this.list.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      e.preventDefault();
      const at = this.dropIndex(e);
      this.markDrop(-1);
      const pool = pools.selected;
      const from = dt.getData(ENTRY_DRAG_TYPE);
      if (from !== '') {
        const f = Number(from);
        pools.moveEntry(pool.id, f, at > f ? at - 1 : at);
        return;
      }
      const preset = session.store.get(dt.getData(PRESET_DRAG_TYPE));
      if (!preset) return;
      if (!pools.addEntry(pool.id, preset, at)) notify('The pool is full.', 'error');
    });

    /* ---------- transport ---------- */
    const btn = (label: string, title: string, fn: () => void) => {
      const b = h('button', { type: 'button', class: 'btn pb-btn', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const told = (p: ReturnType<typeof player.step>) => {
      if (!p) notify(poolNotice(kit, p), 'error');
    };
    this.startBtn.addEventListener('click', () => (player.running ? player.stop() : told(player.start())));
    const transport = h(
      'div',
      { class: 'pl-transport' },
      this.startBtn,
      btn('STEP', 'The next entry (in the pool’s direction)', () => told(player.step(false))),
      btn('STEP+MORPH', 'Morph to the next entry over the MORPH time', () => told(player.step(true))),
      btn('RESET', 'Back to the first entry', () => told(player.reset())),
      this.footBtn,
    );
    const foot = kit.foot;
    this.footBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.footBtn.setPointerCapture?.(e.pointerId);
      foot.press('button', e.timeStamp);
    });
    for (const ev of ['pointerup', 'pointercancel'] as const) this.footBtn.addEventListener(ev, () => foot.release('button'));
    this.footBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      foot.press('button', e.timeStamp);
    });
    this.footBtn.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') foot.release('button');
    });
    foot.onChange(() => toggleClass(this.footBtn, 'is-on', foot.pressed));

    /* ---------- how it plays ---------- */
    const upd = (patch: Parameters<typeof pools.update>[1]) => pools.update(pools.selected.id, patch);
    const dirSel = select('DIR', 'Direction', POOL_DIRS.map((d) => [d, POOL_DIR_LABELS[d]]), (v) => upd({ dir: v as (typeof POOL_DIRS)[number] }));
    this.dir = dirSel.sel;
    this.morphIn.addEventListener('change', () => upd({ morph: Number(this.morphIn.value) }));
    this.unit = segs<'ms' | 'beats'>(
      [
        ['ms', 'MS', 'Morph time in milliseconds'],
        ['beats', 'BEATS', 'Morph time in beats of the pool’s clock'],
      ],
      'Morph time unit',
      (v) => upd({ morphUnit: v }),
    );
    const morphRow = h('div', { class: 'pl-row' }, dirSel.el, h('span', { class: 'cfg-key pl-key', title: 'How long STEP+MORPH (and AUTO MORPH) glide' }, 'MORPH'), this.morphIn, this.unit.el, this.progress);
    this.adv = segs<PoolAdvance>(
      (['hand', 'clock', 'midi'] as const).map((a) => [a, ...ADVANCE_LABELS[a]] as [PoolAdvance, string, string]),
      'Advance',
      (v) => upd({ advance: v }),
    );
    this.autoMorph.addEventListener('click', () => upd({ autoMorph: !pools.selected.autoMorph }));
    const advRow = h('div', { class: 'pl-row' }, h('span', { class: 'cfg-key pl-key' }, 'ADVANCE'), this.adv.el, h('span', { class: 'cfg-grow' }), this.autoMorph);

    const barsSel = select('EVERY', 'Advance every', POOL_BARS.map((b) => [String(b), `${b} bar${b === 1 ? '' : 's'}`]), (v) => upd({ bars: Number(v) }));
    this.bars = barsSel.sel;
    this.clockSegs = segs<'int' | 'midi'>(
      [
        ['int', 'INT', 'The internal clock (the MIDI clock stands in while it is off)'],
        ['midi', 'MIDI', 'The MIDI clock (the internal clock stands in while it is off)'],
      ],
      'Clock of the pool',
      (v) => upd({ clock: v }),
    );
    this.clockRow = h('div', { class: 'pl-sub' }, barsSel.el, h('span', { class: 'cfg-key pl-key' }, 'OF'), this.clockSegs.el);
    this.learnBtn.addEventListener('click', () => {
      const m = engine.midi;
      if (m.status !== 'on') return notify('Switch MIDI on first (CONFIG → MIDI).', 'error');
      m.learnTrigger(m.triggerLearning === 'pool' ? null : 'pool');
    });
    this.trigClear.addEventListener('click', () => engine.midi.setTrigger('pool', null));
    this.midiRow = h('div', { class: 'pl-sub' }, h('span', { class: 'cfg-key cfg-key--auto pl-key', title: 'The MIDI note or CC that advances the pool (also on CONFIG → FOOT)' }, 'MIDI NOTE / CC'), this.trigText, this.trigClear, this.learnBtn);
    this.ctx.append(this.clockRow, this.midiRow, this.handRow);

    /* ---------- file (buttons shown in the middle column) ---------- */
    const exp = h('button', { type: 'button', class: 'btn pb-btn', title: 'Download all pools as one file' }, 'Export');
    exp.addEventListener('click', () => void this.doExport());
    const imp = h('button', { type: 'button', class: 'btn pb-btn', title: 'Add the pools of a file' }, 'Import…');
    imp.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.doImport(f);
    });
    this.fileButtons = [exp, imp];

    this.el = h(
      'section',
      { class: 'pl', 'aria-label': 'Pool' },
      this.head,
      this.list,
      transport,
      h('div', { class: 'pl-settings' }, morphRow, advRow, this.ctx),
      this.fileInput,
    );

    pools.onChange(() => this.render());
    player.onChange(() => this.render());
    session.onChange(() => this.renderList());
    session.store.onChange(() => this.render());
    engine.midi.onChange(() => this.renderMidi());
    // morph progress while one runs
    frameLoop.add(() => {
      const k = session.morphProgress;
      const w = k < 0 ? '0%' : `${Math.round(k * 100)}%`;
      if (this.progress.style.width !== w) this.progress.style.width = w;
      toggleClass(this.progress, 'is-on', k >= 0);
    });
    this.setHead('pick');
    this.render();
  }

  private setHead(mode: HeadMode): void {
    const { pools } = this.kit;
    this.pick.hidden = mode !== 'pick';
    this.renameRow.hidden = mode !== 'rename';
    this.delRow.hidden = mode !== 'delete';
    if (mode === 'rename') {
      this.renameInput.value = pools.selected.name;
      this.renameInput.focus();
      this.renameInput.select();
    } else if (mode === 'delete') {
      const p = pools.selected;
      this.delText.textContent = pools.pools().length === 1 ? `Empty “${p.name}”?` : `Delete “${p.name}”?`;
    }
  }

  /** index the dragged item lands before (entries.length = at the end) */
  private dropIndex(e: DragEvent): number {
    const rows = [...this.list.querySelectorAll<HTMLElement>('.pl-item')];
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) return Number(r.dataset.i);
    }
    return rows.length;
  }

  private markDrop(i: number): void {
    for (const r of this.list.querySelectorAll<HTMLElement>('.pl-item, .pl-add')) toggleClass(r, 'is-drop', Number(r.dataset.i) === i);
  }

  private render(): void {
    const { pools } = this.kit;
    const p = pools.selected;
    // pool choice
    const sig = pools
      .pools()
      .map((x) => `${x.id}:${x.name}`)
      .join('/');
    if (this.poolSel.dataset.sig !== sig) {
      this.poolSel.dataset.sig = sig;
      this.poolSel.replaceChildren(...pools.pools().map((x) => h('option', { value: x.id }, x.name)));
    }
    this.poolSel.value = p.id;
    this.poolSel.title = p.name;
    // settings
    this.dir.value = p.dir;
    if (document.activeElement !== this.morphIn) this.morphIn.value = String(p.morph);
    this.morphIn.max = String(p.morphUnit === 'ms' ? MORPH_MS_MAX : MORPH_BEATS_MAX);
    this.morphIn.step = p.morphUnit === 'ms' ? '50' : '0.25';
    this.morphIn.title = p.morphUnit === 'ms' ? 'Morph time in ms (0 = jump)' : 'Morph time in beats of the pool’s clock (0 = jump)';
    this.unit.set(p.morphUnit);
    this.adv.set(p.advance);
    toggleClass(this.autoMorph, 'is-on', p.autoMorph);
    this.autoMorph.setAttribute('aria-pressed', String(p.autoMorph));
    this.bars.value = String(p.bars);
    this.clockSegs.set(p.clock);
    this.clockRow.hidden = p.advance !== 'clock';
    this.midiRow.hidden = p.advance !== 'midi';
    this.handRow.hidden = p.advance !== 'hand';
    // transport
    const running = this.kit.player.running;
    toggleClass(this.startBtn, 'is-on', running);
    this.startBtn.querySelector('.pl-start-label')!.textContent = running ? 'STOP' : 'START';
    this.startBtn.title = running ? 'Stop: the pool no longer advances by itself, Program Change loads presets again' : 'Start: play the pool from its current entry; it advances as ADVANCE says, Program Change n jumps to entry n';
    this.renderMidi();
    this.renderList();
  }

  private renderMidi(): void {
    const m = this.engine.midi;
    const t = m.triggerOf('pool');
    const learning = m.triggerLearning === 'pool';
    this.trigText.textContent = learning ? 'play a note or move a CC…' : t ? triggerText(t) : 'none';
    toggleClass(this.trigText, 'is-set', !!t && !learning);
    this.trigClear.hidden = !t || learning;
    this.learnBtn.textContent = learning ? 'CANCEL' : 'LEARN';
    toggleClass(this.learnBtn, 'is-on', learning);
    this.learnBtn.title = m.status === 'on' ? 'Learn: play the note or move the CC that advances the pool' : 'Switch MIDI on first (CONFIG → MIDI)';
  }

  private renderList(): void {
    const { pools, player, session } = this.kit;
    const p = pools.selected;
    const sig = `${p.id}|${p.entries.map((e) => `${e.id}:${e.name}:${session.store.get(e.id) ? 1 : 0}`).join('/')}`;
    if (sig !== this.listSig) {
      this.listSig = sig;
      const rows: HTMLElement[] = p.entries.map((e, i) => {
        const missing = !session.store.get(e.id);
        const name = h('button', { type: 'button', class: 'pl-name', title: missing ? 'This preset was deleted; the pool skips it' : 'Play this entry' }, h('span', { class: 'pl-num' }, String(i + 1)), h('span', { class: 'pl-label' }, e.name), missing ? h('span', { class: 'pl-missing' }, 'missing') : null);
        name.addEventListener('click', () => {
          if (!player.play(i)) this.notify(`“${e.name}” is no longer in the library.`, 'error');
        });
        const x = h('button', { type: 'button', class: 'pl-x', 'aria-label': `Remove ${e.name} from the pool`, title: 'Remove from the pool' }, '×');
        x.addEventListener('click', () => pools.removeEntry(p.id, i));
        const li = h('li', { class: `pl-item${missing ? ' is-missing' : ''}`, 'data-i': i, draggable: 'true' }, name, x);
        li.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData(ENTRY_DRAG_TYPE, String(i));
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
          li.classList.add('is-dragging');
        });
        li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
        // Alt + ↑ ↓ moves the entry
        name.addEventListener('keydown', (ev) => {
          if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
          ev.preventDefault();
          const to = i + (ev.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= p.entries.length) return;
          pools.moveEntry(p.id, i, to);
          (this.list.querySelector<HTMLElement>(`.pl-item[data-i="${to}"] .pl-name`) ?? null)?.focus({ preventScroll: true });
        });
        return li;
      });
      const add = h('button', { type: 'button', class: 'pl-addbtn', title: 'Add the loaded preset at the end (or drag presets in from the library)' }, '+ Add loaded preset');
      add.addEventListener('click', () => {
        const pr = session.preset;
        if (!pr) return this.notify('The sound is not a stored preset: save it first.', 'error');
        if (!pools.addEntry(p.id, pr)) this.notify('The pool is full.', 'error');
      });
      rows.push(h('li', { class: 'pl-add', 'data-i': p.entries.length }, add, p.entries.length ? null : h('span', { class: 'pl-hint' }, 'or drag presets in from the library')));
      this.list.replaceChildren(...rows);
    }
    // the current entry, and whether it is what is loaded
    for (const li of this.list.querySelectorAll<HTMLElement>('.pl-item')) {
      const i = Number(li.dataset.i);
      const cur = i === player.pos;
      toggleClass(li, 'is-current', cur);
      toggleClass(li, 'is-running', cur && player.running);
      const loaded = p.entries[i]?.id === session.presetId;
      toggleClass(li, 'is-loaded', loaded);
      const btn = li.querySelector('.pl-name');
      if (cur) btn?.setAttribute('aria-current', 'true');
      else btn?.removeAttribute('aria-current');
    }
  }

  private async doExport(): Promise<void> {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const name = `resonator-pools-${stamp}.json`;
    const r = await saveText(name, this.kit.pools.exportText());
    if (r === 'saved') this.notify(`Exported ${name}`);
    else if (r === 'failed') this.notify('Download blocked here. Run the app locally to export pools.', 'error');
  }

  private async doImport(file: File): Promise<void> {
    const text = await readTextFile(file);
    if (text === null) return this.notify(`Couldn’t read “${file.name}”.`, 'error');
    const r = this.kit.pools.importText(text, this.kit.session.store.list());
    if (!r.ok) return this.notify(`Import failed: ${r.reason}`, 'error');
    this.notify(`Imported ${r.count === 1 ? 'one pool' : `${r.count} pools`}${r.missing ? ` (${r.missing} preset${r.missing === 1 ? '' : 's'} not found in the library)` : ''}`);
  }
}
