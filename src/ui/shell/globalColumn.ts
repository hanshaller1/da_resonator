/**
 * Global column right of tabs, panel and faders: input, resonance (large), spread,
 * feedback-all (switch, amount, tone), dry/wet and output, with the input and output meters.
 */
import type { EngineAPI } from '../../core/types';
import { Knob } from '../components/knob';
import { StereoMeter } from '../components/meter';
import { ParamToggle } from '../components/toggle';
import { h, toggleClass } from '../dom';
import { frameLoop } from '../scheduler';

export function buildGlobalColumn(engine: EngineAPI): HTMLElement {
  const p = engine.params;
  const inMeter = new StereoMeter('IN');
  const outMeter = new StereoMeter('OUT');

  const input = new Knob(p, 'inputGain', { size: 'md', label: 'INPUT', ariaLabel: 'Input gain' });
  const res = new Knob(p, 'resOffset', { size: 'lg', label: 'RESONANCE', ariaLabel: 'Global resonance' });
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

  const el = h(
    'aside',
    { class: 'globals', 'aria-label': 'Global controls' },
    h('div', { class: 'gc-cell gc-io' }, input.el, inMeter.el),
    h('div', { class: 'gc-cell gc-res' }, res.el),
    h('div', { class: 'gc-cell' }, spread.el),
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
