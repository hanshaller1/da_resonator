// Offline tests for MIDI (docs/midi-2026-10-16.md): the external clock (tempo, Start / Stop /
// Continue, jitter, tempo change, OFFSET), the clock in ModEngine and the worklet, CCs on the
// channels IN / IN L / IN R, MIDI learn, the stored map, the map file, Program Change and the
// program order of the presets.
// Run: node scripts/test-midi.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results } from './testkit.mjs';

const X = importTs('src/dsp/extClock.ts');
const ME = importTs('src/dsp/ModEngine.ts');
const P = importTs('src/shared/params.ts');
const M = importTs('src/core/midi.ts');
const MM = importTs('src/core/midiMap.ts');
const PS = importTs('src/core/ParamStore.ts');
const PR = importTs('src/presets/programs.ts');
const ST = importTs('src/presets/store.ts');

const DT = BLOCK / FS;
const tickSec = (bpm) => 60 / bpm / 24;
let seed = 99;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

/**
 * Run an ExtClock over [t0, t1): events [[t, ev]] are pushed a little before they are due (like
 * the main thread), blocks of 128 samples. Returns per block {t, beats, bpm, run, started}.
 */
function drive(clk, events, t0, t1, c = { bpm: 120, running: true, beats: 0, beatsPrev: 0 }) {
  const out = [];
  events = [...events].sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (let t = t0; t < t1; t += DT) {
    const end = t + DT;
    while (k < events.length && events[k][0] <= end + 0.05) clk.push(events[k][1], events[k++][0]);
    const started = clk.advance(c, end, DT);
    out.push({ t: end, beats: c.beats, prev: c.beatsPrev, bpm: c.bpm, run: c.running, started });
  }
  return { out, c };
}
const ticks = (from, n, bpm, jitter = 0) => Array.from({ length: n }, (_, i) => [from + i * tickSec(bpm) + jitter * rnd(), X.MIDI_TICK]);
const at = (out, t) => out.reduce((best, o) => (Math.abs(o.t - t) < Math.abs(best.t - t) ? o : best), out[0]);

/* ---------- 1. ExtClock ---------- */
{
  // a) joined a running device: no Start, ticks at 120 BPM; tempo measured, position runs at it
  const clk = new X.ExtClock();
  clk.reset(0, 100);
  const { out } = drive(clk, ticks(0.5, 24 * 8, 120), 0, 4.5);
  const o = at(out, 4);
  check('1a tempo from the ticks (no Start)', Math.abs(o.bpm - 120) < 0.01, `bpm ${o.bpm.toFixed(3)}`);
  const slope = (at(out, 4).beats - at(out, 2).beats) / 2;
  check('1a position runs at 2 beats/s', Math.abs(slope - 2) < 0.005, `slope ${slope.toFixed(4)}`);
  check('1a runs before any tick (last tempo)', at(out, 0.3).beats > 0.4 && at(out, 0.3).run, `beats at 0.3 s ${at(out, 0.3).beats.toFixed(3)}`);
}
{
  // b) Start: beat 0, waits for the first tick, then beat = ticks / 24
  const clk = new X.ExtClock();
  clk.reset(7.3, 120);
  const t1 = 1.0;
  const ev = [[t1 - 0.01, X.MIDI_START], ...ticks(t1, 24 * 6, 120)];
  const { out } = drive(clk, ev, 0.5, 4.0);
  const st = out.filter((o) => o.started);
  check('1b Start reported once', st.length === 1, `${st.length}`);
  const wait = at(out, t1 - 0.004);
  check('1b after Start: beat 0, holding until the first tick', wait.beats === 0 && !wait.run, `beats ${wait.beats} run ${wait.run}`);
  let maxErr = 0;
  for (const o of out) if (o.t > t1 + 0.6 && o.t < 3.9) maxErr = Math.max(maxErr, Math.abs(o.beats - (o.t - t1) * 2));
  check('1b position on the ticks (beat = time since first tick × 2)', maxErr < 0.004, `max error ${maxErr.toFixed(5)} beats`);
  const b1 = out.find((o) => Math.floor(o.beats) === 1 && Math.floor(o.prev) === 0);
  check('1b beat 2 falls on tick 24', !!b1 && Math.abs(b1.t - (t1 + 24 * tickSec(120))) < DT + 0.002, b1 ? `at ${(b1.t - t1).toFixed(4)} s (tick 24 at ${(24 * tickSec(120)).toFixed(4)} s)` : 'never');
}
{
  // c) Stop holds (ticks keep coming), Continue resumes at the next tick
  const clk = new X.ExtClock();
  clk.reset(0, 120);
  const ev = [[0.99, X.MIDI_START], ...ticks(1, 24 * 8, 120), [2.0, X.MIDI_STOP], [3.0, X.MIDI_CONTINUE]];
  // ticks 0 … : tick at 2.0 is t=1+48*tickSec → the one at exactly 2.0 s
  const { out } = drive(clk, ev, 0.9, 4.0);
  const held = at(out, 2.5);
  const atStop = at(out, 2.01);
  check('1c Stop holds the position', !held.run && Math.abs(held.beats - atStop.beats) < 1e-9 && Math.abs(held.beats - 2) < 0.02, `beats at stop ${atStop.beats.toFixed(4)}, at 2.5 s ${held.beats.toFixed(4)}`);
  check('1c tempo still measured while stopped', Math.abs(held.bpm - 120) < 0.01, `bpm ${held.bpm.toFixed(3)}`);
  const resumed = at(out, 3.5);
  // ticks counted: 0..47 before Stop (48 ticks up to 2.0 s, the one at 2.0 s comes after Stop? it is due at 2.0 = Stop time)
  check('1c Continue resumes where it stopped', resumed.run && resumed.beats > atStop.beats + 0.9 && resumed.beats < atStop.beats + 1.1, `beats at 3.5 s ${resumed.beats.toFixed(4)} (stopped at ${atStop.beats.toFixed(4)}, 0.5 s on = +1)`);
  let mono = true;
  for (let i = 1; i < out.length; i++) if (out[i].t > 1 && out[i].beats < out[i - 1].beats - 1e-12) mono = false;
  check('1c position never runs backwards (after Start)', mono);
}
{
  // d) tempo change 120 → 90 BPM: tempo follows within two beats, position stays on the ticks
  const clk = new X.ExtClock();
  clk.reset(0, 120);
  const a = ticks(1, 48, 120);
  const tc = 1 + 48 * tickSec(120);
  const b = ticks(tc, 24 * 6, 90);
  const { out } = drive(clk, [[0.99, X.MIDI_START], ...a, ...b], 0.9, tc + 5.5);
  const o = at(out, tc + 2 * (60 / 90) + 0.05);
  check('1d tempo 120 → 90 followed within two beats', Math.abs(o.bpm - 90) < 0.05, `bpm ${o.bpm.toFixed(3)}`);
  // the first slower tick comes late: until then the clock runs on at 120 (one tick of 120 vs 90 = 0.014 beats)
  let errChange = 0, errAfter = 0;
  for (const x of out) {
    const e = Math.abs(x.beats - (2 + ((x.t - tc) * 90) / 60));
    if (x.t > tc && x.t < tc + 5) errChange = Math.max(errChange, e);
    if (x.t > tc + 60 / 90 / 2 && x.t < tc + 5) errAfter = Math.max(errAfter, e);
  }
  check('1d during the change at most one tick off', errChange < 0.02, `max error ${errChange.toFixed(5)} beats`);
  check('1d back on the ticks within half a beat', errAfter < 0.003, `max error ${errAfter.toFixed(5)} beats`);
}
{
  // e) jitter ±1 ms on every tick: tempo steady, position close, never backwards
  const clk = new X.ExtClock();
  clk.reset(0, 120);
  seed = 7;
  const { out } = drive(clk, [[0.99, X.MIDI_START], ...ticks(1, 24 * 10, 133, 0.001)], 0.9, 5.4);
  let bMin = Infinity, bMax = -Infinity, maxErr = 0, mono = true;
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    if (x.t > 1 && x.beats < out[i - 1].beats - 1e-12) mono = false;
    if (x.t > 2 && x.t < 5) {
      bMin = Math.min(bMin, x.bpm);
      bMax = Math.max(bMax, x.bpm);
      maxErr = Math.max(maxErr, Math.abs(x.beats - ((x.t - 1) * 133) / 60));
    }
  }
  check('1e jitter ±1 ms: tempo within ±0.5 BPM', bMin > 132.5 && bMax < 133.5, `${bMin.toFixed(2)} … ${bMax.toFixed(2)}`);
  check('1e jitter ±1 ms: position within 0.01 beats', maxErr < 0.01, `max error ${maxErr.toFixed(5)}`);
  check('1e jitter: never backwards', mono);
}
{
  // e2) the same at 300 BPM (ticks 8.3 ms apart)
  const clk = new X.ExtClock();
  clk.reset(0, 120);
  seed = 11;
  const { out } = drive(clk, [[0.99, X.MIDI_START], ...ticks(1, 24 * 20, 300, 0.001)], 0.9, 4.9);
  let bMin = Infinity, bMax = -Infinity, maxErr = 0;
  for (const x of out) {
    if (x.t < 2 || x.t > 4.5) continue;
    bMin = Math.min(bMin, x.bpm);
    bMax = Math.max(bMax, x.bpm);
    maxErr = Math.max(maxErr, Math.abs(x.beats - ((x.t - 1) * 300) / 60));
  }
  check('1e 300 BPM with jitter: tempo within ±1.5 BPM', bMin > 298.5 && bMax < 301.5, `${bMin.toFixed(2)} … ${bMax.toFixed(2)}`);
  check('1e 300 BPM with jitter: position within 2 ms', maxErr < 0.01, `max error ${maxErr.toFixed(5)} beats = ${((maxErr * 60) / 300 * 1000).toFixed(2)} ms`);
}
{
  // f) the clock goes away: last tempo runs on; it comes back: carries on without a jump
  const clk = new X.ExtClock();
  clk.reset(0, 120);
  const a = ticks(1, 48, 150);
  const back = 4.0;
  const { out } = drive(clk, [...a, ...ticks(back, 48, 150)], 0.9, 5.5);
  const s1 = (at(out, 3.5).beats - at(out, 2.5).beats) / 1;
  check('1f no clock: runs on at the last tempo (150 BPM)', Math.abs(s1 - 2.5) < 0.01 && at(out, 3.5).run, `${(s1 * 60).toFixed(2)} BPM`);
  let jump = 0;
  for (let i = 1; i < out.length; i++) if (out[i].t > back - 0.1 && out[i].t < back + 0.3) jump = Math.max(jump, out[i].beats - out[i - 1].beats);
  check('1f clock back: no jump', jump < 2.5 * DT * 1.5, `largest step ${jump.toFixed(5)} beats (one block at 150 BPM = ${(2.5 * DT).toFixed(5)})`);
}
{
  // g) OFFSET: events stamped later are applied later (not when they arrive)
  const run = (shift) => {
    const clk = new X.ExtClock();
    clk.reset(0, 120);
    const { out } = drive(clk, [[0.99 + shift, X.MIDI_START], ...ticks(1 + shift, 24 * 4, 120)], 0.9, 3.5);
    return out.find((o) => o.beats >= 2);
  };
  const a = run(0), b = run(0.04);
  check('1g OFFSET +40 ms delays the beats by 40 ms', Math.abs(b.t - a.t - 0.04) <= DT + 1e-9, `beat 3 at ${a.t.toFixed(4)} s / ${b.t.toFixed(4)} s`);
}

/* ---------- 2. ModEngine and the worklet ---------- */
{
  const frames = [];
  const eng = new ME.ModEngine(FS, (f) => frames.push(f));
  const v = P.defaultValues();
  v[P.paramIndex('lfo1.on')] = 1;
  v[P.paramIndex('lfo1.sync')] = 1;
  v[P.paramIndex('clock.bpm')] = 100;
  eng.setBase(v);
  // internal clock first, then MIDI: position carries over
  for (let i = 0; i < 375; i++) (eng.beginBlock(BLOCK), eng.endBlock());
  const before = eng.clock.beats;
  eng.setClockSource(true);
  const t0 = eng.now;
  eng.pushClock(X.MIDI_START, t0 + 0.1);
  for (let i = 0; i < 24 * 8; i++) eng.pushClock(X.MIDI_TICK, t0 + 0.11 + i * tickSec(140));
  let beatsAtStart = null, beatTrig = 0;
  for (let i = 0; i < Math.round(3.2 / DT); i++) {
    eng.beginBlock(BLOCK);
    if (Math.floor(eng.clock.beats) !== Math.floor(eng.clock.beatsPrev)) beatTrig++;
    if (beatsAtStart === null && eng.now > t0 + 0.105) beatsAtStart = eng.clock.beats;
    eng.endBlock();
  }
  check('2a switching to MIDI keeps the position', before > 1.5 && eng.clock.beats > 0, `beats before ${before.toFixed(3)}`);
  check('2a MIDI Start: beat 0', beatsAtStart === 0, `beats right after Start ${beatsAtStart}`);
  const f = frames[frames.length - 1];
  const expect = ((t0 + 3.2 - (t0 + 0.11)) * 140) / 60;
  check('2a measured tempo, run and beats', Math.abs(f.bpm - 140) < 0.05 && f.run === 1 && Math.abs(eng.clock.beats - expect) < 0.005, `bpm ${f.bpm.toFixed(2)} run ${f.run} beats ${eng.clock.beats.toFixed(4)} (≈ ${expect.toFixed(4)})`);
  check('2a beat trigger once per beat', beatTrig === Math.floor(eng.clock.beats), `${beatTrig} triggers, beat ${eng.clock.beats.toFixed(2)}`);
  eng.setClockSource(false);
  eng.beginBlock(BLOCK);
  check('2b back on INT: TEMPO again', eng.clock.bpm === 100 && eng.clock.running, `bpm ${eng.clock.bpm}`);
}
{
  // worklet: clockSource + midiClock messages, currentTime moving
  const proc = loadProcessor();
  const send = (m) => proc.port.onmessage({ data: m });
  send({ type: 'params', values: P.defaultValues() });
  send({ type: 'clockSource', ext: true });
  const iL = new Float32Array(BLOCK), oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
  const T0 = 12.5; // the context has been running for a while
  proc.scope.currentTime = T0;
  send({ type: 'midiClock', ev: X.MIDI_START, t: T0 + 0.05 });
  for (let i = 0; i < 24 * 4; i++) send({ type: 'midiClock', ev: X.MIDI_TICK, t: T0 + 0.06 + i * tickSec(90) });
  for (let k = 0; k < Math.round(2.5 / DT); k++) {
    proc.process([[iL, iL]], [[oL, oR]]);
    proc.scope.currentTime += DT;
  }
  const mods = proc.port.sent.filter((m) => m.type === 'mod');
  const last = mods[mods.length - 1];
  const expect = ((T0 + 2.5 - (T0 + 0.06)) * 90) / 60;
  check('2c worklet follows MIDI clock on the AudioContext time line', Math.abs(last.bpm - 90) < 0.05 && Math.abs(last.beats - expect) < 0.05, `bpm ${last.bpm.toFixed(2)}, beats ${last.beats.toFixed(3)} (≈ ${expect.toFixed(3)})`);
  send({ type: 'midiClock', ev: X.MIDI_STOP, t: proc.scope.currentTime });
  for (let k = 0; k < 40; k++) {
    proc.process([[iL, iL]], [[oL, oR]]);
    proc.scope.currentTime += DT;
  }
  const after = proc.port.sent.filter((m) => m.type === 'mod').pop();
  check('2c Stop: run 0 in the readout', after.run === 0, `run ${after.run}`);
}

/* ---------- 3. MidiService: CCs, channels, learn, storage, Program Change, devices ---------- */
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}
function fakeAccess(ports) {
  const inputs = new Map(ports.map((p) => [p.id, { state: 'connected', manufacturer: '', onmidimessage: null, ...p }]));
  return { inputs, onstatechange: null };
}
const send = (port, bytes, t = 0) => port.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: t });

const storage = memStorage();
const params = new PS.ParamStore();
const clockLog = [];
const access = fakeAccess([
  { id: 'iac', name: 'IAC Driver Bus 1' },
  { id: 'dt', name: 'Elektron Digitakt', manufacturer: 'Elektron Music Machines' },
]);
const midi = new M.MidiService({ request: async () => access, permission: async () => 'prompt', allowed: true, storage, now: () => 0 }, params, (ev, ms) => clockLog.push([ev, ms]));
await midi.enable();
const dt = access.inputs.get('dt');
const iac = access.inputs.get('iac');
check('3a MIDI on, ELEKTRON AUTO takes the Digitakt', midi.status === 'on' && midi.deviceId === 'dt' && midi.connected && dt.onmidimessage !== null && iac.onmidimessage === null, `status ${midi.status}, device ${midi.deviceId}`);

send(dt, [0xb0, 20, 127]);
check('3b IN (ch 1) CC 20 = 127: band 1 level +12 dB in L and R', params.get('band0.gain') === 12 && params.get('band0.gainR') === 12, `L ${params.get('band0.gain')} R ${params.get('band0.gainR')}`);
send(dt, [0xb0, 20, 64]);
check('3b CC 64 lands exactly on 0 dB', params.get('band0.gain') === 0 && params.get('band0.gainR') === 0, `${params.get('band0.gain')}`);
send(dt, [0xb0, 45, 127]);
check('3b CC 45 = band 6 RES', params.get('band5.res') === 1 && params.get('band5.resR') === 1);
send(iac, [0xb0, 20, 0]);
check('3b messages of another device are ignored', params.get('band0.gain') === 0);

midi.setChannel('l', 2);
midi.setChannel('r', 3);
send(dt, [0xb1, 52, 100]); // ch 2 = IN L, band 3 FB
check('3c IN L moves only L', Math.abs(params.get('band2.fb') - 100 / 127) < 1e-6 && params.get('band2.fbR') === 0, `L ${params.get('band2.fb').toFixed(4)} R ${params.get('band2.fbR')}`);
send(dt, [0xb2, 52, 27]); // ch 3 = IN R
check('3c IN R moves only R', Math.abs(params.get('band2.fbR') - 27 / 127) < 1e-6 && Math.abs(params.get('band2.fb') - 100 / 127) < 1e-6, `L ${params.get('band2.fb').toFixed(4)} R ${params.get('band2.fbR').toFixed(4)}`);
send(dt, [0xb1, 72, 0]); // dry/wet has no R: IN L acts like IN
check('3c params without L/R follow IN L like IN', params.get('mix') === 0, `mix ${params.get('mix')}`);
send(dt, [0xb4, 72, 127]); // ch 5: not listened to
check('3c other channels are ignored', params.get('mix') === 0);
send(dt, [0xb0, 73, 64]);
check('3d FB ALL switch: on from 64 (L and R)', params.get('fbAllOn') === 1 && params.get('fbAllOnR') === 1);
send(dt, [0xb0, 73, 63]);
check('3d FB ALL switch: off below 64', params.get('fbAllOn') === 0 && params.get('fbAllOnR') === 0);
send(dt, [0xb0, 109, 127]);
check('3d macro 8 on CC 109', params.get('macro8.value') === 1);
check('3d INPUT and OUTPUT are not in the default map', midi.ccOf('inputGain') === undefined && midi.ccOf('outputGain') === undefined);

// learn
midi.learn('lfo1.rate');
send(dt, [0xb0, 30, 127]);
check('3e MIDI learn maps the next CC and moves the control', midi.ccOf('lfo1.rate') === 30 && midi.learning === null && params.get('lfo1.rate') === params.spec('lfo1.rate').max, `cc ${midi.ccOf('lfo1.rate')}`);
midi.learn('outputGain');
send(dt, [0xb0, 21, 0]); // CC 21 was band 2 level
check('3e learning a used CC takes it from the other control', midi.ccOf('outputGain') === 21 && midi.ccOf('band1.gain') === undefined && params.get('outputGain') === -24);
midi.learn('band3.gainR');
check('3e R twins are not learnable (IN R reaches them)', midi.learning === null);
midi.learn('mix');
send(dt, [0xb0, 0, 5]);
send(dt, [0xb0, 121, 5]);
check('3e bank select and channel mode CCs are never learned', midi.learning === 'mix' && midi.ccOf('mix') === 72);
midi.learn(null);
midi.setCc('mix', null);
check('3e remove a CC', midi.ccOf('mix') === undefined && midi.paramOf(72) === undefined);

// storage
midi.setClockSource('midi');
midi.setOffset(17.4);
const again = new M.MidiService({ request: async () => access, allowed: true, storage, now: () => 0 }, new PS.ParamStore());
check(
  '3f map, channels, clock and offset survive a reload',
  again.ccOf('lfo1.rate') === 30 && again.ccOf('outputGain') === 21 && again.ccOf('band1.gain') === undefined && again.ccOf('mix') === undefined && again.channels.l === 2 && again.channels.r === 3 && again.clockSource === 'midi' && again.offsetMs === 17 && again.deviceName === 'Elektron Digitakt',
  JSON.stringify(again.channels),
);
check('3f stored as plain JSON in resonator.midi', typeof JSON.parse(storage.map.get('resonator.midi')).map === 'object');

// file
const file = midi.exportMap();
const other = new M.MidiService({ allowed: true, storage: memStorage() }, new PS.ParamStore());
const imp = other.importMap(file.text);
check('3g map file: export → import gives the same map and channels', imp.ok && JSON.stringify(other.mapEntries()) === JSON.stringify(midi.mapEntries()) && other.channels.l === 2, `${imp.ok ? imp.count : imp.reason}`);
const bad = other.importMap('{"format":"da-resonator","presets":[]}');
check('3g a preset file is refused as map file', !bad.ok && JSON.stringify(other.mapEntries()) === JSON.stringify(midi.mapEntries()), bad.ok ? '' : bad.reason);
const dirty = MM.parseMidiMapFile(JSON.stringify({ format: 'resonator-midi', version: 1, map: { 'band0.gain': 20, 'band1.gain': 20, 'band0.gainR': 30, nope: 31, mix: 120, spread: 300 } }));
check('3g broken entries are skipped (double CC, R twin, unknown, reserved, out of range)', dirty.ok && dirty.map.size === 1 && dirty.skipped === 5, dirty.ok ? `${dirty.map.size} kept, ${dirty.skipped} skipped` : dirty.reason);
other.resetMap();
check('3g DEFAULT restores the default map', other.mapEntries().length === 30 + 6 + 8 && other.ccOf('band9.fb') === 59);

// clock + program change
clockLog.length = 0;
send(dt, [0xfa], 1000);
send(dt, [0xf8], 1010);
send(dt, [0xfc], 1020);
send(dt, [0xfb], 1030);
send(dt, [0xfe], 1040); // active sensing: ignored
check('3h clock messages go to the clock with their time stamp', JSON.stringify(clockLog) === JSON.stringify([[1, 1000], [0, 1010], [3, 1020], [2, 1030]]), JSON.stringify(clockLog));
midi.setClockSource('int');
send(dt, [0xf8], 1050);
check('3h on INT the clock is not forwarded', clockLog.length === 4);
const pcs = [];
midi.onProgram((n) => pcs.push(n));
send(dt, [0xc0, 3]);
send(dt, [0xc2, 4]); // IN R channel listens too
send(dt, [0xc7, 9]); // channel 8: not listened to
check('3i Program Change on the listened channels', JSON.stringify(pcs) === '[3,4]', JSON.stringify(pcs));
send(dt, [0x90, 60, 100]);
send(dt, [0x80, 60, 0]);
check('3i notes do nothing', pcs.length === 2);

// devices: hot-plug of an Elektron device with AUTO, unplug and back
midi.choose('iac');
check('3j choose another device', midi.deviceId === 'iac' && iac.onmidimessage !== null && dt.onmidimessage === null);
access.inputs.set('st', { id: 'st', name: 'Syntakt', manufacturer: 'Elektron', state: 'connected', onmidimessage: null });
access.onstatechange?.({});
check('3j AUTO: a plugged-in Elektron device takes over', midi.deviceId === 'st' && access.inputs.get('st').onmidimessage !== null && iac.onmidimessage === null, midi.deviceId);
access.inputs.get('st').state = 'disconnected';
access.onstatechange?.({});
check('3j unplugged: waiting for it', !midi.connected && midi.deviceId === 'st');
access.inputs.get('st').state = 'connected';
access.onstatechange?.({});
check('3j plugged back in: listened to again', midi.connected && access.inputs.get('st').onmidimessage !== null);
const blocked = new M.MidiService({ request: async () => access, allowed: false }, new PS.ParamStore());
check('3k embedded window without MIDI: blocked, not asked', blocked.status === 'blocked');
const none = new M.MidiService({ allowed: true }, new PS.ParamStore());
check('3k browser without Web MIDI: unsupported', none.status === 'unsupported');
const auto = new M.MidiService({ request: async () => access, permission: async () => 'granted', allowed: true, storage }, new PS.ParamStore());
await new Promise((r) => setTimeout(r, 10));
check('3k on again by itself when it was on and the browser still allows it', auto.status === 'on');

/* ---------- 4. Program Change order ---------- */
{
  const store = new ST.PresetStore(ST.memoryBackend());
  await store.ready;
  const snap = { format: 'da-resonator', version: 4, params: {}, routes: [], triggers: [], modules: {} };
  const b = await store.add('Zebra', 'Bass', snap, 3000);
  const a = await store.add('Alpha', 'Pads', snap, 1000);
  const c = await store.add('Mid', 'Bass', snap, 2000);
  const list = PR.programList(store);
  const nf = store.factory.length;
  check('4a factory presets first, in their order', nf === 12 && list.slice(0, nf).every((p, i) => p.id === store.factory[i].id));
  check('4a then user presets in the order they were saved', list[nf].id === a.id && list[nf + 1].id === c.id && list[nf + 2].id === b.id, list.slice(nf).map((p) => p.name).join(', '));
  const nums = PR.programNumbers(store);
  check('4a shown numbers start at 1', nums.get(store.factory[0].id) === 1 && nums.get(b.id) === nf + 3);
}

console.table(results);
