/**
 * Global column right of tabs, panel and faders: input with Analog under it, resonance (large),
 * spread with the channel switch (L · L+R · R), the commands on all bands under RESET (R = L, FADER,
 * RES/BAND, FB/BAND), feedback-all (switch, amount, tone), dry/wet and output, with the input and output meters.
 */
import type { EngineAPI, ParamStoreAPI } from '../../core/types';
import { channelSel, copyLtoR, resetBands, type ChannelSel } from '../channel';
import { Knob } from '../components/knob';
import { StereoMeter } from '../components/meter';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';

/** which channel the faders, band RES / FB and Feedback All edit (sits under SPREAD) */
function channelSwitch(): HTMLElement {
  const items: [ChannelSel, string, string][] = [
    ['L', 'L', 'Edit the left channel'],
    ['LR', 'L+R', 'Edit both channels (an offset between them stays)'],
    ['R', 'R', 'Edit the right channel'],
  ];
  const btns = items.map(([v, label, title]) => {
    const b = h('button', { type: 'button', class: 'inst-btn', title, 'data-ch': v }, label);
    b.addEventListener('click', () => channelSel.set(v));
    return b;
  });
  const sync = () => {
    const c = channelSel.get();
    btns.forEach((b, i) => {
      toggleClass(b, 'is-selected', items[i][0] === c);
      b.setAttribute('aria-pressed', String(items[i][0] === c));
    });
  };
  sync();
  channelSel.onChange(sync);
  return h('span', { class: 'inst gc-ch-sel', role: 'group', 'aria-label': 'Channel to edit' }, ...btns);
}

/** commands on all bands, in L and R, under the heading RESET: R = L, FADER (levels), RES/BAND and FB/BAND */
function bandsCell(p: ParamStoreAPI): HTMLElement {
  const btn = (label: string, title: string, run: () => void) => {
    const b = h('button', { type: 'button', class: 'btn gc-ch-btn', title }, label);
    b.addEventListener('click', run);
    return b;
  };
  return h(
    'div',
    { class: 'gc-cell gc-ch', role: 'group', 'aria-label': 'Reset all bands' },
    h('span', { class: 'gc-ch-title micro-label' }, 'RESET'),
    h(
      'div',
      { class: 'gc-ch-row' },
      btn('R = L', 'Set every R value to its L value (levels, RES, FB, FB ALL)', () => copyLtoR(p)),
      btn('FADER', 'All 10 faders to 0 dB, in L and R', () => resetBands(p, 'gain')),
    ),
    h(
      'div',
      { class: 'gc-ch-row' },
      btn('RES/BAND', 'RES of all 10 bands back to broad, in L and R', () => resetBands(p, 'res')),
      btn('FB/BAND', 'FB of all 10 bands to 0, in L and R', () => resetBands(p, 'fb')),
    ),
  );
}

export function buildGlobalColumn(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const inMeter = new StereoMeter('IN');
  const outMeter = new StereoMeter('OUT');

  const input = new Knob(p, 'inputGain', { size: 'md', label: 'INPUT', ariaLabel: 'Input gain' });
  const analog = new Knob(p, 'analog', { size: 'sm', label: 'ANALOG', ariaLabel: 'Analog character' });
  analog.el.title = 'Saturation, detune, Q tolerance, drift and a −96 dBFS noise floor per band. 0 is clean.';
  const res = new Knob(p, 'resOffset', { size: 'lg', label: 'RESONANCE', ariaLabel: 'Global resonance' });
  // what the knob does is set in CONFIG (shift RES, or scale all feedback like the hardware)
  const syncResTitle = () => {
    res.el.title = p.get('reso.knob') >= 0.5 ? 'Scales all feedback: centre as set, right up to double, left inverted (CONFIG)' : 'Shifts RES of the bands (CONFIG)';
  };
  syncResTitle();
  p.subscribe('reso.knob', syncResTitle);
  const spread = new Knob(p, 'spread', { size: 'md', label: 'SPREAD', ariaLabel: 'Odd/even spread' });
  const fbOn = new ParamToggle(p, 'fbAllOn', { label: 'FB ALL', tone: 'fb', ariaLabel: 'Feedback all bands' });
  const fbAmt = new Knob(p, 'fbAll', { size: 'sm', tone: 'fb', label: 'AMT', ariaLabel: 'Feedback all amount' });
  const fbTone = new Knob(p, 'fbAllTone', { size: 'sm', tone: 'fb', label: 'TONE', ariaLabel: 'Feedback all tone' });
  const mix = new Knob(p, 'mix', { size: 'md', label: 'DRY/WET', ariaLabel: 'Dry/wet mix' });
  const out = new Knob(p, 'outputGain', { size: 'md', label: 'OUTPUT', ariaLabel: 'Output level' });
  const hotLed = h('span', { class: 'hot-led', title: 'Feedback running hot', 'aria-hidden': 'true' }, h('span', { class: 'led' }), 'HOT');

  const fbBody = h('div', { class: 'gc-fb-knobs' }, fbAmt.el, fbTone.el);
  const fbGroup = h('div', { class: 'gc-cell gc-fb' }, h('div', { class: 'gc-fb-head' }, fbOn.el, hotLed), fbBody);
  const syncFb = () => {
    toggleClass(fbGroup, 'is-off', !fbOn.on);
    fbBody.setAttribute('aria-disabled', String(!fbOn.on));
  };
  syncFb();
  p.subscribe('fbAllOn', syncFb);
  p.subscribe('fbAllOnR', syncFb);
  channelSel.onChange(syncFb);

  const el = h(
    'aside',
    { class: 'globals', 'aria-label': 'Global controls' },
    h('div', { class: 'gc-cell gc-io gc-in' }, input.el, inMeter.el, analog.el),
    h('div', { class: 'gc-cell gc-res' }, res.el),
    h('div', { class: 'gc-cell gc-spread' }, spread.el, channelSwitch()),
    bandsCell(p),
    fbGroup,
    h('div', { class: 'gc-cell' }, mix.el),
    h('div', { class: 'gc-cell gc-io' }, out.el, outMeter.el),
  );

  let hot = false;
  frameLoop.add((_t, dt) => {
    const f = engine.meters.latest();
    const running = engine.state === 'running';
    inMeter.push(f && running ? f.inPeak : [0, 0]);
    outMeter.push(f && running ? f.outPeak : [0, 0]);
    inMeter.tick(dt);
    outMeter.tick(dt);
    const isHot = !!(f?.hot && running);
    if (isHot !== hot) {
      hot = isHot;
      toggleClass(hotLed, 'is-on', hot);
    }
  });
  return el;
}
