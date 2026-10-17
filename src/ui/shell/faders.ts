/**
 * Fader block: the 10 band level faders, always visible under every tab (they never change
 * role). Each column: scale, fader, two LED meters side by side, L and R of the band after the
 * fader and SPREAD (with the band dynamics' gain change while it is on), the dB readout and the
 * band frequency. The faders follow the L/R channel switch
 * (ui/channel.ts); the readout shows "L|R" while the channels differ.
 */
import type { EngineAPI } from '../../core/types';
import { BAND_FREQS, NUM_BANDS, bandParamId, bandParamIdR, faderDbToNorm, formatValue } from '../../shared/params';
import { channelSel } from '../channel';
import { Fader, faderScale } from '../components/fader';
import { LevelMeter } from '../components/meter';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';

export function freqText(fc: number): { value: string; unit: string } {
  return fc >= 1000 ? { value: `${+(fc / 1000).toFixed(1)}`, unit: 'kHz' } : { value: `${fc}`, unit: 'Hz' };
}

interface Column {
  el: HTMLElement;
  meterL: LevelMeter;
  meterR: LevelMeter;
  hot: boolean;
}

function buildColumn(engine: EngineAPI, i: number): Column {
  const p = engine.params;
  const id = bandParamId(i, 'gain');
  const idR = bandParamIdR(i, 'gain');
  const f = freqText(BAND_FREQS[i]);
  const name = `Band ${i + 1} (${f.value} ${f.unit})`;
  const fader = new Fader(p, id, { ariaLabel: `${name} level` });
  const meterL = new LevelMeter({ law: faderDbToNorm });
  const meterR = new LevelMeter({ law: faderDbToNorm });
  // one value, or L over R while the channels differ (two short lines keep the foot's width)
  const one = h('span', { class: 'fcol-ro-one' });
  const lineL = h('span', { class: 'fcol-ro-line' });
  const lineR = h('span', { class: 'fcol-ro-line' });
  const pair = h('span', { class: 'fcol-ro-pair' }, h('span', { class: 'fcol-ro-ch' }, 'L'), lineL, h('span', { class: 'fcol-ro-ch' }, 'R'), lineR);
  const readout = h('output', { class: 'fcol-readout', for: id }, one, pair);
  const spec = p.spec(id);
  const text = (v: number) => formatValue(spec, v).replace(' dB', '');
  const sync = () => {
    const l = p.get(id), r = p.get(idR);
    const split = l !== r;
    if (split) {
      lineL.textContent = text(l);
      lineR.textContent = text(r);
    } else one.textContent = text(l);
    one.hidden = split;
    pair.hidden = !split;
    readout.title = split ? `L ${text(l)} dB, R ${text(r)} dB` : '';
    toggleClass(readout, 'is-split', split);
    toggleClass(readout, 'is-off', Math.max(l, r) <= spec.min);
  };
  sync();
  p.subscribe(id, sync);
  p.subscribe(idR, sync);
  channelSel.onChange(sync);
  const el = h(
    'div',
    { class: 'fcol', role: 'group', 'aria-label': name, style: `--band:${i}` },
    h('div', { class: 'fcol-fader' }, faderScale(p, id), fader.el, h('div', { class: 'fcol-meter', title: 'L | R after the fader and SPREAD' }, meterL.el, meterR.el)),
    h(
      'div',
      { class: 'fcol-foot' },
      h('span', { class: 'fcol-freq' }, h('span', { class: 'fcol-index' }, String(i + 1)), f.value, h('small', null, f.unit)),
      readout,
    ),
  );
  return { el, meterL, meterR, hot: false };
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
    const fbAll = p.get('fbAllOn') >= 0.5 || p.get('fbAllOnR') >= 0.5;
    const dyn = p.get('dyn.on') >= 0.5;
    for (let i = 0; i < NUM_BANDS; i++) {
      const c = cols[i];
      const live = !!f && running;
      // the band dynamics are stereo-linked: the same gain change on both sides
      const gr = dyn ? (live ? f.dynGR?.[i] ?? 0 : 0) : null;
      c.meterL.push(live ? f.bandsL?.[i] ?? f.bands[i] ?? 0 : 0);
      c.meterR.push(live ? f.bandsR?.[i] ?? f.bands[i] ?? 0 : 0);
      c.meterL.setGainChange(gr);
      c.meterR.setGainChange(gr);
      c.meterL.tick(dt);
      c.meterR.tick(dt);
      const hot = !!(f?.hot && running && (fbAll || p.get(bandParamId(i, 'fb')) > 0.02 || p.get(bandParamIdR(i, 'fb')) > 0.02));
      if (hot !== c.hot) {
        c.hot = hot;
        toggleClass(c.el, 'is-hot', hot);
      }
    }
  });
  return el;
}
