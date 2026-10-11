import type { EngineAPI, Unsubscribe } from '../../core/types';
import { SOURCE_BY_ID } from '../../shared/mod/sources';
import { h, toggleClass } from '../dom';
import { assign } from '../mod/assign';
import { onSourceNames, sourceLabel, targetLabel } from '../mod/labels';
import { openSourceRoutes } from '../mod/popover';
import { frameLoop } from '../scheduler';

/**
 * Button representing a modulation source: shows its live value and arms assign mode
 * (click, then click any control to route this source there). Put one in every source panel.
 * Right-click lists the source's targets.
 */
export class SourceChip {
  readonly el: HTMLButtonElement;
  private bar: HTMLElement;
  private count: HTMLElement;
  private unsubs: Unsubscribe[] = [];

  constructor(
    private engine: EngineAPI,
    readonly source: string,
    opts: { label?: string } = {},
  ) {
    const spec = SOURCE_BY_ID[source];
    if (!spec) throw new Error(`unknown mod source ${source}`);
    this.bar = h('span', { class: 'src-chip-bar' });
    this.count = h('span', { class: 'src-chip-count' });
    this.el = h(
      'button',
      {
        type: 'button',
        class: `src-chip src-chip--${spec.cls}${spec.bipolar ? ' is-bipolar' : ''}`,
        'aria-pressed': 'false',
        'data-source': source,
      },
      h('span', { class: 'src-chip-label' }, opts.label ?? spec.short),
      h('span', { class: 'src-chip-meter', 'aria-hidden': 'true' }, this.bar),
      this.count,
    );
    this.el.addEventListener('click', () => assign.toggle(source));
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openSourceRoutes(this.el, source, engine.mod, engine.params);
    });
    const sync = () => {
      const on = assign.source === source;
      toggleClass(this.el, 'is-armed', on);
      this.el.setAttribute('aria-pressed', String(on));
    };
    const syncInfo = () => {
      const routes = engine.mod.routesFrom(source);
      const n = routes.length;
      const name = sourceLabel(source);
      this.count.textContent = n ? String(n) : '';
      this.el.setAttribute('aria-label', `Assign ${name}${n ? `, ${n} target${n === 1 ? '' : 's'}` : ''}`);
      const all = engine.mod.routes();
      const list = routes.map((r) => `\n→ ${targetLabel(r.target, all)}`).join('');
      this.el.title = `Assign ${name}: click, then click or drag the controls to modulate (Esc to finish). Right-click lists its targets.${list}`;
    };
    this.unsubs.push(assign.onChange(sync), engine.mod.onChange(syncInfo), onSourceNames(syncInfo));
    sync();
    syncInfo();
    let last = NaN;
    this.unsubs.push(
      frameLoop.add(() => {
        const v = this.engine.mod.sourceValue(source);
        if (Math.abs(v - last) < 0.002) return;
        last = v;
        // bipolar: bar grows from the centre
        if (spec.bipolar) {
          const c = Math.max(-1, Math.min(1, v));
          this.bar.style.left = `${50 + Math.min(0, c) * 50}%`;
          this.bar.style.width = `${Math.abs(c) * 50}%`;
        } else {
          this.bar.style.left = '0';
          this.bar.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
        }
      }),
    );
  }

  destroy(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }
}
