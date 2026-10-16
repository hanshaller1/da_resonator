import type { ParamStoreAPI, Unsubscribe } from '../../core/types';
import { formatValue, fromNorm, twinId, type ParamSpec } from '../../shared/params';
import { channelSel, moveLinked } from '../channel';
import { clamp01, toggleClass } from '../dom';
import { depthRange } from '../mod/labels';
import { AssignBinding, type AssignHost } from '../mod/targets';
import { frameLoop } from '../scheduler';

export interface ParamControlOptions {
  /** accessible name (defaults to spec.label) */
  ariaLabel?: string;
  /** pixels of vertical drag for a full 0..1 sweep (relative drag) */
  dragRange?: number;
  /** multiplier while Shift is held */
  fineFactor?: number;
}

/* ---------- shared modulation watcher (one rAF task for all controls) ---------- */

const modWatched = new Set<ParamControl>();
let modUnsub: Unsubscribe | null = null;
let modFrame = 0;

function watchMod(c: ParamControl): void {
  modWatched.add(c);
  if (!modUnsub) {
    modUnsub = frameLoop.add(() => {
      // every other frame is plenty for indicators
      if ((modFrame++ & 1) === 0) return;
      for (const ctl of modWatched) ctl.pollModulation();
    });
  }
}
function unwatchMod(c: ParamControl): void {
  modWatched.delete(c);
  if (!modWatched.size && modUnsub) {
    modUnsub();
    modUnsub = null;
  }
}

/** text of a pair whose channels differ, e.g. "L −6.0 dB · R +3.0 dB" (accessible value, tooltips) */
export function pairText(spec: ParamSpec, l: number, r: number): string {
  return `L ${formatValue(spec, l)} · R ${formatValue(spec, r)}`;
}

/**
 * Base class for continuous controls bound to one parameter.
 * Handles pointer drag (relative, or absolute-ish via `jumpNormAt`), Shift
 * fine-tuning, wheel, keyboard, double-click/double-tap reset, gestures,
 * ARIA, param subscriptions and the modulation indicator poll.
 * In modulation assign mode (a source chip is armed) the same gestures edit the
 * route depth instead (see mod/targets.ts); right-click / long-press lists the routes.
 * A param with an R twin (L/R per band) follows the channel switch (ui/channel.ts): L edits the
 * param, R its twin, L+R both by the same travel. The control then shows the edited channel (L+R:
 * the middle of both) and the other channel(s) through `renderPair`.
 * Subclasses build their DOM, then call `this.init()`.
 */
export abstract class ParamControl implements AssignHost {
  readonly id: string;
  readonly spec: ParamSpec;
  /** id of the R twin, null when the param has none */
  readonly pairId: string | null;
  protected readonly params: ParamStoreAPI;
  protected readonly opts: ParamControlOptions;
  protected norm = 0;
  protected active = false;

  private unsubs: Unsubscribe[] = [];
  private dragAcc = 0;
  private lastY = 0;
  private pointerId: number | null = null;
  private wheelTimer = 0;
  private lastTap = 0;
  private modOn = false;
  private lastEff = -1;
  private assignB: AssignBinding | null = null;
  private depth: { d: number; bipolar: boolean } | null = null;
  /** L+R drag: both channels and their middle when the gesture started */
  private linkStart: [number, number, number] | null = null;

  abstract readonly el: HTMLElement;

  constructor(params: ParamStoreAPI, id: string, opts: ParamControlOptions = {}) {
    this.params = params;
    this.id = id;
    this.spec = params.spec(id);
    this.pairId = twinId(id) ?? null;
    this.opts = opts;
  }

  /** Paint the base value. */
  protected abstract render(norm: number, plain: number): void;
  /** Paint the modulation indicator; null = not modulated. */
  protected abstract renderMod(effNorm: number | null): void;
  /** Paint the depth range [lo, hi] (normalized) of the armed source's route; null = none. */
  protected renderDepth(_range: [number, number] | null): void {}
  /**
   * L/R pairs: the channels not shown by the main value, as normalized marks (L+R: both, L or R: the
   * other one); empty while both channels are equal.
   */
  protected renderPair(_marks: { ch: 'L' | 'R'; norm: number }[]): void {}
  /** Element receiving pointer events (default: el). */
  protected hitTarget(): HTMLElement {
    return this.el;
  }
  /**
   * For absolute-ish controls: return the norm to jump to for a pointerdown at
   * this event, or null to drag relatively from the current value.
   */
  protected jumpNormAt(_e: PointerEvent): number | null {
    return null;
  }
  /** Pixels for a full sweep. */
  /** last say on a value set by drag, track click or wheel (e.g. a detent); fine = Shift held */
  protected adjust(n: number, _fine: boolean): number {
    return n;
  }

  protected dragRange(): number {
    return this.opts.dragRange ?? 220;
  }

  get bipolar(): boolean {
    return this.spec.min < 0 && this.spec.max > 0;
  }

  /** the value of the channel the switch edits; L+R with the channels apart: both */
  get valueText(): string {
    const split = this.splitValues();
    if (split) return pairText(this.spec, split[0], split[1]);
    const pr = this.pairId;
    return formatValue(this.spec, this.params.get(pr && channelSel.get() === 'R' ? pr : this.id));
  }

  /** [L, R] while the switch is on L+R and the two channels differ, else null */
  protected splitValues(): [number, number] | null {
    const pr = this.pairId;
    if (!pr || channelSel.get() !== 'LR' || Math.abs(this.params.getNorm(this.id) - this.params.getNorm(pr)) <= 1e-4) return null;
    return [this.params.get(this.id), this.params.get(pr)];
  }

  /** the params an edit touches: the param, its twin, or both (channel switch) */
  private editIds(): string[] {
    const pr = this.pairId;
    if (!pr) return [this.id];
    const c = channelSel.get();
    return c === 'L' ? [this.id] : c === 'R' ? [pr] : [this.id, pr];
  }
  private begin(): void {
    for (const id of this.editIds()) this.params.beginGesture(id);
  }
  private end(): void {
    for (const id of this.editIds()) this.params.endGesture(id);
  }
  /** which param the modulation indicator follows */
  private modId(): string {
    const pr = this.pairId;
    if (!pr) return this.id;
    const c = channelSel.get();
    return c === 'R' || (c === 'LR' && !this.params.isModulated(this.id)) ? pr : this.id;
  }

  protected init(): void {
    const el = this.el;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', this.opts.ariaLabel ?? this.spec.label);
    el.setAttribute('aria-valuemin', String(this.spec.min));
    el.setAttribute('aria-valuemax', String(this.spec.max));
    el.setAttribute('aria-orientation', 'vertical');
    el.dataset.param = this.id;

    this.sync();
    this.unsubs.push(this.params.subscribe(this.id, () => this.sync()));
    if (this.pairId) {
      this.unsubs.push(
        this.params.subscribe(this.pairId, () => this.sync()),
        channelSel.onChange(() => {
          this.lastEff = -1;
          this.modOn = false;
          this.sync();
          this.pollModulation();
        }),
      );
    }

    const hit = this.hitTarget();
    hit.style.touchAction = 'none';
    hit.addEventListener('pointerdown', this.onDown);
    hit.addEventListener('pointermove', this.onMove);
    hit.addEventListener('pointerup', this.onUp);
    hit.addEventListener('pointercancel', this.onUp);
    hit.addEventListener('lostpointercapture', this.onUp);
    hit.addEventListener('dblclick', this.onDbl);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('blur', () => this.setActive(false));

    if (this.spec.modulatable || this.pairId) watchMod(this);
    this.assignB = new AssignBinding(this, this.params);
  }

  destroy(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    unwatchMod(this);
    this.assignB?.destroy();
    this.assignB = null;
  }

  /** AssignHost: depth of the armed source's route into this param (null = none) */
  showDepth(depth: number | null, bipolar: boolean): void {
    this.depth = depth === null ? null : { d: depth, bipolar };
    this.paintDepth();
  }

  protected paintDepth(): void {
    this.renderDepth(this.depth ? depthRange(this.norm, this.depth.d, this.depth.bipolar) : null);
  }

  /** Called from the shared rAF loop. */
  pollModulation(): void {
    const mid = this.modId();
    const on = this.params.isModulated(mid);
    if (!on) {
      if (this.modOn) {
        this.modOn = false;
        this.lastEff = -1;
        toggleClass(this.el, 'is-modulated', false);
        this.renderMod(null);
      }
      return;
    }
    const eff = this.params.getEffectiveNorm(mid);
    if (!this.modOn) {
      this.modOn = true;
      toggleClass(this.el, 'is-modulated', true);
    }
    if (Math.abs(eff - this.lastEff) > 0.0005) {
      this.lastEff = eff;
      this.renderMod(eff);
    }
  }

  private sync(): void {
    const pr = this.pairId;
    let plain: number;
    if (pr) {
      const nl = this.params.getNorm(this.id), nr = this.params.getNorm(pr);
      const c = channelSel.get();
      this.norm = c === 'L' ? nl : c === 'R' ? nr : 0.5 * (nl + nr);
      plain = c === 'L' ? this.params.get(this.id) : c === 'R' ? this.params.get(pr) : fromNorm(this.spec, this.norm);
      const differs = Math.abs(nl - nr) > 1e-4;
      const marks: { ch: 'L' | 'R'; norm: number }[] = [];
      if (differs) {
        if (c !== 'L') marks.push({ ch: 'L', norm: nl });
        if (c !== 'R') marks.push({ ch: 'R', norm: nr });
      }
      this.renderPair(marks);
    } else {
      this.norm = this.params.getNorm(this.id);
      plain = this.params.get(this.id);
    }
    this.el.setAttribute('aria-valuenow', String(+plain.toFixed(4)));
    this.el.setAttribute('aria-valuetext', this.valueText);
    this.render(this.norm, plain);
    if (this.depth) this.paintDepth();
  }

  protected setActive(on: boolean): void {
    this.active = on;
    toggleClass(this.el, 'is-active', on);
  }

  private setNorm(n: number): void {
    const pr = this.pairId;
    const c = channelSel.get();
    if (!pr || c === 'L') this.params.setNorm(this.id, clamp01(n));
    else if (c === 'R') this.params.setNorm(pr, clamp01(n));
    else {
      // L+R: both by the same travel from the start of the gesture (wheel and keys: from now)
      const nl = this.params.getNorm(this.id), nr = this.params.getNorm(pr);
      const [l0, r0, m0] = this.linkStart ?? [nl, nr, 0.5 * (nl + nr)];
      const [l, r] = moveLinked(l0, r0, clamp01(n) - m0);
      this.params.setNorm(this.id, l);
      this.params.setNorm(pr, r);
    }
  }

  /* ---------- pointer ---------- */

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    if (this.assignB?.pointerDown(e, { dragRange: this.dragRange(), fineFactor: this.opts.fineFactor })) return;
    if (e.button !== 0) return;
    // manual double-tap for touch / pen
    if (e.pointerType !== 'mouse') {
      if (e.timeStamp - this.lastTap < 300) {
        this.lastTap = 0;
        this.onReset();
        e.preventDefault();
        return;
      }
      this.lastTap = e.timeStamp;
    }
    e.preventDefault();
    this.el.focus({ preventScroll: true });
    this.pointerId = e.pointerId;
    try {
      this.hitTarget().setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    this.begin();
    this.setActive(true);
    toggleClass(this.el, 'is-dragging', true);
    if (this.pairId) {
      const nl = this.params.getNorm(this.id), nr = this.params.getNorm(this.pairId);
      this.linkStart = [nl, nr, 0.5 * (nl + nr)];
    }
    const jump = this.jumpNormAt(e);
    if (jump !== null) this.setNorm(this.adjust(jump, e.shiftKey));
    this.dragAcc = jump ?? this.norm;
    this.lastY = e.clientY;
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dy = this.lastY - e.clientY;
    this.lastY = e.clientY;
    if (!dy) return;
    const factor = e.shiftKey ? (this.opts.fineFactor ?? 0.12) : 1;
    this.dragAcc += (dy / this.dragRange()) * factor;
    // keep accumulator within a margin so reversing direction feels immediate
    this.dragAcc = Math.min(1.15, Math.max(-0.15, this.dragAcc));
    this.setNorm(this.adjust(this.dragAcc, e.shiftKey));
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    try {
      this.hitTarget().releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.end();
    this.linkStart = null;
    toggleClass(this.el, 'is-dragging', false);
    this.setActive(false);
  };

  private onDbl = (e: MouseEvent): void => {
    if (this.assignB?.dblclick(e)) return;
    this.onReset();
  };

  private onReset = (): void => {
    this.begin();
    for (const id of this.editIds()) this.params.reset(id);
    this.end();
  };

  /* ---------- wheel ---------- */

  private onWheel = (e: WheelEvent): void => {
    if (this.assignB?.wheel(e)) return;
    e.preventDefault();
    let d = e.deltaY || -e.deltaX;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= 400;
    if (!this.wheelTimer) {
      this.begin();
      this.setActive(true);
    } else {
      clearTimeout(this.wheelTimer);
    }
    const factor = e.shiftKey ? 0.1 : 1;
    // ~2% per standard notch (100px)
    this.setNorm(this.adjust(this.norm - Math.max(-0.08, Math.min(0.08, d * 0.0002 * factor * 1)), e.shiftKey));
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = 0;
      this.end();
      this.setActive(false);
    }, 450);
  };

  /* ---------- keyboard ---------- */

  private onKey = (e: KeyboardEvent): void => {
    if (this.assignB?.keydown(e)) return;
    const fine = e.shiftKey ? 0.1 : 1;
    let n: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        n = this.norm + 0.01 * fine;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        n = this.norm - 0.01 * fine;
        break;
      case 'PageUp':
        n = this.norm + 0.1;
        break;
      case 'PageDown':
        n = this.norm - 0.1;
        break;
      case 'Home':
        n = 0;
        break;
      case 'End':
        n = 1;
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.onReset();
        return;
      default:
        return;
    }
    e.preventDefault();
    this.begin();
    this.setActive(true);
    this.setNorm(n);
    this.end();
  };
}
