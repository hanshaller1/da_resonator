// Offline tests for pools and PLAY (docs/hardware-modi-und-pools-2026-10-16.md, points 8A–12A):
// the pool store and its file, the player (directions, missing presets, START / STOP / RESET,
// advancing every N bars, Program Change, MIDI advance), the morph (params, switches, routes,
// landing exactly on the preset), the MIDI triggers and the footswitch.
// Run: node scripts/test-pools.mjs
import { check, importTs, results } from './testkit.mjs';

const PO = importTs('src/presets/pools.ts');
const PL = importTs('src/presets/player.ts');
const FT = importTs('src/presets/foot.ts');
const SE = importTs('src/presets/session.ts');
const ST = importTs('src/presets/store.ts');
const M = importTs('src/core/midi.ts');
const P = importTs('src/shared/params.ts');
const { ParamStore } = importTs('src/core/ParamStore.ts');
const { ModController } = importTs('src/core/ModController.ts');
const { StateHub } = importTs('src/core/state.ts');
const INIT_ONLY = importTs('src/presets/factory.ts').factoryPresets([{ name: 'Init', category: 'Basic' }]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

function makeEngine() {
  const params = new ParamStore();
  const mod = new ModController(params, () => {});
  const hub = new StateHub(params, mod);
  return { params, mod, getState: () => hub.get(), setState: (s) => hub.set(s) };
}

/* ---------- 1. pool store ---------- */
{
  const st = memStorage();
  const s = new PO.PoolStore(st);
  const first = s.selected;
  const startsWithOne = s.pools().length === 1 && first.name === 'Pool 1' && first.entries.length === 0 && first.dir === 'up';
  s.addEntry(first.id, { id: 'a', name: 'Alpha' });
  s.addEntry(first.id, { id: 'b', name: 'Beta' });
  s.addEntry(first.id, { id: 'c', name: 'Gamma' });
  s.addEntry(first.id, { id: 'a', name: 'Alpha' }, 1); // a preset may sit twice, inserted at 1
  const order1 = s.selected.entries.map((e) => e.id).join('');
  s.moveEntry(first.id, 0, 3);
  const order2 = s.selected.entries.map((e) => e.id).join('');
  s.removeEntry(first.id, 0);
  const order3 = s.selected.entries.map((e) => e.id).join('');
  check('1a entries: add, insert, move, remove', startsWithOne && order1 === 'aabc' && order2 === 'abca' && order3 === 'bca', `${order1} → ${order2} → ${order3}`);

  s.update(first.id, { dir: 'pingpong', advance: 'clock', bars: 8, morph: 999999, autoMorph: true });
  const p = s.selected;
  const clamped = p.dir === 'pingpong' && p.advance === 'clock' && p.bars === 8 && p.morph === PO.MORPH_MS_MAX && p.autoMorph;
  s.update(first.id, { morphUnit: 'beats' });
  const toBeats = s.selected.morphUnit === 'beats' && s.selected.morph === 4;
  s.update(first.id, { bars: 3, dir: 'sideways' }); // odd values keep the old ones
  const kept = s.selected.bars === 8 && s.selected.dir === 'pingpong';
  check('1b settings: clamped, unit switch gives 4 beats, odd values ignored', clamped && toBeats && kept);

  const second = s.add('Live');
  s.rename(second.id, 'Live set');
  s.addEntry(second.id, { id: 'factory:init', name: 'Init' });
  const again = new PO.PoolStore(st);
  const persisted = again.pools().length === 2 && again.selected.name === 'Live set' && again.pools()[0].entries.map((e) => e.id).join('') === 'bca' && again.pools()[0].morphUnit === 'beats';
  again.remove(again.selected.id);
  const afterDel = again.pools().length === 1 && again.selected.id === first.id;
  again.remove(again.selected.id); // the last one is emptied, not deleted
  const lastStays = again.pools().length === 1 && again.selected.entries.length === 0;
  check('1c stored in the browser; delete; the last pool stays (emptied)', persisted && afterDel && lastStays);

  // file: user presets found by name on another computer, unknown ones kept as missing
  const src = new PO.PoolStore(memStorage());
  src.rename(src.selected.id, 'Gig');
  src.addEntry(src.selected.id, { id: 'u_old1', name: 'My Pad' });
  src.addEntry(src.selected.id, { id: 'factory:init', name: 'Init' });
  src.addEntry(src.selected.id, { id: 'u_old2', name: 'Gone' });
  src.update(src.selected.id, { dir: 'random' });
  const text = src.exportText();
  const dst = new PO.PoolStore(memStorage());
  dst.rename(dst.selected.id, 'Gig');
  const r = dst.importText(text, [
    { id: 'factory:init', name: 'Init' },
    { id: 'u_new9', name: 'My Pad' },
  ]);
  const imp = dst.selected;
  const ok = r.ok && r.count === 1 && r.missing === 1 && imp.name === 'Gig 2' && imp.dir === 'random' && imp.entries.map((e) => e.id).join(',') === 'u_new9,factory:init,u_old2';
  const bad = dst.importText('{"format":"something"}', []);
  check('1d pool file: export / import, matched by id or name, missing kept, name numbered', ok && !bad.ok, `${JSON.stringify(r)} ${imp.entries.map((e) => e.id)}`);
}

/* ---------- 2. player ---------- */
function makePlayer(ids, settings = {}, present = ids) {
  const pools = new PO.PoolStore(memStorage());
  const pool = pools.selected;
  for (const id of ids) pools.addEntry(pool.id, { id, name: id.toUpperCase() });
  pools.update(pool.id, settings);
  const log = [];
  const clock = { beats: 0, bpm: 120, running: true, live: true };
  let rnd = 0.3;
  const player = new PL.PoolPlayer(pools, {
    session: { load: (p) => log.push(`L${p.id}`), morphTo: (p, ms) => log.push(`M${p.id}@${Math.round(ms)}`) },
    presets: { get: (id) => (present.includes(id) ? { id, name: id } : undefined) },
    clock: () => clock,
    random: () => (rnd = (rnd * 7.31 + 0.17) % 1),
  });
  return { pools, player, log, clock };
}
const seq = (player, n, morph = false) => Array.from({ length: n }, () => player.step(morph)?.id ?? '-').join('');
{
  const up = makePlayer(['a', 'b', 'c', 'd']);
  const s1 = seq(up.player, 6);
  const down = makePlayer(['a', 'b', 'c', 'd'], { dir: 'down' });
  const s2 = seq(down.player, 6);
  const pp = makePlayer(['a', 'b', 'c', 'd'], { dir: 'pingpong' });
  const s3 = seq(pp.player, 8);
  const rn = makePlayer(['a', 'b', 'c', 'd'], { dir: 'random' });
  const s4 = seq(rn.player, 40);
  let noRepeat = true;
  for (let i = 1; i < s4.length; i++) if (s4[i] === s4[i - 1]) noRepeat = false;
  const allSeen = ['a', 'b', 'c', 'd'].every((x) => s4.includes(x));
  check('2a directions: Up, Down, Ping-Pong, Random (no repeats)', s1 === 'abcdab' && s2 === 'dcbadc' && s3 === 'abcdcbab' && noRepeat && allSeen, `${s1} ${s2} ${s3} ${s4.slice(0, 12)}…`);

  const gaps = makePlayer(['a', 'x', 'b', 'y'], {}, ['a', 'b']);
  const s5 = seq(gaps.player, 4);
  const none = makePlayer(['x'], {}, []);
  const nothing = none.player.step() === undefined && none.player.start() === undefined && !none.player.running;
  check('2b deleted presets are skipped; a pool with none plays nothing', s5 === 'abab' && nothing, s5);
}
{
  const t = makePlayer(['a', 'b', 'c']);
  const { player, log } = t;
  player.start();
  const started = player.running && player.pos === 0 && log.at(-1) === 'La';
  player.step();
  player.step(true);
  const morphed = log.at(-1) === 'Mc@2000';
  player.stop();
  const stopped = !player.running && player.pos === 2;
  player.start(); // from the current entry
  const resumed = player.running && log.at(-1) === 'Lc';
  player.reset();
  const reset = player.pos === 0 && log.at(-1) === 'La';
  check('2c START loads the first entry, STEP / STEP+MORPH, STOP keeps the place, START resumes, RESET', started && morphed && stopped && resumed && reset, log.join(' '));

  // entries moved while playing: the current one is followed
  t.pools.moveEntry(t.pools.selected.id, 0, 2); // a goes to the end: b c a
  const followed = player.pos === 2;
  check('2d reordering keeps the current entry', followed, `pos ${player.pos}`);
}
{
  // CLOCK: every 2 bars of the clock; a restart only resyncs
  const t = makePlayer(['a', 'b', 'c'], { advance: 'clock', bars: 2 });
  const { player, log, clock } = t;
  clock.beats = 3.2;
  player.start();
  const steps = [];
  for (let b = 3.2; b < 26; b += 0.05) {
    clock.beats = b;
    const before = log.length;
    player.tick();
    if (log.length > before) steps.push(`${log.at(-1)}@${b.toFixed(2)}`);
  }
  const onGrid = steps.length === 3 && steps.every((s) => {
    const b = Number(s.split('@')[1]);
    return Math.abs(b / 8 - Math.round(b / 8)) < 0.01;
  });
  clock.beats = 0.5; // MIDI Start / RESET: back to beat 0, no step
  const n = log.length;
  player.tick();
  const resync = log.length === n;
  clock.beats = 8.01;
  player.tick();
  const next = log.length === n + 1;
  player.stop();
  clock.beats = 40;
  player.tick();
  const idle = log.length === n + 1;
  check('2e CLOCK: a step on every 2-bar line, a restarted clock resyncs, nothing while stopped', onGrid && resync && next && idle, steps.join(' '));

  // morph time in beats follows the clock's tempo
  t.pools.update(t.pools.selected.id, { morphUnit: 'beats', morph: 2, autoMorph: true });
  clock.bpm = 90;
  const ms = player.morphMs();
  check('2f morph time in beats: 2 beats at 90 BPM = 1333 ms', near(ms, 1333.333, 0.01), ms.toFixed(2));
}
{
  // Program Change in a running pool; MIDI advance only with ADVANCE MIDI
  const t = makePlayer(['a', 'b', 'c'], { advance: 'midi', autoMorph: true, morph: 500 });
  const { player, log } = t;
  const off = player.jump(1) === 'not-running';
  const noMidiWhileStopped = player.midiAdvance() === undefined;
  player.start();
  const pc = player.jump(2) === 'jumped' && log.at(-1) === 'Mc@500';
  const pcMissing = player.jump(7) === 'missing';
  player.midiAdvance();
  const midiStep = log.at(-1) === 'Ma@500';
  t.pools.update(t.pools.selected.id, { advance: 'hand' });
  const n = log.length;
  player.midiAdvance();
  const handIgnores = log.length === n;
  check('2g Program Change n → entry n while running (else the library), MIDI advance with ADVANCE MIDI only', off && noMidiWhileStopped && pc && pcMissing && midiStep && handIgnores, log.join(' '));
}

/* ---------- 3. morph ---------- */
{
  const e = makeEngine();
  const store = new ST.PresetStore(ST.memoryBackend(), INIT_ONLY);
  await store.ready;
  let now = 0;
  const s = new SE.PresetSession(e, store, store.get('factory:init'), () => now);
  await sleep(0);
  // the old sound: a route only it has, a shared route, LFO 2 on
  e.params.set('band3.gain', -12);
  e.params.set('filterPost.cutoff', 200);
  e.params.set('lfo2.on', 1);
  e.mod.addRoute('lfo1', 'band2.res', 0.8); // shared
  e.mod.addRoute('lfo3', 'mix', 0.6); // old only
  // the new sound
  const t = makeEngine();
  t.params.set('band3.gain', 0);
  t.params.set('filterPost.cutoff', 3200);
  t.params.set('lfo2.on', 0);
  t.params.set('lfo1.shape', 2);
  t.mod.addRoute('lfo1', 'band2.res', 0.2);
  t.mod.addRoute('cmod1', 'band5.gain', -0.4); // new only
  const target = await store.add('Target', 'Tests', t.getState());

  s.morphTo(target, 1000);
  const route = (src, dst) => e.mod.routes().find((r) => r.source === src && r.target === dst);
  const depth = (r) => (r ? e.params.get(r.depthParam) : NaN);
  const switchesJump = e.params.get('lfo2.on') === 0 && e.params.get('lfo1.shape') === 2;
  const newAtZero = near(depth(route('cmod1', 'band5.gain')), 0);
  now = 500;
  s.morphTick();
  // halfway in the normalised range: a cutoff glides in octaves (200 → 3200 Hz: 800 Hz in the middle)
  const cut = e.params.get('filterPost.cutoff');
  const half = near(cut, 800, 1) && near(depth(route('lfo1', 'band2.res')), 0.5, 1e-3) && near(depth(route('lfo3', 'mix')), 0.3, 1e-3) && near(depth(route('cmod1', 'band5.gain')), -0.2, 1e-3);
  const gainSpec = P.PARAM_BY_ID['band3.gain'];
  const gainHalf = near(P.toNorm(gainSpec, e.params.get('band3.gain')), (P.toNorm(gainSpec, -12) + P.toNorm(gainSpec, 0)) / 2, 1e-4);
  const notDirty = !s.dirty && s.name === 'Target' && s.morphProgress === 0.5;
  check('3a morph: switches jump, values glide in their range, routes fade in and out', switchesJump && newAtZero && half && gainHalf && notDirty, `cutoff ${cut.toFixed(1)} Hz, depths ${depth(route('lfo1', 'band2.res')).toFixed(3)} / ${depth(route('lfo3', 'mix')).toFixed(3)} / ${depth(route('cmod1', 'band5.gain')).toFixed(3)}`);

  now = 1000;
  s.morphTick();
  const same = JSON.stringify(e.getState()) === JSON.stringify(store.get(target.id).snapshot);
  check('3b morph ends exactly on the preset, saved state', same && !s.dirty && s.morphProgress === -1 && s.presetId === target.id);

  // a load during a morph takes over; stopping leaves the reached sound, marked modified
  s.load(store.get('factory:init'));
  s.morphTo(target, 1000);
  now = 1300;
  s.morphTick();
  s.stopMorph();
  const stoppedMid = s.dirty && s.morphProgress === -1;
  now = 5000;
  s.morphTick();
  const from = store.get('factory:init').snapshot.params['filterPost.cutoff'];
  const mid = e.params.get('filterPost.cutoff');
  const staysMid = mid < Math.max(from, 3200) - 1 && mid > Math.min(from, 3200) + 1;
  check('3c a stopped morph stays where it was (modified)', stoppedMid && staysMid, `cutoff ${from} → ${mid.toFixed(1)} → 3200`);
  s.dispose();
}

/* ---------- 4. MIDI triggers ---------- */
{
  const storage = memStorage();
  const ps = new ParamStore();
  const m = new M.MidiService({ allowed: true, storage, now: () => 0 }, ps);
  const log = [];
  m.onTrigger((n, d) => log.push(`${n}:${d ? 'down' : 'up'}`));
  m.setTrigger('foot', { kind: 'note', num: 60 });
  m.handle([0x90, 60, 100], 0);
  m.handle([0x90, 60, 0], 0); // velocity 0 = off
  m.handle([0x90, 61, 100], 0); // other note: nothing
  m.handle([0x80, 60, 0], 0); // already up
  const notes = log.join(' ') === 'foot:down foot:up';
  check('4a a note presses and releases its trigger', notes, log.join(' '));

  log.length = 0;
  const mappedBefore = m.paramOf(20); // CC 20 = band 1 level by default
  m.setTrigger('pool', { kind: 'cc', num: 20 });
  const takenFromMap = mappedBefore && m.paramOf(20) === undefined;
  const g0 = ps.get('band0.gain');
  m.handle([0xb0, 20, 127], 0);
  m.handle([0xb0, 20, 100], 0); // still down: no second press
  m.handle([0xb0, 20, 0], 0);
  const cc = log.join(' ') === 'pool:down pool:up' && ps.get('band0.gain') === g0;
  m.setCc('band0.gain', 20); // the control takes it back
  const back = m.triggerOf('pool') === undefined && m.paramOf(20) === 'band0.gain';
  check('4b a CC presses at 64 and up; a CC is a control’s or a trigger’s', takenFromMap && cc && back, log.join(' '));

  const learned = [];
  m.onTriggerLearn((n, t) => learned.push(`${n}=${M.triggerText(t)}`));
  m.learnTrigger('pool');
  m.handle([0x91, 36, 90], 0); // channel 2: not listened to
  m.handle([0x90, 36, 90], 0);
  const again = new M.MidiService({ allowed: true, storage, now: () => 0 }, new ParamStore());
  const kept = again.triggerOf('pool')?.num === 36 && again.triggerOf('foot')?.num === 60;
  check('4c learn a trigger (listened channels only), remembered in the browser', learned.join() === 'pool=Note C1' && m.triggerLearning === null && kept, learned.join());
}

/* ---------- 5. footswitch ---------- */
{
  const fired = [];
  const storage = memStorage();
  const f = new FT.FootSwitch((a, t) => fired.push(`${a}@${t}`), storage);
  const defaults = f.settings.short === 'step' && f.settings.hold === 'bypass' && f.settings.key === 'Space';
  f.press('key', 10);
  await sleep(60);
  f.release('key');
  const short = fired.join() === 'step@10';
  fired.length = 0;
  f.press('button', 20);
  await sleep(FT.HOLD_MS + 80);
  const holdFired = fired.join() === 'bypass@20';
  f.release('button');
  const noShortAfterHold = fired.length === 1;
  check('5a short press fires SHORT on release, holding fires HOLD (once)', defaults && short && holdFired && noShortAfterHold, fired.join());

  fired.length = 0;
  f.set({ short: 'tap', hold: 'none', key: 'KeyF' });
  f.press('midi', 30);
  const atPress = fired.join() === 'tap@30';
  f.press('key', 31); // a second source while down: ignored
  f.release('key');
  f.release('midi');
  const once = fired.length === 1;
  const again = new FT.FootSwitch(() => {}, storage);
  const kept = again.settings.short === 'tap' && again.settings.hold === 'none' && again.settings.key === 'KeyF' && FT.keyName('KeyF') === 'F';
  check('5b without HOLD, SHORT fires on the press; one source at a time; remembered', atPress && once && kept, fired.join());
}

console.table(results);
