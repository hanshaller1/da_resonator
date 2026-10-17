/**
 * MACRO tab: eight macros. Control row slots 1–8 = the macro knobs. Visualisation = one card
 * per macro above its knob: editable name, value bar, ASSIGN chip and its targets (click shows the
 * control, drag the depth, ✕ removes, "+ target" adds); slots 9–10 carry a short how-to.
 * Names are saved in snapshots under modules.macros.
 * Slot 9 = MORPH: glides all eight macros from set A (left) to set B (right); A / B store the current
 * macros. Slot 10 = RND (all eight at random), SNAP (remember them) and ↺ (back to the snapshot).
 * Sets, snapshot and the MORPH position are saved under modules.macroMorph.
 */
import '../../styles/tabs/macro.css';
import type { EngineAPI, RouteInfo } from '../../core/types';
import { NUM_MACROS } from '../../shared/paramdefs/modules';
import { PARAM_BY_ID, formatValue } from '../../shared/params';
import { newRouteChannel } from '../channel';
import { Knob } from '../components/knob';
import { ParamField } from '../components/paramField';
import { SourceChip } from '../components/sourceChip';
import { h, toggleClass } from '../dom';
import { showBubble } from '../mod/feedback';
import { routeChannelButton } from '../mod/routeChannel';
import { MACRO_NAME_MAX, defaultMacroName, formatDepth, parseMacroNames, setSourceName, targetGroups, targetLabel } from '../mod/labels';
import { colLeft } from '../shell/bandAxis';
import { nav, registerTab } from '../shell/tabs';

const PENCIL = '✎';
const MODULE_SHORT: Record<string, string> = { filterPre: 'PRE', filterPost: 'POST', filterBand: 'BAND', dyn: 'DYN', clock: 'CLK', resonator: '' };

/** short target caption for a narrow card ('B5 RES', 'LFO2 RATE', 'PRE FREQ') */
function shortTarget(id: string): string {
  const s = PARAM_BY_ID[id];
  if (!s) return id;
  if (s.group === 'band' && s.band !== undefined) return `B${s.band + 1} ${s.short}`;
  if (s.members) return s.short;
  const m = /^(lfo|cmod|ef)(\d+)$/.exec(s.module);
  const mod = m ? `${{ lfo: 'LFO', cmod: 'CM', ef: 'EF' }[m[1]]}${m[2]}` : (MODULE_SHORT[s.module] ?? s.module.toUpperCase());
  return mod ? `${mod} ${s.short}` : s.label.toUpperCase();
}

/** one macro's target list in its card */
class TargetList {
  readonly el = h('ul', { class: 'mc-list' });
  private add = h('select', { class: 'mc-add', 'aria-label': 'Add target' });
  private fields: ParamField[] = [];
  private offs: (() => void)[] = [];

  constructor(
    private engine: EngineAPI,
    private source: string,
    private name: () => string,
  ) {
    this.add.addEventListener('change', () => {
      const tgt = this.add.value;
      this.add.value = '';
      if (!tgt) return;
      const r = engine.mod.addRoute(source, tgt, 0.5, newRouteChannel(tgt));
      if ('ok' in r && !r.ok) showBubble(this.add, r.reason, 'warn', 2200);
    });
  }

  get addEl(): HTMLSelectElement {
    return this.add;
  }

  refresh(): void {
    const { mod, params } = this.engine;
    for (const f of this.fields) f.destroy();
    this.fields = [];
    this.offs.splice(0).forEach((u) => u());
    const all = mod.routes();
    const routes = all.filter((r) => r.source === this.source);
    this.el.replaceChildren(...routes.map((r) => this.row(r, all)));
    if (!routes.length) this.el.append(h('li', { class: 'mc-empty' }, 'No targets'));
    this.add.replaceChildren(h('option', { value: '' }, '+ target'));
    for (const g of targetGroups(mod, this.source)) {
      const og = h('optgroup', { label: g.label });
      for (const o of g.options) if (!o.reason) og.append(h('option', { value: o.id }, o.label));
      if (og.childElementCount) this.add.append(og);
    }
    this.add.title = `Add a target for ${this.name()}`;
    void params;
  }

  private row(r: RouteInfo, all: RouteInfo[]): HTMLElement {
    const { params, mod } = this.engine;
    const full = targetLabel(r.target, all);
    const depth = new ParamField(params, r.depthParam, { label: '', format: formatDepth, ariaLabel: `Depth ${this.name()} to ${full}` });
    this.fields.push(depth);
    const target = h('button', { type: 'button', class: 'mc-target', title: `${full}: click to show it` }, shortTarget(r.target));
    target.addEventListener('click', () => {
      if (!nav.reveal(r.target)) showBubble(target, 'That control is not on screen', 'warn', 1600);
    });
    const rm = h('button', { type: 'button', class: 'mc-remove', 'aria-label': `Remove ${this.name()} → ${full}`, title: 'Remove' }, '✕');
    rm.addEventListener('click', () => mod.removeRoute(r.slot));
    const ch = routeChannelButton(mod, r);
    if (ch) this.offs.push(ch.dispose);
    return h('li', { class: ch ? 'mc-row has-ch' : 'mc-row' }, target, ch?.el ?? null, depth.el, rm);
  }
}

registerTab({
  id: 'macro',
  reveal: (id) => /^macro\d+\.value$/.test(id),
  mount(tab) {
    const { engine } = tab;
    const { params, mod } = engine;
    let names = parseMacroNames(undefined);
    const setters: ((name: string) => void)[] = [];
    const lists: TargetList[] = [];

    tab.root.classList.add('mc');
    const summary = h('span', { class: 'mc-summary' });
    tab.status.append(summary, h('span', { class: 'tp-spacer' }), h('span', { class: 'mc-tip' }, 'Arm ASSIGN, then drag a control to its macro maximum'));

    for (let i = 0; i < NUM_MACROS; i++) {
      const n = i + 1;
      const source = `macro${n}`;
      const valueId = `${source}.value`;

      /* ---- knob in slot i ---- */
      const knob = new Knob(params, valueId, { size: 'md', label: names[i], ariaLabel: names[i] });
      tab.slots[i].append(knob.el);

      /* ---- card above it ---- */
      const nameEl = h('span', { class: 'mc-name', title: 'Double-click to rename' });
      const editBtn = h('button', { type: 'button', class: 'mc-edit' }, PENCIL);
      const head = h('div', { class: 'mc-head' }, nameEl, editBtn);
      const value = h('output', { class: 'mc-value' });
      const fill = h('span', { class: 'mc-bar-fill' });
      const showValue = (v: number) => {
        value.textContent = formatValue(params.spec(valueId), v);
        fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(4)})`;
      };
      showValue(params.get(valueId));
      params.subscribe(valueId, showValue);

      const setName = (name: string) => {
        names[i] = name;
        nameEl.textContent = name;
        editBtn.setAttribute('aria-label', `Rename ${name}`);
        knob.setLabel(name, name);
        setSourceName(source, name === defaultMacroName(n) ? null : name);
      };
      setters.push(setName);

      // name editing: double-click or ✎; Enter saves, Esc cancels
      let editing = false;
      const startEdit = () => {
        if (editing) return;
        editing = true;
        const input = h('input', { type: 'text', class: 'mc-name-input', value: names[i], maxlength: MACRO_NAME_MAX, 'aria-label': `Name of macro ${n}`, spellcheck: 'false' });
        let done = false;
        /** refocus: finished from the keyboard (on blur, focus already went elsewhere) */
        const finish = (save: boolean, refocus: boolean) => {
          if (done) return;
          done = true;
          editing = false;
          if (save) setName(input.value.trim().slice(0, MACRO_NAME_MAX) || defaultMacroName(n));
          input.replaceWith(nameEl);
          editBtn.hidden = false;
          if (refocus) editBtn.focus({ preventScroll: true });
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true, true);
          } else if (e.key === 'Escape') {
            // keep Esc from also ending assign mode / triggering panic
            e.preventDefault();
            e.stopPropagation();
            finish(false, true);
          }
        });
        input.addEventListener('blur', () => finish(true, false));
        nameEl.replaceWith(input);
        editBtn.hidden = true;
        input.focus();
        input.select();
      };
      nameEl.addEventListener('dblclick', startEdit);
      editBtn.addEventListener('click', startEdit);

      const chip = new SourceChip(engine, source, { label: 'ASSIGN' });
      const list = new TargetList(engine, source, () => names[i]);
      lists.push(list);

      const card = h(
        'div',
        { class: 'mc-card', role: 'group', 'aria-label': `Macro ${n}`, 'data-macro': n },
        head,
        h('div', { class: 'mc-valrow' }, h('span', { class: 'mc-bar', 'aria-hidden': 'true' }, fill), value),
        chip.el,
        h('div', { class: 'mc-scroll' }, list.el),
        list.addEl,
      );
      // columns follow the band axis: card k sits over knob k
      card.style.left = `${(colLeft(i, 1044) / 1044) * 100}%`;
      tab.viz.append(card);
      setName(names[i]);
    }

    tab.viz.append(
      h(
        'div',
        { class: 'mc-help', style: `left:${(colLeft(NUM_MACROS, 1044) / 1044) * 100}%` },
        h('span', { class: 'micro-label' }, 'How to'),
        h('p', {}, h('b', {}, 'ASSIGN'), ' then drag any control: the macro moves it that far.'),
        h('p', {}, 'Click a target to show it, drag its % to change the depth.'),
        h('p', {}, h('b', {}, '+ target'), ' → Band Groups: one target for the faders of LOW, MID, HIGH or ALL bands.'),
        h('p', {}, 'Double-click a name to rename it. Names are saved with presets.'),
        h('p', {}, 'Right-click any control to add or edit its modulation.'),
      ),
    );

    const syncRoutes = () => {
      lists.forEach((l) => l.refresh());
      const count = mod.routes().filter((r) => /^macro\d+$/.test(r.source)).length;
      const used = new Set(mod.routes().filter((r) => /^macro\d+$/.test(r.source)).map((r) => r.source)).size;
      summary.textContent = `Macros · ${used} of ${NUM_MACROS} in use · ${count} target${count === 1 ? '' : 's'}`;
    };
    mod.onChange(syncRoutes);
    syncRoutes();

    /* ---------- slot 9: MORPH A ↔ B, slot 10: RND · SNAP · recall ---------- */
    const ids = Array.from({ length: NUM_MACROS }, (_, i) => `macro${i + 1}.value`);
    const current = () => ids.map((id) => params.get(id));
    let setA: number[] | null = null;
    let setB: number[] | null = null;
    let snap: number[] | null = null;
    /** MORPH set by a load or a store: move the knob only, not the macros */
    let quiet = false;
    const writeAll = (vals: number[]) => {
      ids.forEach((id) => params.beginGesture(id));
      ids.forEach((id, i) => params.set(id, vals[i]));
      ids.forEach((id) => params.endGesture(id));
    };
    const setMorph = (v: number) => {
      quiet = true;
      params.set('macros.morph', v);
      quiet = false;
    };
    params.subscribe('macros.morph', (m) => {
      if (quiet) return;
      // a missing set starts where the macros are, so the first turn does not jump
      setA ??= current();
      setB ??= current();
      const a = setA, b = setB;
      ids.forEach((id, i) => params.set(id, a[i] + (b[i] - a[i]) * m));
      syncKeys();
    });
    const morph = new Knob(params, 'macros.morph', { size: 'md', label: 'MORPH', ariaLabel: 'Macro morph A to B' });
    morph.el.title = 'Glides all eight macros from set A (left) to set B (right)';
    const key = (label: string, title: string, run: () => void) => {
      const b = h('button', { type: 'button', class: 'inst-btn', title }, label);
      b.addEventListener('click', run);
      return b;
    };
    const keyA = key('A', 'Store the macros as set A (MORPH left)', () => {
      setA = current();
      setMorph(0);
      syncKeys();
      showBubble(keyA, 'Set A stored', 'mod', 1200);
    });
    const keyB = key('B', 'Store the macros as set B (MORPH right)', () => {
      setB = current();
      setMorph(1);
      syncKeys();
      showBubble(keyB, 'Set B stored', 'mod', 1200);
    });
    const rnd = key('RND', 'All eight macros at random', () => writeAll(ids.map(() => Math.random())));
    const keySnap = key('SNAP', 'Remember the eight macros', () => {
      snap = current();
      syncKeys();
      showBubble(keySnap, 'Macros remembered', 'mod', 1200);
    });
    const recall = key('↺', 'Back to the remembered macros', () => snap && writeAll(snap));
    recall.setAttribute('aria-label', 'Recall the remembered macros');
    const syncKeys = () => {
      toggleClass(keyA, 'is-selected', !!setA);
      toggleClass(keyB, 'is-selected', !!setB);
      toggleClass(keySnap, 'is-selected', !!snap);
      recall.toggleAttribute('disabled', !snap);
    };
    syncKeys();
    tab.slots[NUM_MACROS].append(h('div', { class: 'mc-morph', role: 'group', 'aria-label': 'Macro morph' }, keyA, morph.el, keyB));
    tab.slots[NUM_MACROS + 1].append(h('div', { class: 'mc-keys', role: 'group', 'aria-label': 'Random and snapshot of the macros' }, rnd, keySnap, recall));
    const parseSet = (v: unknown): number[] | null =>
      Array.isArray(v) && v.length === NUM_MACROS && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v.map((x) => Math.min(1, Math.max(0, x))) : null;
    engine.registerStateProvider('macroMorph', {
      getState: () => ({ a: setA, b: setB, snap, pos: params.get('macros.morph') }),
      setState: (s) => {
        const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
        setA = parseSet(o.a);
        setB = parseSet(o.b);
        snap = parseSet(o.snap);
        setMorph(typeof o.pos === 'number' && Number.isFinite(o.pos) ? o.pos : 0);
        syncKeys();
      },
    });

    engine.registerStateProvider('macros', {
      getState: () => ({ names: [...names] }),
      setState: (s) => {
        names = parseMacroNames(s);
        names.forEach((name, i) => setters[i](name));
        lists.forEach((l) => l.refresh());
      },
    });
  },
});
