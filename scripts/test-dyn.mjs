// Offline tests for the band dynamics ("Dynamic EQ" on the 10 resonator bands, plan E7).
// Run: node scripts/test-dyn.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const S = importTs('src/shared/mod/sources.ts');
const M = importTs('src/shared/paramdefs/modules.ts');
const idx = (id) => P.paramIndex(id);
const NB = P.NUM_BANDS;
const FREQS = P.BAND_FREQS;
const SRC_DYN0 = S.SRC_DYN0;

/* ---------- helpers ---------- */
/** clean single-band setup: analog 0 (no detune, linear input stage), res 0.45 (makeup 0 dB), band b solo */
function soloSetup(b, dyn = {}) {
  const v = P.defaultValues();
  v[idx('analog')] = 0;
  for (let j = 0; j < NB; j++) {
    v[idx(`band${j}.gain`)] = j === b ? 0 : -60;
    v[idx(`band${j}.res`)] = 0.45;
  }
  return setDyn(v, dyn);
}
function setDyn(v, { on = 1, mode, thr, ratio, atk, rel, range, amt } = {}) {
  v[idx('dyn.on')] = on;
  if (mode !== undefined) v[idx('dyn.mode')] = mode;
  if (thr !== undefined) v[idx('dyn.threshold')] = thr;
  if (ratio !== undefined) v[idx('dyn.ratio')] = ratio;
  if (atk !== undefined) v[idx('dyn.attack')] = atk;
  if (rel !== undefined) v[idx('dyn.release')] = rel;
  if (range !== undefined) v[idx('dyn.range')] = range;
  if (amt) for (const [b, a] of Object.entries(amt)) v[idx(`band${b}.dyn`)] = a;
  return v;
}
const send = (proc, values) => proc.port.onmessage({ data: { type: 'params', values } });
function render(values, seconds, input, onBlock) {
  const proc = loadProcessor();
  send(proc, values);
  const out = run(proc, Math.round((seconds * FS) / BLOCK), input, onBlock ? (k) => onBlock(proc, k) : undefined);
  return { ...out, proc };
}
const sine = (f, amp) => (n) => amp * Math.sin((2 * Math.PI * f * n) / FS);
const dbOf = (a) => 20 * Math.log10(a);
const peak = (x, a = 0, b = x.length) => {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
};
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const allFinite = (...xs) => xs.every((x) => x.every(Number.isFinite));
const f1 = (x) => x.toFixed(1);
let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function fftMag(sig, size) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < Math.min(size, sig.length); i++) re[i] = sig[i];
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < size; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
function peakFreq(sig, size = 1 << 18, fmin = 10) {
  const mag = fftMag(sig, size);
  let best = Math.ceil((fmin * size) / FS);
  for (let i = best; i < mag.length - 1; i++) if (mag[i] > mag[best]) best = i;
  const a = Math.log(mag[best - 1] + 1e-30), b = Math.log(mag[best] + 1e-30), c = Math.log(mag[best + 1] + 1e-30);
  const p = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return ((best + p) * FS) / size;
}
/** per-window peak envelope */
function envelope(x, win) {
  const e = [];
  for (let i = 0; i + win <= x.length; i += win) e.push(peak(x, i, i + win));
  return e;
}

/* ---------- 1. static compression curve: ratio 4, threshold -20 dB ---------- */
{
  const b = 4, T = -20, R = 4;
  const rows = [];
  let ok = true;
  for (const inDb of [-30, -16, -12, -8, -4]) {
    const input = sine(FREQS[b], 10 ** (inDb / 20));
    const off = render(soloSetup(b, { on: 0 }), 1, input);
    const on = render(soloSetup(b, { thr: T, ratio: R }), 1, input);
    const a = 0.6 * FS;
    const L = dbOf(peak(off.L, a)); // band level at the dynamics stage (makeup and fader are 0 dB)
    const got = dbOf(peak(on.L, a));
    const want = L > T ? T + (L - T) / R : L;
    const pass = Math.abs(got - want) <= 0.5;
    ok &&= pass;
    rows.push({ 'in dB': inDb, 'band level dB': L.toFixed(2), 'out dB': got.toFixed(2), 'theory dB': want.toFixed(2), 'err dB': (got - want).toFixed(2), ok: pass });
  }
  console.log('\n1. Static curve, band 5 (411 Hz), ratio 4:1, threshold -20 dB');
  console.table(rows);
  check('1 compression curve ±0.5 dB (4:1 @ -20 dB)', ok, rows.map((r) => `${r['band level dB']}→${r['out dB']}`).join(' '));
}

/* ---------- 2. modes BALANCE (cut above, boost below, gate) and BOOST (level correction) ---------- */
{
  const b = 6, T = -20, R = 4, range = 12;
  const rows = [];
  let ok = true;
  // −10: cut · −30: boost 7.5 · −40: boost capped at range · −52: gate fade-in · −64: under the gate
  for (const inDb of [-10, -30, -40, -52, -64]) {
    const input = sine(FREQS[b], 10 ** (inDb / 20));
    const off = render(soloSetup(b, { on: 0 }), 1, input);
    const on = render(soloSetup(b, { mode: M.DYN_BALANCE, thr: T, ratio: R, range }), 1, input);
    const a = 0.6 * FS;
    const L = dbOf(peak(off.L, a));
    const got = dbOf(peak(on.L, a));
    const want = L - M.dynGainChange(L - T, 1 - 1 / R, range, M.DYN_BALANCE);
    const pass = Math.abs(got - want) <= 0.5;
    ok &&= pass;
    rows.push({ 'band level dB': L.toFixed(2), 'out dB': got.toFixed(2), 'theory dB': want.toFixed(2), 'change dB': (got - L).toFixed(2), ok: pass });
  }
  console.log('\n2a. BALANCE, band 7 (1.5 kHz), ratio 4:1, threshold -20 dB, range 12 dB, gate 40 dB under');
  console.table(rows);
  check('2a BALANCE curve: cut above, boost below, range, gate', ok, rows.map((r) => `${r['band level dB']}→${r['change dB']}`).join(' '));

  // noise, the bands mostly under the threshold: BALANCE lifts the output, BOOST corrects the level back
  const v0 = () => {
    const v = P.defaultValues();
    v[idx('analog')] = 0;
    return v;
  };
  seed = 99;
  const noise = () => rnd() * 0.05;
  const lvl = (dyn) => {
    seed = 99;
    const r = render(setDyn(v0(), dyn), 2, noise);
    return dbOf(rms(r.L, 1.2 * FS));
  };
  const dOff = lvl({ on: 0 });
  const dBal = lvl({ mode: M.DYN_BALANCE, thr: -12, ratio: 20, range: 12 }) - dOff;
  const dBoost = lvl({ mode: M.DYN_BOOST, thr: -12, ratio: 20, range: 12 }) - dOff;
  const dCut = lvl({ mode: M.DYN_CUT, thr: 0, ratio: 20, range: 12 }) - dOff;
  check(
    '2b BOOST level correction (BALANCE without)',
    dBal > 3 && Math.abs(dBoost) < 1 && Math.abs(dCut) < 0.01,
    `vs off: BALANCE ${f1(dBal)} dB, BOOST ${dBoost.toFixed(2)} dB, CUT ${dCut.toFixed(3)} dB (noise, bands under the threshold)`,
  );
  // two tones: the loud band stays, the quiet one comes up (the correction follows the power, so it is small)
  {
    const bl = 3, bq = 7;
    const two = (n) => 10 ** (-10 / 20) * Math.sin((2 * Math.PI * FREQS[bl] * n) / FS) + 10 ** (-40 / 20) * Math.sin((2 * Math.PI * FREQS[bq] * n) / FS);
    const setup = (dyn) => {
      const v = soloSetup(bl, dyn);
      v[idx(`band${bq}.gain`)] = 0;
      return v;
    };
    const tone = (x, f, a) => {
      let re = 0, im = 0;
      for (let i = a; i < x.length; i++) {
        re += x[i] * Math.cos((2 * Math.PI * f * i) / FS);
        im += x[i] * Math.sin((2 * Math.PI * f * i) / FS);
      }
      return dbOf((2 * Math.hypot(re, im)) / (x.length - a));
    };
    const off = render(setup({ on: 0 }), 1.2, two), on = render(setup({ mode: M.DYN_BOOST, thr: -20, ratio: 4, range: 12 }), 1.2, two);
    const a = 0.7 * FS;
    const dLoud = tone(on.L, FREQS[bl], a) - tone(off.L, FREQS[bl], a);
    const dQuiet = tone(on.L, FREQS[bq], a) - tone(off.L, FREQS[bq], a);
    check('2c BOOST lifts the quiet band, the loud one stays', Math.abs(dLoud) < 0.5 && dQuiet > 8, `loud band ${dLoud.toFixed(2)} dB, quiet band +${f1(dQuiet)} dB (≤ 12: its detector also hears the loud tone)`);
  }
}

/* ---------- 3. attack / release times ---------- */
{
  const b = 6, atk = 20, rel = 200, T = -30;
  const lo = 10 ** (-40 / 20), hi = 10 ** (-10 / 20);
  const t1 = 0.5 * FS, t2 = 1.0 * FS;
  const input = (n) => (n < t1 || n >= t2 ? lo : hi) * Math.sin((2 * Math.PI * FREQS[b] * n) / FS);
  const off = render(soloSetup(b, { on: 0 }), 2, input);
  const on = render(soloSetup(b, { thr: T, ratio: 4, atk, rel }), 2, input);
  const win = 96; // 2 ms windows
  const eOff = envelope(off.L, win), eOn = envelope(on.L, win);
  const gr = eOff.map((v, i) => dbOf(v / eOn[i]));
  const w1 = t1 / win, w2 = t2 / win;
  const grMax = gr[w2 - 1];
  let ta = -1, tr = -1;
  for (let i = w1; i < w2; i++) if (gr[i] >= 0.632 * grMax) { ta = ((i - w1 + 0.5) * win * 1000) / FS; break; }
  for (let i = w2; i < gr.length; i++) if (gr[i] <= 0.368 * grMax) { tr = ((i - w2 + 0.5) * win * 1000) / FS; break; }
  const pass = Math.abs(grMax - 15) < 0.6 && Math.abs(ta / atk - 1) < 0.3 && Math.abs(tr / rel - 1) < 0.3;
  check('3 attack / release times', pass, `GR ${f1(grMax)} dB (15 expected), attack 63 % after ${f1(ta)} ms (${atk}), release to 37 % after ${f1(tr)} ms (${rel})`);
}

/* ---------- 4. per-band amount 0 = untouched band ---------- */
{
  const b = 3;
  const input = () => rnd() * 0.5;
  seed = 99;
  const off = render(soloSetup(b, { on: 0 }), 0.8, input);
  seed = 99;
  const on = render(soloSetup(b, { thr: -50, ratio: 10, amt: { [b]: 0 } }), 0.8, input);
  let diff = 0;
  for (let i = 0; i < off.L.length; i++) diff = Math.max(diff, Math.abs(off.L[i] - on.L[i]), Math.abs(off.R[i] - on.R[i]));
  // same band with amount 1 must be compressed (sanity)
  seed = 99;
  const on1 = render(soloSetup(b, { thr: -50, ratio: 10 }), 0.8, input);
  const cut = dbOf(rms(off.L, 0.3 * FS) / rms(on1.L, 0.3 * FS));
  check('4 amount 0 leaves the band untouched', diff === 0 && cut > 6, `max |diff| ${diff.toExponential(1)} (amount 0), ${f1(cut)} dB less with amount 1`);
}

/* ---------- 5. self-oscillating band keeps its pitch, level controlled ---------- */
{
  const rows = [];
  let ok = true;
  for (const b of [1, 4, 8]) {
    const mk = (dyn) => {
      const v = soloSetup(b, dyn);
      v[idx(`band${b}.fb`)] = 1;
      return v;
    };
    const off = render(mk({ on: 0 }), 5, () => 0);
    const on = render(mk({ thr: -30, ratio: 8 }), 5, () => 0);
    const lastOff = off.L.subarray(4 * FS), lastOn = on.L.subarray(4 * FS);
    const fOff = peakFreq(lastOff), fOn = peakFreq(lastOn);
    const err = (fOn / FREQS[b] - 1) * 100;
    const aOff = dbOf(rms(lastOff) * Math.SQRT2), aOn = dbOf(rms(lastOn) * Math.SQRT2);
    const pass = allFinite(on.L, on.R) && Math.abs(err) < 0.5 && Math.abs(fOn / fOff - 1) < 0.005 && aOn < aOff - 6;
    ok &&= pass;
    rows.push({ band: b + 1, nominal: FREQS[b], 'osc off': fOff.toFixed(2), 'osc on': fOn.toFixed(2), 'err %': err.toFixed(3), 'amp off dB': f1(aOff), 'amp on dB': f1(aOn), ok: pass });
  }
  console.log('\n5. fb = 1 self-oscillation with dynamics (threshold -30 dB, 8:1)');
  console.table(rows);
  check('5 self-oscillation keeps pitch ±0.5 %', ok, rows.map((r) => `${r.nominal}:${r['err %']}%`).join(' '));
}

/* ---------- 6. Feedback All = 1 stays bounded with dynamics on ---------- */
{
  const mk = (dyn) => {
    const v = setDyn(P.defaultValues(), dyn);
    v[idx('fbAllOn')] = 1;
    v[idx('fbAll')] = 1;
    v[idx('fbAllTone')] = 20000;
    return v;
  };
  const burst = 0.2 * FS;
  const input = (n) => (n < burst ? rnd() * 0.5 : 0);
  const off = render(mk({ on: 0 }), 5.2, input);
  const on = render(mk({ thr: -24, ratio: 6 }), 5.2, input);
  const exp = render(mk({ mode: M.DYN_BALANCE, thr: -20, ratio: 20, range: 36 }), 5.2, input);
  const pk = Math.max(peak(on.L), peak(on.R), peak(exp.L), peak(exp.R));
  const tOff = dbOf(rms(off.L, 4.2 * FS)), tOn = dbOf(rms(on.L, 4.2 * FS)), tExp = dbOf(rms(exp.L, 4.2 * FS));
  check(
    '6 FB All = 1 bounded with dynamics',
    allFinite(on.L, on.R, exp.L, exp.R) && pk <= 1.05 && tOn < tOff,
    `peak ${pk.toFixed(3)}; tail RMS off ${f1(tOff)} / compressing ${f1(tOn)} / BALANCE ±36 dB ${f1(tExp)} dBFS`,
  );
}

/* ---------- 7. no clicks when toggling (worst case: 0.1 ms attack, 24 dB GR) ---------- */
{
  const v = setDyn(P.defaultValues(), { on: 0, thr: -40, ratio: 20, atk: 0.1, rel: 5, range: 24 });
  const at = [0.3, 0.6, 0.9].map((t) => Math.round((t * FS) / BLOCK) * BLOCK);
  const w = v.slice();
  const { L } = render(v, 1.2, sine(115, 0.5), (pr, k) => {
    const pos = (k + 1) * BLOCK;
    const i = at.indexOf(pos);
    if (i >= 0) {
      w[idx('dyn.on')] = i === 1 ? 0 : 1;
      send(pr, w.slice());
    }
  });
  const maxDiff = (a, b) => {
    let m = 0;
    for (let n = Math.max(1, a); n < Math.min(L.length, b); n++) m = Math.max(m, Math.abs(L[n] - L[n - 1]));
    return m;
  };
  const rows = [];
  let ok = true;
  for (const pos of at) {
    const trans = maxDiff(pos, pos + 0.03 * FS);
    const settled = Math.max(maxDiff(pos - 0.1 * FS, pos), maxDiff(pos + 0.15 * FS, pos + 0.25 * FS));
    const pass = trans <= settled * 1.5 + 0.005;
    ok &&= pass;
    rows.push({ at: (pos / FS).toFixed(2) + ' s', 'transition max|Δx|': trans.toFixed(4), 'settled max|Δx|': settled.toFixed(4), ok: pass });
  }
  const levels = [0.25, 0.5, 0.85, 1.1].map((t) => f1(dbOf(peak(L, Math.round(t * FS), Math.round((t + 0.05) * FS)))));
  console.log('\n7. dyn.on toggles on a 115 Hz sine (on / off / on)');
  console.table(rows);
  check('7 no clicks when toggling', ok && +levels[1] < +levels[0] - 10, `out levels off/on/off/on: ${levels.join(' / ')} dB`);
}

/* ---------- 8. GR → mod sources and meter frames ---------- */
{
  const b = 4;
  const input = sine(FREQS[b], 10 ** (-8 / 20));
  const v = soloSetup(b, { thr: -20, ratio: 4, range: 24 });
  const { proc } = render(v, 1, input);
  const mods = proc.port.sent.filter((m) => m.type === 'mod');
  const meters = proc.port.sent.filter((m) => m.type === 'meters');
  const lastMod = mods.at(-1).src;
  const lastMeter = meters.at(-1).dynGR;
  const grDb = lastMeter[b];
  const srcV = lastMod[SRC_DYN0 + b];
  const others = Math.max(...Array.from({ length: NB }, (_, j) => (j === b ? 0 : Math.abs(lastMod[SRC_DYN0 + j]))));
  // switched off: sources and meters drop to 0
  v[idx('dyn.on')] = 0;
  send(proc, v);
  run(proc, 40, input);
  const offSrc = Math.max(...Array.from({ length: NB }, (_, j) => proc.port.sent.filter((m) => m.type === 'mod').at(-1).src[SRC_DYN0 + j]));
  const offMeter = Math.max(...proc.port.sent.filter((m) => m.type === 'meters').at(-1).dynGR.map(Math.abs));
  const pass = Math.abs(grDb - 9) < 0.5 && Math.abs(srcV - grDb / 24) < 0.01 && others < 1e-6 && offSrc === 0 && offMeter === 0;
  check('8 GR in mod readouts + meter frames', pass, `meter GR ${grDb.toFixed(2)} dB (9 expected), src dyn${b + 1} ${srcV.toFixed(3)} (GR/range), other bands ${others}, after off: src ${offSrc}, meter ${offMeter}`);
}

/* ---------- 9. modulated threshold (LFO → dyn.threshold) moves the GR ---------- */
{
  const b = 4;
  const v = soloSetup(b, { thr: -20, ratio: 4, range: 24 });
  v[idx('lfo1.on')] = 1;
  v[idx('lfo1.rate')] = 2;
  v[idx('route0.depth')] = 0.25; // ±15 dB
  const proc = loadProcessor();
  send(proc, v);
  proc.port.onmessage({ data: { type: 'modConfig', config: { routes: [{ slot: 0, src: S.SOURCE_BY_ID.lfo1.index, dst: idx('dyn.threshold') }], triggers: [] } } });
  const { L } = run(proc, Math.round(FS / BLOCK), sine(FREQS[b], 10 ** (-8 / 20)));
  const srcs = proc.port.sent.filter((m) => m.type === 'mod').slice(10).map((m) => m.src[SRC_DYN0 + b]);
  const lo = Math.min(...srcs), hi = Math.max(...srcs);
  // zipper check: no sample-to-sample jumps beyond the sine's own slope
  let jump = 0;
  for (let n = 1; n < L.length; n++) jump = Math.max(jump, Math.abs(L[n] - L[n - 1]));
  const slope = 2 * Math.PI * FREQS[b] / FS * 10 ** (-8 / 20);
  check('9 LFO → dyn.threshold', hi - lo > 0.3 && jump < slope * 1.1, `GR/range swings ${lo.toFixed(2)}..${hi.toFixed(2)}, max |Δx| ${jump.toFixed(4)} (sine slope ${slope.toFixed(4)})`);
}

/* ---------- 10. performance (same load as dsp-test 8, dynamics on and working on every band) ---------- */
{
  const mk = (on) => {
    const v = setDyn(P.defaultValues(), { on, thr: -40, ratio: 4 });
    v[idx('fbAllOn')] = 1;
    v[idx('spread')] = 0.5;
    for (let b = 0; b < NB; b++) v[idx(`band${b}.fb`)] = 0.5;
    return v;
  };
  const iL = new Float32Array(BLOCK * 64), iR = new Float32Array(BLOCK * 64);
  for (let i = 0; i < iL.length; i++) { iL[i] = rnd() * 0.3; iR[i] = rnd() * 0.3; }
  const ins = [];
  for (let k = 0; k < 64; k++) ins.push([[iL.subarray(k * BLOCK, (k + 1) * BLOCK), iR.subarray(k * BLOCK, (k + 1) * BLOCK)]]);
  const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  const blocks = Math.ceil((10 * FS) / BLOCK);
  const time = (on) => {
    const proc = loadProcessor();
    send(proc, mk(on));
    for (let k = 0; k < 400; k++) proc.process(ins[k & 63], outs);
    let ms = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      for (let k = 0; k < blocks; k++) proc.process(ins[k & 63], outs);
      ms = Math.min(ms, performance.now() - t0);
    }
    const gr = proc.port.sent.filter((m) => m.type === 'meters').at(-1).dynGR;
    return { ms, gr: Math.max(...gr) };
  };
  const off = time(0), on = time(1);
  const x = 10000 / on.ms;
  check('10 performance, dynamics on (10 s stereo)', x > 15 && on.gr > 3, `${on.ms.toFixed(0)} ms → ${x.toFixed(1)}x realtime (off: ${off.ms.toFixed(0)} ms, +${(((on.ms - off.ms) / off.ms) * 100).toFixed(0)} %), max band GR ${f1(on.gr)} dB`);
}

console.log('\nBand dynamics tests');
console.table(results);