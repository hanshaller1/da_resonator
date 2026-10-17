/**
 * DYN EQ tab: band dynamics (a compressor / upward expander per resonator band).
 * Status line = on + MODE (CUT · BOOST · BALANCE) + the five global settings, what the dynamics measure (SRC BAND · IN · OUT, the input
 * filter FILT / FREQ before the IN / OUT analysis), DLY and R DLY (docs/hardware-modi-und-pools-2026-10-16.md)
 * + a live readout of the largest gain change.
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
import { buildDynViz } from './dyn/viz';

registerTab({
  id: 'dyn',
  reveal: (id) => id.startsWith('dyn.') || /^band\d\.dyn$/.test(id),
  mount(tab) {
    const { engine } = tab;
    const p = engine.params;

    /* ---------- status line ---------- */
    const on = new ParamToggle(p, 'dyn.on', { label: 'ON', ariaLabel: 'Band dynamics on' });
    const modeField = new ParamField(p, 'dyn.mode', { ariaLabel: 'Dynamics mode: cut above the threshold, boost below it, or both (balance)' });
    modeField.el.title = 'CUT lowers bands above the threshold, BOOST raises bands below it (with a gate 40 dB under it and a level correction), BALANCE does both';
    const fields = [
      modeField,
      new ParamField(p, 'dyn.threshold', { ariaLabel: 'Dynamics threshold' }),
      new ParamField(p, 'dyn.ratio', { ariaLabel: 'Dynamics ratio' }),
      new ParamField(p, 'dyn.attack', { ariaLabel: 'Dynamics attack' }),
      new ParamField(p, 'dyn.release', { ariaLabel: 'Dynamics release' }),
      new ParamField(p, 'dyn.range', { ariaLabel: 'Dynamics range (maximum gain change)' }),
    ];
    const srcField = new ParamField(p, 'dyn.source', { ariaLabel: 'Dynamics source: the band itself, the input or the output' });
    const filt = new ParamField(p, 'dyn.filter', { ariaLabel: 'Input filter before the analysis of IN or OUT' });
    const freq = new ParamField(p, 'dyn.filterFreq', { ariaLabel: 'Input filter frequency' });
    const delays = [new ParamField(p, 'dyn.delay', { ariaLabel: 'Dynamics delay: the gain change comes this much later' }), new ParamField(p, 'dyn.rdly', { ariaLabel: 'R delay: the gain change comes this much later still on R' })];
    srcField.el.title = 'BAND measures each band itself; IN the input and OUT the output, each through an analysis filter per band';
    filt.el.title = freq.el.title = 'Bandpass before the IN / OUT analysis, so only that range drives the dynamics';
    const srcBox = h('span', { class: 'dyn-fields dyn-src' }, srcField.el, filt.el, freq.el, ...delays.map((f) => f.el));
    const readout = h('b', { class: 'dyn-readout' });
    const live = h('span', { class: 'dyn-live' }, 'GR ', readout);
    tab.status.append(on.el, h('span', { class: 'dyn-fields' }, ...fields.map((f) => f.el)), srcBox, h('span', { class: 'tp-spacer' }), live);
    // the input filter only counts for IN / OUT, its frequency only while it is on
    const syncSrc = () => {
      const band = Math.round(p.get('dyn.source')) === 0;
      toggleClass(filt.el, 'is-dim', band);
      toggleClass(freq.el, 'is-dim', band || p.get('dyn.filter') < 0.5);
    };
    syncSrc();
    p.subscribe('dyn.source', syncSrc);
    p.subscribe('dyn.filter', syncSrc);

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
    let shownGr = '';
    let tick = 0;
    frameLoop.add(() => {
      if (!tab.visible || (tick++ & 3) !== 0) return;
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
