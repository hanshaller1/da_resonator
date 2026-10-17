// Offline tests for the FB function keys (2026-10-17): WOB (hold a band: it wobbles ±10 % of fader travel,
// one sine per beat of the master clock) in the worklet, and DICE (all band levels at random, ui/channel.ts).
// Run: node scripts/test-fbkeys.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const C = importTs('src/ui/channel.ts');
const idx = (id) => P.paramIndex(id);
const dbOf = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;

/** a processor with these params; wob(band, on, ch) posts the key; gains() reads every slot's gain target in dB */
function setup(set = {}) {
  const proc = loadProcessor({ linkR: false });
  const v = P.defaultValues();
  for (const [k, x] of Object.entries(set)) v[idx(k)] = x;
  proc.port.onmessage({ data: { type: 'params', values: v } });
  const wob = (band, on, ch = 0) => proc.port.onmessage({ data: { type: 'wobble', band, on, ch } });
  const gains = () => Array.from(proc.bGainTgt, dbOf);
  /** run `sec` seconds, collecting slot i's gain target (dB) and the clock's beat position after every block */
  const trace = (sec, i) => {
    const g = [], beats = [];
    run(proc, Math.round((sec * FS) / BLOCK), () => 0, () => {
      g.push(dbOf(proc.bGainTgt[i]));
      beats.push(proc.mod.masterClock.beats);
    });
    return { g, beats };
  };
  return { proc, wob, gains, trace };
}
const max = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
const min = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);
/** blocks between the first two maxima of a trace */
const period = (a) => {
  const peaks = [];
  for (let k = 1; k < a.length - 1; k++) if (a[k] >= a[k - 1] && a[k] > a[k + 1]) peaks.push(k);
  return peaks.length > 2 ? (peaks.at(-1) - peaks[0]) / (peaks.length - 1) : NaN;
};
const blocksPerBeat = (bpm) => (60 / bpm) * (FS / BLOCK);

/* ---------- 1. WOB on a band at 0 dB: ±10 % of fader travel, one sine per beat ---------- */
{
  const { wob, gains, trace } = setup({ 'clock.bpm': 120 });
  wob(4, true);
  const t = trace(2, 8).g.slice(Math.round((0.1 * FS) / BLOCK));
  const hi = P.faderNormToDb(0.6), lo = P.faderNormToDb(0.4);
  const others = gains().every((g, i) => i === 8 || i === 9 || g === 0);
  check(
    '1 band 5 at 0 dB swings between the +10 % and −10 % fader marks, once per beat at 120 BPM',
    near(max(t), hi, 0.1) && near(min(t), lo, 0.1) && near(period(t), blocksPerBeat(120), 1.5) && others,
    `${min(t).toFixed(2)} … +${max(t).toFixed(2)} dB (marks ${lo} / +${hi.toFixed(1)}), period ${period(t).toFixed(1)} blocks (${blocksPerBeat(120).toFixed(1)} per beat), other bands at 0 dB: ${others}`,
  );
}

/* ---------- 2. in phase with the clock's beats; at its TEMPO while it stands ---------- */
{
  const { wob, trace } = setup({ 'clock.bpm': 90, 'band2.gain': -12, 'band2.gainR': -12 });
  wob(2, true);
  const t = trace(3, 4);
  // after the fade-in: on every beat (sin = 0) the band sits at its fader
  let worst = 0;
  for (let k = 20; k < t.g.length; k++) {
    if (Math.floor(t.beats[k]) !== Math.floor(t.beats[k - 1])) {
      const frac = t.beats[k] - Math.floor(t.beats[k]);
      const expect = P.faderNormToDb(P.faderDbToNorm(-12) + 0.1 * Math.sin(2 * Math.PI * frac));
      worst = Math.max(worst, Math.abs(t.g[k] - expect));
    }
  }
  const stopped = setup({ 'clock.bpm': 90, 'clock.run': 0 });
  stopped.wob(2, true);
  const s = stopped.trace(3, 4).g.slice(20);
  check(
    '2 in phase with the beats; with the clock stopped it still swings at its tempo',
    worst < 0.01 && near(period(s), blocksPerBeat(90), 1.5) && max(s) - min(s) > 5,
    `deviation on the beats ${worst.toFixed(4)} dB; stopped clock: period ${period(s).toFixed(1)} blocks (${blocksPerBeat(90).toFixed(1)} per beat)`,
  );
}

/* ---------- 3. fade in, release back to the fader, channels ---------- */
{
  const { proc, wob, gains, trace } = setup({ 'clock.bpm': 120, 'clock.run': 0 });
  // a quarter beat in (sin near its peak), then press: the first block moves only a little
  run(proc, Math.round(blocksPerBeat(120) / 4));
  wob(6, true);
  run(proc, 1);
  const first = Math.abs(gains()[12]);
  run(proc, 20);
  wob(6, false);
  run(proc, Math.ceil((0.04 * FS) / BLOCK));
  const back = gains().every((g) => g === 0) && proc.lyrLive === false && proc.wobOn === false;
  // L only: R stays at its fader
  const lOnly = setup({ 'clock.bpm': 120 });
  lOnly.wob(7, true, 1);
  const tl = lOnly.trace(1, 14).g, tr = lOnly.trace(1, 15).g;
  // a release lets go of both channels, whatever the switch says now
  lOnly.wob(7, false, 2);
  run(lOnly.proc, 20);
  const relAll = lOnly.gains().every((g) => g === 0);
  check(
    '3 fades in (no step), back at the fader 40 ms after release; L only leaves R alone; release frees both',
    first < 0.5 && back && max(tl) - min(tl) > 5 && tr.every((g) => g === 0) && relAll,
    `first block ${first.toFixed(2)} dB, after release all at 0 dB: ${back}, L swing ${(max(tl) - min(tl)).toFixed(1)} dB, R still: ${tr.every((g) => g === 0)}`,
  );
  // reset (PANIC) lets go too
  const p = setup();
  p.wob(1, true);
  run(p.proc, 10);
  p.proc.port.onmessage({ data: { type: 'reset' } });
  run(p.proc, 2);
  check('3b reset (PANIC) stops a held wobble', p.gains().every((g) => g === 0));
}

/* ---------- 4. the audio follows: a muted band comes up while held ---------- */
{
  const mute = {};
  for (let b = 0; b < 10; b++) {
    mute[`band${b}.gain`] = -60;
    mute[`band${b}.gainR`] = -60;
  }
  const { proc, wob } = setup({ ...mute, analog: 0, 'clock.bpm': 120 });
  let seed = 3;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.2;
  const quiet = run(proc, 100, noise);
  wob(4, true);
  const held = run(proc, Math.round(FS / BLOCK), noise);
  const ms = (x) => x.reduce((a, y) => a + y * y, 0) / x.length;
  check('4 a muted band sounds while its key is held (up to the +10 % mark: −40 dB)', ms(quiet.L) < 1e-20 && ms(held.L) > 1e-12, `before ${ms(quiet.L)}, held ${dbOf(Math.sqrt(ms(held.L))).toFixed(1)} dB RMS`);
}

/* ---------- 5. DICE ---------- */
{
  const store = () => {
    const v = {};
    let gestures = 0;
    return {
      v,
      get: (id) => (id in v ? v[id] : P.PARAM_BY_ID[id].def),
      set: (id, x) => (v[id] = x),
      spec: (id) => P.PARAM_BY_ID[id],
      getNorm: (id) => P.toNorm(P.PARAM_BY_ID[id], id in v ? v[id] : P.PARAM_BY_ID[id].def),
      beginGesture: () => gestures++,
      endGesture: () => {},
      gestures: () => gestures,
    };
  };
  let seed = 11;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const lr = store();
  C.rollLevels(lr, 'LR', rnd);
  const L = Array.from({ length: 10 }, (_, b) => lr.v[`band${b}.gain`]);
  const R = Array.from({ length: 10 }, (_, b) => lr.v[`band${b}.gainR`]);
  const inRange = L.every((x) => x >= C.DICE_MIN_DB && x <= C.DICE_MAX_DB);
  const differ = new Set(L).size > 5;
  check('5a DICE L+R: all 10 bands, the same in L and R, within −24 … +6 dB, one undo step', inRange && differ && L.every((x, b) => x === R[b]) && lr.gestures() === 20, L.map((x) => x.toFixed(1)).join(' '));
  const l = store();
  C.rollLevels(l, 'L', rnd);
  const onlyL = Object.keys(l.v).length === 10 && Object.keys(l.v).every((id) => /^band\d\.gain$/.test(id));
  const ends = store();
  C.rollLevels(ends, 'R', () => 0);
  const top = store();
  C.rollLevels(top, 'LR', () => 0.999999);
  check(
    '5b DICE L only touches L; the ends of the range are −24 and +6 dB',
    onlyL && ends.v['band0.gainR'] === -24 && !('band0.gain' in ends.v) && near(top.v['band9.gain'], 6, 0.051),
    `L only: ${onlyL}, low end ${ends.v['band0.gainR']} dB, high end ${top.v['band9.gain']} dB`,
  );
}

console.log('\nFB function key tests');
console.table(results);
