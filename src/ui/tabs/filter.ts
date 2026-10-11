/**
 * FILTER tab: pre filter (before the resonator) and post filter (after it).
 * Status line = what the selected filter does + a summary of both, PRE / POST selector and on.
 * Control row = the selected filter: TYPE, SLOPE, FREQ, RES, DRIVE, MIX (slots 1–6).
 * Visualisation = both responses over the spectrum with a cutoff handle, and per band the level
 * after resonator × pre × post (see filter/viz.ts).
 */
import '../../styles/tabs/filter.css';
import { FILTER_SLOTS, type FilterSlot } from '../../shared/paramdefs/modules';
import { formatValue, fromNorm } from '../../shared/params';
import { InstanceSelect } from '../components/instanceSelect';
import { Knob } from '../components/knob';
import { ParamSelect } from '../components/select';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';
import { registerTab } from '../shell/tabs';
import { SLOT_NAME, buildFilterViz } from './filter/viz';

const WHERE: Record<FilterSlot, string> = {
  filterPre: 'Pre filter · before the resonator',
  filterPost: 'Post filter · after the resonator',
};

let inst: InstanceSelect | null = null;

registerTab({
  id: 'filter',
  reveal(id) {
    const i = FILTER_SLOTS.findIndex((s) => id.startsWith(`${s}.`));
    if (i < 0 || !inst) return false;
    inst.select(i);
    return true;
  },
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const select = new InstanceSelect(engine, {
      key: 'filter',
      count: FILTER_SLOTS.length,
      label: (i) => SLOT_NAME[FILTER_SLOTS[i]],
      onParam: (i) => `${FILTER_SLOTS[i]}.on`,
    });
    inst = select;

    /* ---------- status line ---------- */
    const desc = h('span', { class: 'flt-desc' });
    const sums = FILTER_SLOTS.map((slot) => {
      const val = h('b');
      const el = h('span', { class: 'flt-sum' }, h('span', { class: 'led', 'aria-hidden': 'true' }), SLOT_NAME[slot], val);
      return { slot, el, val, text: '' };
    });
    const toggles = FILTER_SLOTS.map((slot) => new ParamToggle(p, `${slot}.on`, { label: 'ON', ariaLabel: `${slot === 'filterPre' ? 'Pre' : 'Post'} filter on` }));
    tab.status.append(desc, h('span', { class: 'flt-sep', 'aria-hidden': 'true' }), ...sums.map((s) => s.el), h('span', { class: 'tp-spacer' }), select.el, ...toggles.map((t) => t.el));

    const eff = (id: string) => (p.isModulated(id) ? fromNorm(p.spec(id), p.getEffectiveNorm(id)) : p.get(id));
    /** summary text (effective cutoff, so it follows modulation) */
    const syncSums = () => {
      for (const s of sums) {
        const v = (k: string) => formatValue(p.spec(`${s.slot}.${k}`), eff(`${s.slot}.${k}`));
        const on = p.get(`${s.slot}.on`) >= 0.5;
        const text = `${v('type')} ${v('slope')} · ${v('cutoff')}${on ? '' : ' · off'}`;
        if (text !== s.text) s.val.textContent = s.text = text;
        toggleClass(s.el, 'is-on', on);
        toggleClass(s.val, 'is-modulated', p.isModulated(`${s.slot}.cutoff`));
      }
    };

    /* ---------- control row: one set per filter, the unselected one hidden ---------- */
    const sets = FILTER_SLOTS.map((slot) => {
      const name = slot === 'filterPre' ? 'Pre filter' : 'Post filter';
      const knob = (key: string) => new Knob(p, `${slot}.${key}`, { size: 'md', ariaLabel: `${name} ${p.spec(`${slot}.${key}`).short.toLowerCase()}` }).el;
      const ctls = [new ParamSelect(p, `${slot}.type`).el, new ParamSelect(p, `${slot}.slope`).el, knob('cutoff'), knob('res'), knob('drive'), knob('mix')];
      const cells = ctls.map((c, k) => {
        const cell = h('div', { class: 'flt-cell' }, c);
        tab.slots[k].append(cell);
        return cell;
      });
      const syncOn = (v: number) => cells.forEach((c) => toggleClass(c, 'is-off', v < 0.5));
      syncOn(p.get(`${slot}.on`));
      p.subscribe(`${slot}.on`, syncOn);
      return cells;
    });

    const viz = buildFilterViz(tab, () => select.current, (i) => select.select(i));

    const show = (i: number) => {
      sets.forEach((cells, k) => cells.forEach((c) => (c.hidden = k !== i)));
      toggles.forEach((t, k) => (t.el.hidden = k !== i));
      desc.textContent = WHERE[FILTER_SLOTS[i]];
      sums.forEach((s, k) => toggleClass(s.el, 'is-selected', k === i));
      viz.dirty = true;
    };
    show(select.current);
    select.onChange(show);

    syncSums();
    p.subscribeAll((id) => {
      if (id.startsWith('filterPre.') || id.startsWith('filterPost.')) syncSums();
    });
    // modulated cutoffs only move through readouts: poll the text a few times a second while shown
    let t = 0;
    const modulated = (s: FilterSlot) => p.isModulated(`${s}.cutoff`) || p.isModulated(`${s}.type`) || p.isModulated(`${s}.slope`);
    frameLoop.add(() => {
      if (tab.visible && (t++ & 7) === 0 && FILTER_SLOTS.some(modulated)) syncSums();
    });
  },
});
