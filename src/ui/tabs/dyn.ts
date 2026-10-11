/**
 * DYN EQ tab: band dynamics (a compressor / upward expander per resonator band).
 * Status line = on + the five global settings + a live readout of the largest gain change.
 * Control row = per band (slot k = band k) its amount and its gain-reduction mod source GR.
 * Visualisation = band levels against the threshold with the gain change per band (dyn/viz.ts).
 */
import '../../styles/tabs/dyn.css';
import { BAND_FREQS, NUM_BANDS } from '../../shared/params';
import { Knob } from '../components/knob';
import { ParamField } from '../components/paramField';
import { SourceChip } from '../components/sourceChip';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';
import { freqText } from '../shell/faders';
import { registerTab } from '../shell/tabs';
import { buildDynViz, effective } from './dyn/viz';

registerTab({
  id: 'dyn',
  reveal: (id) => id.startsWith('dyn.') || /^band\d\.dyn$/.test(id),
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;

    /* ---------- status line ---------- */
    const on = new ParamToggle(p, 'dyn.on', { label: 'ON', ariaLabel: 'Band dynamics on' });
    const fields = [
      new ParamField(p, 'dyn.threshold', { ariaLabel: 'Dynamics threshold' }),
      new ParamField(p, 'dyn.ratio', { ariaLabel: 'Dynamics ratio (below 1:1 expands)' }),
      new ParamField(p, 'dyn.attack', { ariaLabel: 'Dynamics attack' }),
      new ParamField(p, 'dyn.release', { ariaLabel: 'Dynamics release' }),
      new ParamField(p, 'dyn.range', { ariaLabel: 'Dynamics range (maximum gain change)' }),
    ];
    const mode = h('span', { class: 'dyn-mode' });
    const readout = h('b', { class: 'dyn-readout' });
    const live = h('span', { class: 'dyn-live' }, 'GR ', readout);
    tab.status.append(on.el, h('span', { class: 'dyn-fields' }, ...fields.map((f) => f.el)), mode, h('span', { class: 'tp-spacer' }), live);

    /* ---------- control row: amount + GR source per band ---------- */
    for (let b = 0; b < NUM_BANDS; b++) {
      const f = freqText(BAND_FREQS[b]);
      const amt = new Knob(p, `band${b}.dyn`, { size: 'sm', label: 'AMT', ariaLabel: `Band ${b + 1} (${f.value} ${f.unit}) dynamics amount` });
      const chip = new SourceChip(engine, `dyn${b + 1}`, { label: 'GR' });
      tab.slots[b].append(h('div', { class: 'dyn-cell' }, amt.el, chip.el));
    }

    const { viz, peakGr } = buildDynViz(tab);

    const syncOn = (v: number) => {
      toggleClass(tab.root, 'is-dyn-off', v < 0.5);
      viz.dirty = true;
    };
    syncOn(p.get('dyn.on'));
    p.subscribe('dyn.on', syncOn);

    /* ---------- live readout (~15 Hz while shown) ---------- */
    let shownMode = '';
    let shownGr = '';
    let tick = 0;
    frameLoop.add(() => {
      if (!tab.visible || (tick++ & 3) !== 0) return;
      const ratio = effective(p, 'dyn.ratio');
      const m = ratio > 1.02 ? 'COMP' : ratio < 0.98 ? 'EXP' : '1:1';
      if (m !== shownMode) mode.textContent = shownMode = m;
      const running = engine.state === 'running';
      const dynOn = p.get('dyn.on') >= 0.5;
      const { db, band } = peakGr();
      let text: string;
      if (!dynOn) text = 'off';
      else if (!running) text = '—';
      else if (Math.abs(db) < 0.05 || band < 0) text = '0.0 dB';
      else text = `${db > 0 ? '−' : '+'}${Math.abs(db).toFixed(1)} dB · B${band + 1}`;
      if (text !== shownGr) {
        readout.textContent = shownGr = text;
        toggleClass(readout, 'is-cut', dynOn && running && db > 0.05);
        toggleClass(readout, 'is-boost', dynOn && running && db < -0.05);
      }
    });
  },
});
