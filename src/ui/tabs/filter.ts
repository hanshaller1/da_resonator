/**
 * FILTER tab: pre filter (before the resonator), post filter (after it) and the band filter (a filter
 * curve read at the band centres, on top of the faders; docs/hardware-modi-und-pools-2026-10-16.md).
 * Status line = what the selected filter does + a summary of all three, PRE / POST / BAND selector and on.
 * Control row = the selected filter: PRE / POST TYPE, SLOPE, FREQ, RES, DRIVE, MIX, KEY, ENV AMT, ENV REL,
 * SPREAD (slots 1–10);
 * BAND TYPE, SLOPE, FREQ, WIDTH, DEPTH, OFFSET, R OFS, KEY, ENV + REL, PEAK + RES AMT (slots 1–10; a + puts
 * two small knobs into one slot).
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
  filterPre: ['type', 'slope', 'cutoff', 'res', 'drive', 'mix', 'key', 'env', 'envRel', 'spread'],
  filterPost: ['type', 'slope', 'cutoff', 'res', 'drive', 'mix', 'key', 'env', 'envRel', 'spread'],
  filterBand: ['type', 'slope', 'cutoff', 'width', 'depth', 'offset', 'rofs', 'key', 'env+envRel', 'peak+resAmt'],
};
const PP_TITLES: Record<string, string> = {
  key: 'Where the cutoff comes from: FREQ (Off), the FOCUS spot of the RESONANCE knob, or the centre of one band',
  env: 'The filter follows its own input: louder moves the cutoff up (right) or down (left), up to 4 octaves',
  envRel: 'How fast the envelope falls back after a peak',
  spread: 'Moves the cutoff of L down and R up (right) or the other way round (left), up to 2 octaves apart',
};
const TITLES: Record<string, string> = {
  ...Object.fromEntries(['filterPre', 'filterPost'].flatMap((s) => Object.entries(PP_TITLES).map(([k, t]) => [`${s}.${k}`, t]))),
  'filterBand.width': 'Width of the passband (BP) or of the cut (Notch) in octaves',
  'filterBand.depth': 'How far the stopped bands go down; at the right stop they are silent',
  'filterBand.offset': 'Level of the passband, on top of the faders',
  'filterBand.rofs': 'R reads the curve with its cutoff moved by this many octaves',
  'filterBand.key': 'Where the cutoff comes from: FREQ (Off), the FOCUS spot of the RESONANCE knob, the centre of one band, or the last MIDI note played',
  'filterBand.env': 'The curve follows the input: louder moves the cutoff up (right) or down (left), up to 4 octaves',
  'filterBand.envRel': 'How fast the envelope falls back after a peak',
  'filterBand.peak': 'Lifts the bands at the cutoff, like the resonance of a filter',
  'filterBand.resAmt': 'The curve also moves RES: open bands ring longer and closed ones get broader (right), or the other way round (left)',
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
    // description and summaries in one group on a shared text baseline (mixed font sizes)
    tab.status.append(h('span', { class: 'flt-line' }, desc, h('span', { class: 'flt-sep', 'aria-hidden': 'true' }), ...sums.map((s) => s.el)), h('span', { class: 'tp-spacer' }), select.el, ...toggles.map((t) => t.el));

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
      const one = (key: string, size: 'md' | 'sm') => {
        const id = `${slot}.${key}`;
        const spec = p.spec(id);
        const el = spec.curve === 'discrete' ? new ParamSelect(p, id).el : new Knob(p, id, { size, ariaLabel: `${NAME[slot]} ${spec.short.toLowerCase()}` }).el;
        if (TITLES[id]) el.title = TITLES[id];
        return el;
      };
      const ctls = CONTROLS[slot].map((key) =>
        key.includes('+') ? h('div', { class: 'flt-pair' }, ...key.split('+').map((k) => one(k, 'sm'))) : one(key, 'md'),
      );
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
    // pre / post: FREQ is not used while KEY sets the cutoff; ENV REL only counts with ENV AMT
    (['filterPre', 'filterPost'] as const).forEach((slot, k) => {
      const keys = CONTROLS[slot];
      const cut = sets[k][keys.indexOf('cutoff')];
      const rel = sets[k][keys.indexOf('envRel')];
      const sync = () => {
        const keyed = Math.round(p.get(`${slot}.key`)) !== 0;
        toggleClass(cut, 'is-dim', keyed);
        cut.title = keyed ? 'Not in use: KEY sets the cutoff' : '';
        toggleClass(rel, 'is-dim', Math.abs(p.get(`${slot}.env`)) < 0.005);
      };
      sync();
      p.subscribe(`${slot}.key`, sync);
      p.subscribe(`${slot}.env`, sync);
    });
    // band filter: WIDTH only counts for BP and Notch, FREQ not while KEY sets the cutoff, REL only with ENV
    const bk = CONTROLS.filterBand;
    const width = sets[2][bk.indexOf('width')];
    const bCut = sets[2][bk.indexOf('cutoff')];
    const bRel = sets[2][bk.indexOf('env+envRel')].firstElementChild?.children[1] as HTMLElement | undefined;
    const syncBand = () => {
      const t = Math.round(p.get('filterBand.type'));
      toggleClass(width, 'is-dim', t === 0 || t === 2);
      const keyed = Math.round(p.get('filterBand.key')) !== 0;
      toggleClass(bCut, 'is-dim', keyed);
      bCut.title = keyed ? 'Not in use: KEY sets the cutoff (KEY Note: until the first note)' : '';
      if (bRel) toggleClass(bRel, 'is-dim', Math.abs(p.get('filterBand.env')) < 0.005);
    };
    syncBand();
    for (const k of ['type', 'key', 'env']) p.subscribe(`filterBand.${k}`, syncBand);

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
