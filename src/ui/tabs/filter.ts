/**
 * FILTER tab: pre filter (before the resonator), post filter (after it) and the band filter (a filter
 * curve read at the band centres, on top of the faders; docs/hardware-modi-und-pools-2026-10-16.md).
 * Status line = what the selected filter does + a summary of all three, PRE / POST / BAND selector and on.
 * Control row = the selected filter: PRE / POST TYPE, SLOPE, FREQ, RES, DRIVE, MIX (slots 1–6);
 * BAND TYPE, SLOPE, FREQ, WIDTH, DEPTH, OFFSET, R OFS (slots 1–7).
 * Visualisation = the responses over the spectrum with a cutoff handle, and per band the level
 * after resonator × pre × post + band filter; with BAND the locks along the foot (see filter/viz.ts).
 */
import '../../styles/tabs/filter.css';
import { formatValue, fromNorm } from '../../shared/params';
import { InstanceSelect } from '../components/instanceSelect';
import { Knob } from '../components/knob';
import { ParamSelect } from '../components/select';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';
import { registerTab } from '../shell/tabs';
import { FILTER_INSTANCES, SLOT_NAME, buildFilterViz, type FilterInst } from './filter/viz';

const WHERE: Record<FilterInst, string> = {
  filterPre: 'Pre filter · before the resonator',
  filterPost: 'Post filter · after the resonator',
  filterBand: 'Band filter · on the band levels',
};
const NAME: Record<FilterInst, string> = { filterPre: 'Pre filter', filterPost: 'Post filter', filterBand: 'Band filter' };
/** controls of each filter, slot by slot (select = stepper, knob otherwise) */
const CONTROLS: Record<FilterInst, readonly string[]> = {
  filterPre: ['type', 'slope', 'cutoff', 'res', 'drive', 'mix'],
  filterPost: ['type', 'slope', 'cutoff', 'res', 'drive', 'mix'],
  filterBand: ['type', 'slope', 'cutoff', 'width', 'depth', 'offset', 'rofs'],
};
const TITLES: Record<string, string> = {
  'filterBand.width': 'Width of the passband (BP) or of the cut (Notch) in octaves',
  'filterBand.depth': 'How far the stopped bands go down; at the right stop they are silent',
  'filterBand.offset': 'Level of the passband, on top of the faders',
  'filterBand.rofs': 'R reads the curve with its cutoff moved by this many octaves',
};

let inst: InstanceSelect | null = null;

registerTab({
  id: 'filter',
  reveal(id) {
    const i = FILTER_INSTANCES.findIndex((s) => id.startsWith(`${s}.`));
    if (i < 0 || !inst) return false;
    inst.select(i);
    return true;
  },
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;
    const select = new InstanceSelect(engine, {
      key: 'filter',
      count: FILTER_INSTANCES.length,
      label: (i) => SLOT_NAME[FILTER_INSTANCES[i]],
      onParam: (i) => `${FILTER_INSTANCES[i]}.on`,
    });
    inst = select;

    /* ---------- status line ---------- */
    const desc = h('span', { class: 'flt-desc' });
    const sums = FILTER_INSTANCES.map((slot) => {
      const val = h('b');
      const el = h('span', { class: 'flt-sum' }, h('span', { class: 'led', 'aria-hidden': 'true' }), SLOT_NAME[slot], val);
      return { slot, el, val, text: '' };
    });
    const toggles = FILTER_INSTANCES.map((slot) => new ParamToggle(p, `${slot}.on`, { label: 'ON', ariaLabel: `${NAME[slot]} on` }));
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

    /* ---------- control row: one set per filter, the unselected ones hidden ---------- */
    const sets = FILTER_INSTANCES.map((slot) => {
      const ctls = CONTROLS[slot].map((key) => {
        const id = `${slot}.${key}`;
        const spec = p.spec(id);
        const el = spec.curve === 'discrete' ? new ParamSelect(p, id).el : new Knob(p, id, { size: 'md', ariaLabel: `${NAME[slot]} ${spec.short.toLowerCase()}` }).el;
        if (TITLES[id]) el.title = TITLES[id];
        return el;
      });
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
    // band filter: WIDTH only counts for BP and Notch
    const width = sets[2][CONTROLS.filterBand.indexOf('width')];
    const syncWidth = () => {
      const t = Math.round(p.get('filterBand.type'));
      toggleClass(width, 'is-dim', t === 0 || t === 2);
    };
    syncWidth();
    p.subscribe('filterBand.type', syncWidth);

    const viz = buildFilterViz(tab, () => select.current, (i) => select.select(i));

    const show = (i: number) => {
      sets.forEach((cells, k) => cells.forEach((c) => (c.hidden = k !== i)));
      toggles.forEach((t, k) => (t.el.hidden = k !== i));
      desc.textContent = WHERE[FILTER_INSTANCES[i]];
      sums.forEach((s, k) => toggleClass(s.el, 'is-selected', k === i));
      viz.dirty = true;
    };
    show(select.current);
    select.onChange(show);

    syncSums();
    p.subscribeAll((id) => {
      if (FILTER_INSTANCES.some((s) => id.startsWith(`${s}.`))) syncSums();
    });
    // modulated cutoffs only move through readouts: poll the text a few times a second while shown
    let t = 0;
    const modulated = (s: FilterInst) => p.isModulated(`${s}.cutoff`) || p.isModulated(`${s}.type`) || p.isModulated(`${s}.slope`);
    frameLoop.add(() => {
      if (tab.visible && (t++ & 7) === 0 && FILTER_INSTANCES.some(modulated)) syncSums();
    });
  },
});
