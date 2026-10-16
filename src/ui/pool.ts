/**
 * PLAY: pools, the pool player and the footswitch for one engine (docs/hardware-modi-und-pools-2026-10-16.md,
 * points 8A–12A), shared by the PLAY/LOAD tab and CONFIG → FOOT. `mountPlay` wires them to the app:
 * the pool's clock and running morphs at every modulation readout, the MIDI triggers ('pool',
 * 'foot'), Program Change into a running pool, the footswitch key and its actions.
 */
import { pageStorage } from '../core/inputs';
import type { EngineAPI } from '../core/types';
import { FootSwitch, type FootAction } from '../presets/foot';
import type { Preset } from '../presets/io';
import { PoolPlayer, type ClockReading } from '../presets/player';
import { PoolStore } from '../presets/pools';
import { programList } from '../presets/programs';
import { presetSession, type PresetSession } from '../presets/session';
import { followsMidi } from '../shared/paramdefs/modules';
import { clocksOn } from '../core/midi';
import { clockView, tapTempo } from './clock';
import { loadSafely, type Notify } from './tabs/play/browser';

export interface PlayKit {
  session: PresetSession;
  pools: PoolStore;
  player: PoolPlayer;
  foot: FootSwitch;
  /** the footswitch key is being chosen (CONFIG → FOOT): it does not press the switch */
  keyLearning: boolean;
}

const kits = new WeakMap<EngineAPI, PlayKit>();
let notifyFn: Notify = () => {};

/** the clock a pool chose, or the other one while that is off (as the LFOs and clock mods do) */
function poolClock(engine: EngineAPI, choice: 'int' | 'midi'): ClockReading {
  const on = clocksOn(engine.midi);
  return clockView(engine, followsMidi(choice === 'midi', on.int, on.midi) ? 'midi' : 'int');
}

export function playKit(engine: EngineAPI): PlayKit {
  let kit = kits.get(engine);
  if (kit) return kit;
  const session = presetSession(engine);
  const pools = new PoolStore(pageStorage());
  const player = new PoolPlayer(pools, {
    session: {
      load: (p) => loadSafely(() => session.load(p), notifyFn),
      morphTo: (p, ms) => loadSafely(() => session.morphTo(p, ms), notifyFn),
    },
    presets: session.store,
    clock: (c) => poolClock(engine, c),
  });
  const tap = tapTempo(engine);
  const foot = new FootSwitch((a, t) => runFoot(engine, a, t, tap), pageStorage());
  kit = { session, pools, player, foot, keyLearning: false };
  kits.set(engine, kit);
  return kit;
}

/** what the pool did, as a short notice ('Pool 1 · 3/8 · Init') */
export function poolNotice(kit: PlayKit, p: Preset | undefined): string {
  const { player } = kit;
  return p ? `${player.pool.name} · ${player.pos + 1}/${player.pool.entries.length} · ${p.name}` : `${player.pool.name} has no presets to play. Add some in PLAY/LOAD.`;
}

function runFoot(engine: EngineAPI, a: FootAction, t: number, tap: (t: number) => void): void {
  const kit = playKit(engine);
  const { player, session } = kit;
  const pool = (p: Preset | undefined) => {
    if (!p) notifyFn(poolNotice(kit, p), 'error');
  };
  switch (a) {
    case 'bypass':
      engine.params.set('bypass', engine.params.get('bypass') >= 0.5 ? 0 : 1);
      break;
    case 'panic':
      engine.panic();
      break;
    case 'next':
    case 'prev':
      loadSafely(() => session.step(a === 'next' ? 1 : -1), notifyFn);
      break;
    case 'startStop':
      if (player.running) player.stop();
      else pool(player.start());
      break;
    case 'step':
    case 'stepMorph':
      pool(player.step(a === 'stepMorph'));
      break;
    case 'tap':
      tap(t);
      break;
  }
}

/** focus is in a field that takes typing (the footswitch key stays a key there) */
function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(t.type);
}

/** wire the pools and the footswitch to the app (once, from mountApp) */
export function mountPlay(engine: EngineAPI, notify: Notify): PlayKit {
  notifyFn = notify;
  const kit = playKit(engine);
  const { session, pools, player, foot } = kit;

  // the pool's clock and running morphs move at every readout (also in a background tab)
  engine.mod.onReadout(() => {
    player.tick();
    session.morphTick();
  });
  // entries show the library's names
  const syncNames = () => pools.syncNames((id) => session.store.get(id)?.name);
  syncNames();
  session.store.onChange(syncNames);

  /* ---------- MIDI: the pool trigger, the footswitch, Program Change ---------- */
  engine.midi.onTrigger((name, down) => {
    if (name === 'pool' && down) player.midiAdvance();
    else if (name === 'foot') {
      if (down) foot.press('midi', performance.now());
      else foot.release('midi');
    }
  });
  engine.midi.onProgram((n) => {
    const r = player.jump(n);
    if (r === 'jumped') return notify(`Program change ${n + 1}: ${poolNotice(kit, player.presetAt(player.pos))}`);
    if (r === 'missing') return notify(`Program change ${n + 1}: ${player.pool.name} has no preset at ${n + 1}.`, 'error');
    // no pool running: preset n of the library
    const p = programList(session.store)[n];
    if (!p) return notify(`Program change ${n + 1}: there is no preset ${n + 1}.`, 'error');
    loadSafely(() => session.load(p), notify);
    notify(`Program change ${n + 1}: ${p.name}`);
  });

  /* ---------- the footswitch key (capture: before a focused button takes Space) ---------- */
  const isFootKey = (e: KeyboardEvent) => !kit.keyLearning && !!foot.settings.key && e.code === foot.settings.key && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target);
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isFootKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) foot.press('key', e.timeStamp);
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.code !== foot.settings.key) return;
      if (isFootKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      foot.release('key');
    },
    true,
  );
  window.addEventListener('blur', () => foot.release('key'));
  return kit;
}
