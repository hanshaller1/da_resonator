/**
 * Preset browser page (PLAY/LOAD tab): library list with categories, search and an
 * All / Factory / User filter on the left; the loaded preset, A/B compare, save / rename /
 * delete and file import / export on the right.
 */
import type { EngineAPI } from '../../../core/types';
import { readTextFile, saveText } from '../../../presets/files';
import { CATEGORY_MAX, DEFAULT_CATEGORY, NAME_MAX, type Preset } from '../../../presets/io';
import type { PresetSession } from '../../../presets/session';
import { h, toggleClass } from '../../dom';
import { picon } from './icons';

export type Notify = (msg: string, tone?: 'error' | 'info') => void;

type Filter = 'all' | 'factory' | 'user';
type Mode = 'list' | 'saveas' | 'rename' | 'delete';

let uid = 0;

/** a module's state provider may throw on odd data: report instead of leaving a dead click */
export function loadSafely(fn: () => unknown, notify: Notify): void {
  try {
    fn();
  } catch (err) {
    console.error('[presets] load failed', err);
    notify('This preset could not be loaded completely.', 'error');
  }
}

/** modules of the live sound, for the summary under the preset name (same rules as the tab LEDs) */
function soundSummary(engine: EngineAPI): { label: string; on: boolean }[] {
  const p = engine.params;
  const anyOn = (ids: string[]) => ids.some((x) => p.get(x) >= 0.5);
  const n = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}.on`);
  return [
    { label: 'FB', on: anyOn(['fbAllOn', 'fbAllOnR']) || Array.from({ length: 10 }, (_, b) => Math.max(p.get(`band${b}.fb`), p.get(`band${b}.fbR`)) > 0.02).some(Boolean) },
    { label: 'FILTER', on: anyOn(['filterPre.on', 'filterPost.on']) },
    { label: 'CLK MOD', on: anyOn(n('cmod', 2)) },
    { label: 'DYN EQ', on: anyOn(['dyn.on']) },
    { label: 'ENV MOD', on: anyOn(n('ef', 4)) },
    { label: 'LFO MOD', on: anyOn(n('lfo', 4)) },
  ];
}

let mounted: PresetBrowser | null = null;

/** focus the loaded preset in the browser (after the header switched to PLAY/LOAD) */
export function focusPresetBrowser(): void {
  mounted?.focusCurrent();
}

export class PresetBrowser {
  readonly el: HTMLElement;
  private filter: Filter = 'all';
  private query = '';
  private mode: Mode = 'list';
  private listSig = '';

  private list = h('ul', { class: 'pb-list', 'aria-label': 'Presets' });
  private search = h('input', { type: 'search', class: 'pb-search-input', placeholder: 'Search name or category', 'aria-label': 'Search presets', autocomplete: 'off', spellcheck: 'false' });
  private filterBtns: Record<Filter, HTMLButtonElement>;
  private abBtns: Record<'A' | 'B', HTMLButtonElement>;
  private abCopy = h('button', { type: 'button', class: 'pb-chip pb-ab-copy' });
  private note = h('p', { class: 'pb-note', hidden: true });

  /* loaded preset card */
  private curName = h('span', { class: 'pp-cur-name' });
  private curMeta = h('span', { class: 'pp-cur-meta' });
  private curState = h('span', { class: 'pp-cur-state' });
  private curSound = h('div', { class: 'pp-sound', 'aria-label': 'Modules in use' });

  private form: HTMLFormElement;
  private formTitle = h('span', { class: 'micro-label' });
  private nameInput: HTMLInputElement;
  private catInput: HTMLInputElement;
  private catList: HTMLDataListElement;
  private formSubmit = h('button', { type: 'submit', class: 'btn pb-btn pb-btn--primary' });

  private confirm: HTMLElement;
  private confirmText = h('span', { class: 'pb-confirm-text' });
  private confirmYes = h('button', { type: 'button', class: 'btn pb-btn pb-btn--danger' }, 'Delete');
  private confirmNo = h('button', { type: 'button', class: 'btn pb-btn' }, 'Cancel');

  private actions: HTMLElement;
  private btn: Record<'save' | 'saveas' | 'rename' | 'delete' | 'export' | 'exportAll' | 'import', HTMLButtonElement>;
  private fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });

  constructor(
    private engine: EngineAPI,
    private session: PresetSession,
    private notify: Notify,
  ) {
    const id = `pb-${++uid}`;
    const mkFilter = (f: Filter, label: string) => {
      const b = h('button', { type: 'button', class: 'pb-seg', 'aria-pressed': 'false' }, label);
      b.addEventListener('click', () => {
        this.filter = f;
        this.render();
      });
      return b;
    };
    this.filterBtns = { all: mkFilter('all', 'All'), factory: mkFilter('factory', 'Factory'), user: mkFilter('user', 'User') };

    const mkAb = (slot: 'A' | 'B') => {
      const b = h('button', { type: 'button', class: 'pb-seg pb-ab-slot', 'aria-pressed': 'false', 'aria-label': `Compare slot ${slot}` }, slot);
      b.addEventListener('click', () => session.switchAb(slot));
      return b;
    };
    this.abBtns = { A: mkAb('A'), B: mkAb('B') };
    this.abCopy.addEventListener('click', () => {
      session.copyAb();
      notify(`Copied ${session.ab} to ${session.ab === 'A' ? 'B' : 'A'}`);
    });

    /* ---- save as / rename form ---- */
    this.nameInput = h('input', { type: 'text', class: 'pb-input', id: `${id}-name`, maxlength: NAME_MAX, required: true, autocomplete: 'off', spellcheck: 'false' });
    this.catList = h('datalist', { id: `${id}-cats` });
    this.catInput = h('input', { type: 'text', class: 'pb-input', id: `${id}-cat`, maxlength: CATEGORY_MAX, list: `${id}-cats`, autocomplete: 'off', spellcheck: 'false', placeholder: DEFAULT_CATEGORY });
    const formCancel = h('button', { type: 'button', class: 'btn pb-btn' }, 'Cancel');
    formCancel.addEventListener('click', () => this.setMode('list'));
    this.form = h(
      'form',
      { class: 'pb-form', hidden: true, novalidate: true },
      this.formTitle,
      h('div', { class: 'pb-fields' }, h('label', { class: 'pb-field', for: `${id}-name` }, h('span', { class: 'micro-label' }, 'Name'), this.nameInput), h('label', { class: 'pb-field pb-field--cat', for: `${id}-cat` }, h('span', { class: 'micro-label' }, 'Category'), this.catInput)),
      this.catList,
      h('div', { class: 'pb-row-end' }, formCancel, this.formSubmit),
    );
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitForm();
    });

    /* ---- delete confirmation ---- */
    this.confirm = h('div', { class: 'pb-confirm', role: 'group', 'aria-label': 'Confirm delete', hidden: true }, this.confirmText, h('div', { class: 'pb-row-end' }, this.confirmNo, this.confirmYes));
    this.confirmNo.addEventListener('click', () => this.setMode('list'));
    this.confirmYes.addEventListener('click', () => void this.doDelete());

    /* ---- actions ---- */
    const mk = (label: string, title: string, fn: () => void) => {
      const b = h('button', { type: 'button', class: 'btn pb-btn', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    this.btn = {
      save: mk('Save', 'Overwrite the loaded user preset with the current sound', () => void this.doSave()),
      saveas: mk('Save as…', 'Save the current sound as a new preset', () => this.setMode('saveas')),
      rename: mk('Rename', 'Rename the loaded user preset or change its category', () => this.setMode('rename')),
      delete: mk('Delete', 'Delete the loaded user preset', () => this.setMode('delete')),
      export: mk('Export', 'Download the current sound as a preset file', () => void this.doExport(false)),
      exportAll: mk('Export all', 'Download all user presets as one file', () => void this.doExport(true)),
      import: mk('Import…', 'Load presets from a file', () => this.fileInput.click()),
    };
    const row = (label: string, ...btns: HTMLElement[]) =>
      h('div', { class: 'pp-act-row', role: 'group', 'aria-label': label }, h('span', { class: 'micro-label pp-act-label' }, label), h('div', { class: 'pb-actions-group' }, ...btns));
    this.actions = h(
      'div',
      { class: 'pb-actions' },
      row('Preset', this.btn.save, this.btn.saveas, this.btn.rename, this.btn.delete),
      row('Files', this.btn.export, this.btn.exportAll, this.btn.import),
    );
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.doImport(f);
    });

    /* ---- search & list keyboard ---- */
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.render();
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        const first = this.items()[0];
        if (!first) return;
        e.preventDefault();
        if (e.key === 'Enter') first.click();
        this.focusItem(first);
      } else if (e.key === 'Escape' && this.search.value) {
        // clear the search first; keep Esc from reaching assign mode / panic
        e.preventDefault();
        e.stopPropagation();
        this.query = this.search.value = '';
        this.render();
      }
    });
    this.list.addEventListener('keydown', (e) => this.onListKey(e));

    /* ---- layout ---- */
    const lib = h(
      'section',
      { class: 'pp-lib', 'aria-label': 'Preset library' },
      h(
        'div',
        { class: 'pb-filter' },
        h('div', { class: 'pb-segs', role: 'group', 'aria-label': 'Show' }, this.filterBtns.all, this.filterBtns.factory, this.filterBtns.user),
        h('label', { class: 'pb-search' }, picon('search', 'icon pb-search-icon'), this.search),
      ),
      this.list,
    );
    const current = h(
      'section',
      { class: 'pp-current', 'aria-label': 'Loaded preset' },
      h(
        'div',
        { class: 'pp-cur-head' },
        h('span', { class: 'micro-label' }, 'Loaded'),
        h('div', { class: 'pb-ab', role: 'group', 'aria-label': 'A/B compare', title: 'Compare two versions of the sound' }, h('span', { class: 'micro-label pb-ab-label' }, 'A/B'), h('div', { class: 'pb-segs' }, this.abBtns.A, this.abBtns.B), this.abCopy),
      ),
      h('div', { class: 'pp-cur-title' }, this.curName, this.curState),
      this.curMeta,
      this.curSound,
    );
    this.el = h(
      'div',
      { class: 'pp', id },
      lib,
      h('div', { class: 'pp-side' }, current, h('div', { class: 'pp-work' }, this.actions, this.form, this.confirm), this.note, this.fileInput),
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.mode === 'list') return;
      // leave the form / confirmation; keep Esc from also ending assign mode or triggering panic
      e.preventDefault();
      e.stopPropagation();
      this.setMode('list');
    });

    session.onChange(() => this.render());
    session.store.onChange(() => this.render());
    // module LEDs follow the live sound (coalesced: a preset load changes hundreds of params)
    let pending = false;
    const soon = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        this.renderSound();
      });
    };
    engine.params.subscribeAll(soon);
    engine.mod.onChange(soon);
    this.render();
    mounted = this;
  }

  /** focus the loaded preset (or the search field when the list is empty) */
  focusCurrent(): void {
    if (this.mode !== 'list') this.setMode('list', false);
    this.render();
    const cur = this.items().find((b) => b.dataset.id === this.session.presetId) ?? this.items()[0];
    if (cur) this.focusItem(cur);
    else this.search.focus();
  }

  /* ---- rendering ---- */

  private items(): HTMLButtonElement[] {
    return [...this.list.querySelectorAll<HTMLButtonElement>('.pb-item')];
  }

  /** focus a row and scroll only the list (scrollIntoView would also shift the clipped stage) */
  private focusItem(b: HTMLButtonElement): void {
    for (const x of this.items()) x.tabIndex = x === b ? 0 : -1;
    b.focus({ preventScroll: true });
    this.reveal(b);
  }

  private reveal(b: HTMLElement): void {
    const top = b.offsetTop - this.list.offsetTop;
    const bottom = top + b.offsetHeight;
    const pad = 24; // keep a group heading above in view
    if (top - pad < this.list.scrollTop) this.list.scrollTop = Math.max(0, top - pad);
    else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight + 4;
  }

  private visible(): Preset[] {
    const q = this.query.trim().toLowerCase();
    return this.session.store
      .list()
      .filter((p) => (this.filter === 'all' ? true : this.filter === 'factory' ? !!p.factory : !p.factory))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }

  render(): void {
    const ses = this.session;
    const store = ses.store;
    for (const [f, b] of Object.entries(this.filterBtns)) b.setAttribute('aria-pressed', String(f === this.filter));
    for (const [slot, b] of Object.entries(this.abBtns)) {
      b.setAttribute('aria-pressed', String(slot === ses.ab));
      toggleClass(b, 'is-on', slot === ses.ab);
    }
    const other = ses.ab === 'A' ? 'B' : 'A';
    this.abCopy.textContent = `${ses.ab}→${other}`;
    this.abCopy.setAttribute('aria-label', `Copy slot ${ses.ab} to slot ${other}`);
    this.abCopy.title = `Copy the current sound to slot ${other}`;

    /* loaded preset */
    const p = ses.preset;
    this.curName.textContent = ses.name;
    this.curName.title = ses.name;
    this.curMeta.textContent = p ? `${p.factory ? 'Factory' : 'User'} · ${p.category}` : 'Not in the library (deleted or unsaved)';
    this.curState.textContent = ses.dirty ? 'Modified' : 'Saved';
    toggleClass(this.curState, 'is-dirty', ses.dirty);

    const user = store.userPresets();
    const canEdit = ses.canSave;
    this.btn.save.disabled = !canEdit;
    this.btn.rename.disabled = !canEdit;
    this.btn.delete.disabled = !canEdit;
    this.btn.exportAll.disabled = user.length === 0;
    toggleClass(this.btn.save, 'is-due', canEdit && ses.dirty);

    this.note.hidden = store.persistent;
    this.note.textContent = 'Storage is blocked here: presets last until this page closes. Use Export to keep them.';

    this.renderList();
    this.renderSound();
  }

  private renderSound(): void {
    const mods = soundSummary(this.engine);
    const routes = this.engine.mod.routes().length;
    const sig = mods.map((m) => (m.on ? 1 : 0)).join('') + routes;
    if (sig === this.curSound.dataset.sig) return;
    this.curSound.dataset.sig = sig;
    this.curSound.replaceChildren(
      ...mods.map((m) => h('span', { class: `pp-mod${m.on ? ' is-on' : ''}` }, h('span', { class: 'led', 'aria-hidden': 'true' }), m.label)),
      h('span', { class: 'pp-routes' }, routes ? `${routes} route${routes === 1 ? '' : 's'}` : 'no routes'),
    );
  }

  private renderList(): void {
    const ses = this.session;
    const shown = this.visible();
    const sig = `${this.filter}|${this.query}|${shown.map((p) => `${p.id}:${p.name}:${p.category}`).join('/')}`;
    if (sig !== this.listSig) {
      this.listSig = sig;
      const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.id;
      const rows: HTMLElement[] = [];
      let group = '';
      for (const p of shown) {
        const g = p.factory ? `Factory · ${p.category}` : p.category.toLowerCase() === DEFAULT_CATEGORY.toLowerCase() ? 'User' : `User · ${p.category}`;
        if (g !== group) {
          group = g;
          rows.push(h('li', { class: 'pb-group', role: 'presentation' }, g));
        }
        const b = h(
          'button',
          { type: 'button', class: 'pb-item', 'data-id': p.id, tabindex: -1 },
          h('span', { class: 'pb-item-name' }, p.name),
          h('span', { class: 'pb-item-state', 'aria-hidden': 'true' }),
          h('span', { class: 'pb-item-dot', 'aria-hidden': 'true' }),
        );
        b.addEventListener('click', () => {
          // look up at click time: Save replaces the stored sound without rebuilding the list
          const fresh = ses.store.get(p.id);
          if (fresh) loadSafely(() => ses.load(fresh), this.notify);
          b.focus({ preventScroll: true });
        });
        rows.push(h('li', null, b));
      }
      if (!shown.length) {
        const msg = this.query.trim()
          ? `No presets match “${this.query.trim()}”.`
          : this.filter === 'user'
            ? 'No user presets yet. Use “Save as…” to keep the current sound, or import a file.'
            : 'No presets.';
        rows.push(h('li', { class: 'pb-empty' }, msg));
      }
      this.list.replaceChildren(...rows);
      if (focusedId) this.items().find((b) => b.dataset.id === focusedId)?.focus({ preventScroll: true });
    }
    // loaded preset + roving tab stop
    const items = this.items();
    const cur = items.find((b) => b.dataset.id === ses.presetId);
    const stop = items.find((b) => b === document.activeElement) ?? cur ?? items[0];
    for (const b of items) {
      const isCur = b === cur;
      if (isCur) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
      toggleClass(b, 'is-dirty', isCur && ses.dirty);
      b.tabIndex = b === stop ? 0 : -1;
      b.title = isCur && ses.dirty ? 'Loaded, modified' : isCur ? 'Loaded' : 'Load preset';
      const st = b.querySelector('.pb-item-state');
      if (st) st.textContent = isCur ? (ses.dirty ? 'modified' : 'loaded') : '';
    }
  }

  private onListKey(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp') {
      if (i === 0) {
        e.preventDefault();
        this.search.focus();
        return;
      }
      j = i - 1;
    } else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else if (e.key === 'PageDown') j = Math.min(items.length - 1, i + 8);
    else if (e.key === 'PageUp') j = Math.max(0, i - 8);
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type to search
      this.search.focus();
      return;
    }
    if (j < 0) return;
    e.preventDefault();
    this.focusItem(items[j]);
  }

  /* ---- modes: list / save as / rename / delete ---- */

  private setMode(mode: Mode, focus = true): void {
    this.mode = mode;
    const ses = this.session;
    this.form.hidden = mode !== 'saveas' && mode !== 'rename';
    this.confirm.hidden = mode !== 'delete';
    this.actions.hidden = mode !== 'list';
    if (mode === 'saveas' || mode === 'rename') {
      const p = ses.preset;
      const rename = mode === 'rename';
      this.formTitle.textContent = rename ? 'Rename preset' : 'Save as new preset';
      this.formSubmit.textContent = rename ? 'Rename' : 'Save';
      this.nameInput.value = rename ? (p?.name ?? '') : ses.name;
      this.nameInput.removeAttribute('aria-invalid');
      this.catInput.value = p && !p.factory ? p.category : DEFAULT_CATEGORY;
      this.catList.replaceChildren(...[...new Set([DEFAULT_CATEGORY, ...ses.store.categories()])].map((c) => h('option', { value: c })));
      if (focus) {
        this.nameInput.focus();
        this.nameInput.select();
      }
    } else if (mode === 'delete') {
      this.confirmText.textContent = `Delete “${ses.name}”? This can’t be undone.`;
      if (focus) this.confirmNo.focus();
    } else if (focus) {
      const stop = this.items().find((b) => b.tabIndex === 0);
      if (stop) this.focusItem(stop);
      else this.search.focus();
    }
  }

  private async submitForm(): Promise<void> {
    const name = this.nameInput.value.trim();
    if (!name) {
      this.nameInput.focus();
      this.nameInput.setAttribute('aria-invalid', 'true');
      return;
    }
    this.nameInput.removeAttribute('aria-invalid');
    const category = this.catInput.value.trim() || DEFAULT_CATEGORY;
    const ses = this.session;
    try {
      if (this.mode === 'rename' && ses.presetId) {
        const p = await ses.store.rename(ses.presetId, name, category);
        this.notify(`Renamed to “${p.name}”`);
      } else {
        const p = await ses.saveAs(name, category);
        if (this.filter === 'factory') this.filter = 'all';
        this.notify(`Saved “${p.name}”${ses.store.persistent ? '' : ' (this session only)'}`);
      }
    } catch (err) {
      console.error(err);
      this.notify('Could not save the preset.', 'error');
      return;
    }
    this.query = this.search.value = '';
    this.setMode('list', false);
    this.render();
    const cur = this.items().find((b) => b.dataset.id === ses.presetId);
    if (cur) this.focusItem(cur);
  }

  private async doSave(): Promise<void> {
    if (!this.session.canSave) return this.setMode('saveas');
    try {
      const p = await this.session.save();
      if (p) this.notify(`Saved “${p.name}”${this.session.store.persistent ? '' : ' (this session only)'}`);
    } catch (err) {
      console.error(err);
      this.notify('Could not save the preset.', 'error');
    }
  }

  private async doDelete(): Promise<void> {
    const ses = this.session;
    const id = ses.presetId;
    const name = ses.name;
    if (!id || !ses.canSave) return this.setMode('list');
    await ses.store.remove(id);
    this.setMode('list');
    this.notify(`Deleted “${name}”`);
  }

  private async doExport(all: boolean): Promise<void> {
    const f = all ? this.session.exportAll() : this.session.exportCurrent();
    const r = await saveText(f.fileName, f.text);
    if (r === 'saved') this.notify(`Exported ${f.fileName}`);
    else if (r === 'failed') this.notify('Download blocked here. Run the app locally to export presets.', 'error');
  }

  private async doImport(file: File): Promise<void> {
    const text = await readTextFile(file);
    if (text === null) return this.notify(`Couldn’t read “${file.name}”.`, 'error');
    const r = await this.session.store.importText(text, file.name);
    if (r.error) return this.notify(`Import failed: ${r.error}`, 'error');
    const n = r.added.length;
    const what = n === 1 ? `“${r.added[0].name}”` : `${n} presets`;
    this.notify(`Imported ${what}${r.warnings.length ? ` (${r.warnings.join('; ')})` : ''}`);
    this.filter = 'user';
    this.query = this.search.value = '';
    this.render();
    const first = this.items().find((b) => b.dataset.id === r.added[0].id);
    if (first) this.focusItem(first);
  }
}
