/**
 * Small feedback helpers for modulation editing: a floating bubble next to a control
 * ("LFO 1 → +30 %", refusal reasons) and a polite live region for screen readers.
 */
import { h } from '../dom';

let bubble: HTMLDivElement | null = null;
let hideTimer = 0;
let live: HTMLDivElement | null = null;

function bubbleEl(): HTMLDivElement {
  if (!bubble) {
    bubble = h('div', { class: 'mod-bubble', 'aria-hidden': 'true' });
    document.body.append(bubble);
  }
  return bubble;
}

/** show `text` above `anchor`; `ms` > 0 hides it again after that time */
export function showBubble(anchor: Element, text: string, tone: 'mod' | 'warn' = 'mod', ms = 0): void {
  const b = bubbleEl();
  b.textContent = text;
  b.dataset.tone = tone;
  const r = anchor.getBoundingClientRect();
  b.classList.add('is-shown');
  const w = b.offsetWidth;
  const x = Math.min(window.innerWidth - w - 6, Math.max(6, r.left + r.width / 2 - w / 2));
  const above = r.top - b.offsetHeight - 8;
  const y = above > 4 ? above : r.bottom + 8;
  b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  clearTimeout(hideTimer);
  if (ms > 0) hideTimer = window.setTimeout(hideBubble, ms);
}

export function hideBubble(delay = 0): void {
  clearTimeout(hideTimer);
  if (delay > 0) {
    hideTimer = window.setTimeout(() => hideBubble(), delay);
    return;
  }
  bubble?.classList.remove('is-shown');
}

/** announce a change to assistive tech */
export function announce(text: string): void {
  if (!live) {
    live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.append(live);
  }
  // re-set so repeated identical messages are announced too
  live.textContent = '';
  const el = live;
  requestAnimationFrame(() => (el.textContent = text));
}
