/**
 * Fader block: the 10 band level faders, always visible under every tab (they never change
 * role). Each column: scale, fader, LED meter (with the band dynamics' gain change while it is
 * on), the dB readout and the band frequency.
 */
import type { EngineAPI } from '../../core/types';
import { BAND_FREQS, NUM_BANDS, bandParamId, faderDbToNorm, formatValue } from '../../shared/params';
import { Fader, faderScale } from '../components/fader';
import { LevelMeter } from '../components/meter';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';

export function freqText(fc: number): { value: string; unit: string } {
  return fc >= 1000 ? { value: `${+(fc / 1000).toFixed(1)}`, unit: 'kHz' } : { value: `${fc}`, unit: 'Hz' };
}

interface Column {
  el: HTMLElement;
  meter: LevelMeter;
  hot: boolean;
}

function buildColumn(engine: EngineAPI, i: number): Column {
  const p = engine.params;
  const id = bandParamId(i, 'gain');
  const f = freqText(BAND_FREQS[i]);
  const name = `Band ${i + 1} (${f.value} ${f.unit})`;
  const fader = new Fader(p, id, { ariaLabel: `${name} level` });
  const meter = new LevelMeter({ law: faderDbToNorm });
  const readout = h('output', { class: 'fcol-readout', for: id });
  const sync = (v: number) => {
    readout.textContent = formatValue(p.spec(id), v).replace(' dB', '');
    toggleClass(readout, 'is-off', v <= p.spec(id).min);
  };
  sync(p.get(id));
  p.subscribe(id, sync);
  const el = h(
    'div',
    { class: 'fcol', role: 'group', 'aria-label': name, style: `--band:${i}` },
    h('div', { class: 'fcol-fader' }, faderScale(p, id), fader.el, h('div', { class: 'fcol-meter' }, meter.el)),
    h(
      'div',
      { class: 'fcol-foot' },
      h('span', { class: 'fcol-freq' }, h('span', { class: 'fcol-index' }, String(i + 1)), f.value, h('small', null, f.unit)),
      readout,
    ),
  );
  return { el, meter, hot: false };
}

export function buildFaders(engine: EngineAPI): HTMLElement {
  const cols: Column[] = [];
  const el = h('div', { class: 'faders', role: 'group', 'aria-label': 'Band levels' });
  for (let i = 0; i < NUM_BANDS; i++) {
    const c = buildColumn(engine, i);
    cols.push(c);
    el.append(c.el);
  }
  const p = engine.params;
  frameLoop.add((_t, dt) => {
    const f = engine.meters.latest();
    const running = engine.state === 'running';
    const fbAll = p.get('fbAllOn') >= 0.5;
    const dyn = p.get('dyn.on') >= 0.5;
    for (let i = 0; i < NUM_BANDS; i++) {
      const c = cols[i];
      c.meter.push(f && running ? f.bands[i] ?? 0 : 0);
      c.meter.setGainChange(dyn ? (f && running ? f.dynGR?.[i] ?? 0 : 0) : null);
      c.meter.tick(dt);
      const hot = !!(f?.hot && running && (fbAll || p.get(bandParamId(i, 'fb')) > 0.02));
      if (hot !== c.hot) {
        c.hot = hot;
        toggleClass(c.el, 'is-hot', hot);
      }
    }
  });
  return el;
}
