/**
 * Global column right of tabs, panel and faders: input, resonance (large), spread, the channel
 * switch (L · L+R · R, with R = L and RESET), feedback-all (switch, amount, tone), dry/wet and
 * output, with the input and output meters.
 */
import type { EngineAPI, ParamStoreAPI } from '../../core/types';
import { channelSel, copyLtoR, resetBands, type ChannelSel } from '../channel';
import { Knob } from '../components/knob';
import { StereoMeter } from '../components/meter';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';

/** which channel the faders, band RES / FB and Feedback All edit; R = L and RESET act on all bands */
function channelCell(p: ParamStoreAPI): HTMLElement {
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
  const copy = h('button', { type: 'button', class: 'btn gc-ch-btn', title: 'Set every R value to its L value (levels, RES, FB, FB ALL)' }, 'R = L');
  copy.addEventListener('click', () => copyLtoR(p));
  const reset = h('button', { type: 'button', class: 'btn gc-ch-btn', title: 'All 10 faders to 0 dB, in L and R' }, 'RESET');
  reset.addEventListener('click', () => resetBands(p, 'gain'));
  return h(
    'div',
    { class: 'gc-cell gc-ch' },
    h('span', { class: 'inst gc-ch-sel', role: 'group', 'aria-label': 'Channel to edit' }, ...btns),
    h('div', { class: 'gc-ch-row' }, copy, reset),
  );
}

export function buildGlobalColumn(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const inMeter = new StereoMeter('IN');
  const outMeter = new StereoMeter('OUT');

  const input = new Knob(p, 'inputGain', { size: 'md', label: 'INPUT', ariaLabel: 'Input gain' });
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
    h('div', { class: 'gc-cell gc-io' }, input.el, inMeter.el),
    h('div', { class: 'gc-cell gc-res' }, res.el),
    h('div', { class: 'gc-cell' }, spread.el),
    channelCell(p),
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
