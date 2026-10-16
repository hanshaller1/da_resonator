// Offline tests for the hardware modes, part 1 (docs/hardware-modi-und-pools-2026-10-16.md): the band filter
// (FILTER → BAND) at the band centres with locks and R OFS, the band scanner (CLK MOD → SCAN): order, rate,
// clock, locks, value, R DLY / R INV, and DYN EQ with the sources IN / OUT, the input filter, DELAY and R DLY.
// Run: node scripts/test-modes.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const BF = importTs('src/dsp/modules/bandFilter.ts');
const S = importTs('src/core/state.ts');
const idx = (id) => P.paramIndex(id);
const NB = P.NUM_BANDS;
const FREQS = P.BAND_FREQS;

const send = (proc, values) => proc.port.onmessage({ data: { type: 'params', values } });
const blocks = (s) => Math.round((s * FS) / BLOCK);
const base = () => {
  const v = P.defaultValues();
  v[idx('analog')] = 0;
  return v;
};
const set = (v, o) => {
  for (const [k, x] of Object.entries(o)) v[idx(k)] = x;
  return v;
};
/** settled linear gain of every slot (band·2 + channel) after `seconds` of silence */
function slotGains(v, seconds = 0.6) {
  const proc = loadProcessor({ linkR: false });
  send(proc, v);
  run(proc, blocks(seconds));
  return Float64Array.from(proc.bGainCur);
}
const dbOf = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/* ---------- 1. band filter ---------- */
{
  // off: settings without ON change nothing
  const off = slotGains(set(base(), { 'filterBand.cutoff': 200, 'filterBand.type': 2, 'filterBand.depth': 30 }));
  const ref = slotGains(base());
  check('1a band filter off: band gains untouched', off.every((g, i) => g === ref[i]));

  // LP 1 kHz, 24 dB/oct, depth 60 (mute): every band at the curve value at its centre
  const lp = { 'filterBand.on': 1, 'filterBand.type': 0, 'filterBand.cutoff': 1000, 'filterBand.slope': 24, 'filterBand.depth': 60 };
  const g = slotGains(set(base(), lp));
  let worst = 0;
  const rows = [];
  for (let b = 0; b < NB; b++) {
    const want = BF.bandFilterDb(0, 1000, 24, 2, 60, 0, FREQS[b]);
    const got = dbOf(g[b * 2]);
    const err = want === -Infinity ? (got === -Infinity ? 0 : 99) : Math.abs(got - want);
    worst = Math.max(worst, err);
    rows.push(`${FREQS[b]}:${want === -Infinity ? '−∞' : want.toFixed(1)}`);
  }
  check('1b LP 1 kHz 24 dB/oct: each band at the curve at its centre', worst < 0.05, rows.join(' '));
  check('1c LP: band 1 (29 Hz) at 0 dB, 11 kHz silent', Math.abs(dbOf(g[0])) < 0.01 && g[18] === 0);

  // the curve itself: −3 dB at the cutoff, 24 dB per octave above it
  const at = (f) => BF.bandFilterDb(0, 1000, 24, 2, 60, 0, f);
  check('1d curve: −3 dB at the cutoff, ≈ −24 dB one octave up', Math.abs(at(1000) + 3.01) < 0.05 && Math.abs(at(2000) + 24.1) < 0.2, `${at(1000).toFixed(2)} / ${at(2000).toFixed(1)} dB`);
  const bp = (f) => BF.bandFilterDb(1, 400, 24, 2, 60, 0, f);
  check('1e BP 400 Hz width 2 oct: 0 dB at the centre, edges −3 dB', Math.abs(bp(400)) < 0.01 && Math.abs(bp(800) + 3) < 0.3, `${bp(800).toFixed(2)} dB at 800 Hz`);
  const notch = BF.bandFilterDb(3, 411, 24, 1, 24, 0, 411);
  check('1f Notch: the centre reaches the DEPTH floor', Math.abs(notch + 24) < 1e-9, `${notch} dB`);

  // offset and depth: a 6 dB floor and a +3 dB passband
  const g2 = slotGains(set(base(), { ...lp, 'filterBand.depth': 6, 'filterBand.offset': 3 }));
  check('1g DEPTH 6 dB / OFFSET +3 dB: passband +3, the cut stops at −3', Math.abs(dbOf(g2[0]) - 3) < 0.01 && Math.abs(dbOf(g2[18]) + 3) < 0.01);

  // locks: band 9 (5.2 kHz) locked keeps its fader level
  const g3 = slotGains(set(base(), { ...lp, 'filterBand.lock8': 1, 'band8.gain': -6, 'band8.gainR': -6 }));
  check('1h locked band keeps its fader (−6 dB), the others follow the curve', Math.abs(dbOf(g3[16]) + 6) < 0.01 && g3[18] === 0);

  // R OFS: R reads the curve one octave higher
  const g4 = slotGains(set(base(), { ...lp, 'filterBand.rofs': 1 }));
  const r7 = dbOf(g4[7 * 2 + 1]);
  const want7 = BF.bandFilterDb(0, 2000, 24, 2, 60, 0, FREQS[7]);
  check('1i R OFS +1 oct: R at the curve of 2 kHz, L at 1 kHz', Math.abs(r7 - want7) < 0.05 && Math.abs(dbOf(g4[14]) - BF.bandFilterDb(0, 1000, 24, 2, 60, 0, FREQS[7])) < 0.05, `R ${r7.toFixed(1)} dB`);

  // audio: band 8 (2.8 kHz) solo, LP at 1 kHz: its output drops by the curve value
  const solo = (on) => {
    const v = set(base(), { ...lp, 'filterBand.on': on });
    for (let b = 0; b < NB; b++) if (b !== 7) set(v, { [`band${b}.gain`]: -60, [`band${b}.gainR`]: -60 });
    const proc = loadProcessor({ linkR: false });
    send(proc, v);
    let sd = 99;
    const o = run(proc, blocks(1), () => 0.1 * ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5));
    let e = 0;
    for (let i = blocks(0.3) * BLOCK; i < o.L.length; i++) e += o.L[i] * o.L[i];
    return e;
  };
  const drop = 10 * Math.log10(solo(1) / solo(0));
  const want = BF.bandFilterDb(0, 1000, 24, 2, 60, 0, FREQS[7]);
  check('1j audio: band 8 alone drops by the curve value', Math.abs(drop - want) < 0.2, `${drop.toFixed(2)} dB (curve ${want.toFixed(2)})`);
}

/* ---------- 2. band scanner ---------- */
/** steps (band written on L / R) per block over `seconds` */
function scanRun(o, seconds, onBlock) {
  const proc = loadProcessor({ linkR: false });
  send(proc, set(base(), { 'scan.on': 1, ...o }));
  const L = [];
  const R = [];
  run(proc, blocks(seconds), () => 0, (k) => {
    const s = proc.mod.scan;
    if (s.lastL !== L.at(-1)) L.push(s.lastL);
    if (s.lastR !== R.at(-1)) R.push(s.lastR);
    onBlock?.(proc, k);
  });
  return { proc, L, R };
}
/** count steps: every change of the last band (also repeats, via a step counter) */
function countSteps(o, seconds) {
  const proc = loadProcessor({ linkR: false });
  send(proc, set(base(), { 'scan.on': 1, ...o }));
  let n = 0;
  let last = -2;
  run(proc, blocks(seconds), () => 0, () => {
    const b = proc.mod.scan.lastL;
    if (b !== last) n++;
    last = b;
  });
  return n;
}
{
  const up = scanRun({ 'scan.rate': 20 }, 0.7);
  check('2a UP: bands 1 → 10, then round again', up.L.slice(0, 12).join(',') === '0,1,2,3,4,5,6,7,8,9,0,1', up.L.slice(0, 12).join(','));
  const down = scanRun({ 'scan.rate': 20, 'scan.dir': 1 }, 0.7);
  check('2b DOWN: bands 10 → 1', down.L.slice(0, 11).join(',') === '9,8,7,6,5,4,3,2,1,0,9', down.L.slice(0, 11).join(','));
  const pp = scanRun({ 'scan.rate': 40, 'scan.dir': 2 }, 0.6);
  check('2c PING-PONG: up and back without repeating the ends', pp.L.slice(0, 20).join(',') === '0,1,2,3,4,5,6,7,8,9,8,7,6,5,4,3,2,1,0,1', pp.L.slice(0, 20).join(','));
  const lk = scanRun({ 'scan.rate': 40, 'scan.lock2': 1, 'scan.lock3': 1 }, 0.6);
  check('2d locked bands 3 and 4 are stepped past and stay at 0 dB', !lk.L.includes(2) && !lk.L.includes(3) && lk.L.slice(0, 3).join(',') === '0,1,4' && lk.proc.mod.scan.layerDb[4] === 0 && lk.proc.mod.scan.layerDb[7] === 0);

  // rate: RATE runs free; 20 steps / s over 2 s (+ the first step at the start)
  const n = countSteps({ 'scan.rate': 20 }, 2);
  check('2e RATE 20 / s: 40 steps in 2 s', Math.abs(n - 41) <= 1, `${n} steps`);
  const fast = countSteps({ 'scan.rate': 160 }, 1);
  check('2f RATE 160 / s (≈ 10 000 BPM): 160 steps in 1 s', Math.abs(fast - 161) <= 1, `${fast} steps`);
  // INT clock, 120 BPM, 1/16 → 8 steps / s
  const sync = countSteps({ 'scan.sync': 1, 'scan.div': 4, 'clock.bpm': 120 }, 2);
  check('2g INT 120 BPM 1/16: 8 steps / s', Math.abs(sync - 17) <= 1, `${sync} steps in 2 s`);
  const stopped = countSteps({ 'scan.sync': 1, 'clock.run': 0 }, 1);
  check('2h stopped clock: only the first step', stopped === 1, `${stopped}`);

  // value: macro 1 at 25 % (unipolar) → u 0.25 → OFFSET − DEPTH · 0.75
  const mv = scanRun({ 'scan.rate': 40, 'scan.src': 11, 'macro1.value': 0.25, 'scan.depth': 24, 'scan.offset': -2 }, 0.4);
  const ly = mv.proc.mod.scan.layerDb;
  check('2i macro 25 %: every band at OFFSET − DEPTH · 0.75 (−20 dB)', Math.abs(ly[0] + 20) < 1e-9 && Math.abs(ly[18] + 20) < 1e-9, `${ly[0]} dB`);
  const g = mv.proc.bGainCur;
  check('2j the layer adds to the fader: band gain at −20 dB', Math.abs(dbOf(g[0]) + 20) < 0.05, `${dbOf(g[0]).toFixed(2)} dB`);

  // own LFO: square at 1.05 Hz, 20 steps / s: the first 10 steps high (0 dB), the next 10 low (−DEPTH)
  const sq = scanRun({ 'scan.rate': 20, 'scan.shape': 1, 'scan.lfo': 1.05, 'scan.depth': 24 }, 0.98);
  const lyq = sq.proc.mod.scan.layerDb;
  const low = [];
  for (let b = 0; b < NB; b++) low.push(lyq[b * 2].toFixed(0));
  check('2k own LFO square: 10 steps high, the next 10 low', low.join(',') === '-24,-24,-24,-24,-24,-24,-24,-24,-24,-24', low.join(','));

  // R DLY 3 and R INV
  const rd = scanRun({ 'scan.rate': 40, 'scan.rdly': 3 }, 0.5);
  check('2l R DLY 3: R waits three steps, then writes the band L wrote three steps before', rd.R.filter((b) => b >= 0).slice(0, 5).join(',') === '0,1,2,3,4' && rd.R[0] === -1 && rd.L.slice(0, 8).join(',') === '0,1,2,3,4,5,6,7');
  const ri = scanRun({ 'scan.rate': 40, 'scan.src': 11, 'macro1.value': 0.25, 'scan.rinv': 1 }, 0.4);
  const u = ri.proc.mod.scan.u;
  check('2m R INV: R gets 1 − u', Math.abs(u[0] - 0.25) < 1e-9 && Math.abs(u[1] - 0.75) < 1e-9);

  // audio: a running scanner on noise stays finite and moves the band gains without clicks (glide)
  let jump = 0;
  let prev = null;
  let sd = 5;
  const proc = loadProcessor({ linkR: false });
  send(proc, set(base(), { 'scan.on': 1, 'scan.rate': 160, 'scan.shape': 1, 'scan.lfo': 7, 'scan.depth': 48 }));
  const o = run(proc, blocks(1), () => 0.1 * ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5), () => {
    const gnow = Float64Array.from(proc.bGainCur);
    if (prev) for (let i = 0; i < gnow.length; i++) jump = Math.max(jump, Math.abs(gnow[i] - prev[i]));
    prev = gnow;
  });
  check('2n RATE 160, square, depth 48: finite, a gain moves < 0.7 per block (3 ms glide)', o.L.every(Number.isFinite) && o.R.every(Number.isFinite) && jump < 0.7 && jump > 0.05, `largest change per block ${jump.toFixed(3)}`);

  // off again: the layer goes back to the bare faders
  const back = loadProcessor({ linkR: false });
  const v = set(base(), { 'scan.on': 1, 'scan.rate': 40, 'scan.src': 11, 'macro1.value': 0 });
  send(back, v);
  run(back, blocks(0.4));
  send(back, set(v, { 'scan.on': 0 }));
  run(back, blocks(0.3));
  check('2o switched off: band gains back to the faders', Array.from(back.bGainCur).every((x) => Math.abs(x - 1) < 1e-3));
}

/* ---------- 3. DYN EQ sources ---------- */
const sine = (f, amp, from = 0) => (n) => (n >= from * FS ? amp * Math.sin((2 * Math.PI * f * n) / FS) : 0);
/** dyn on, threshold −30, ratio 4, fast attack; the last meter frame's GR per band */
function dynRun(o, seconds, input, onBlock) {
  const proc = loadProcessor({ linkR: false });
  const v = set(base(), { 'dyn.on': 1, 'dyn.threshold': -30, 'dyn.ratio': 4, 'dyn.attack': 1, 'dyn.release': 50, 'dyn.range': 24, ...o });
  send(proc, v);
  const frames = [];
  let seen = null;
  run(proc, blocks(seconds), input, (k) => {
    const m = proc.port.sent.at(-1);
    if (m?.type === 'meters' && m !== seen) frames.push({ gr: (seen = m).dynGR, t: ((k + 1) * BLOCK) / FS });
    onBlock?.(proc, k);
  });
  return { proc, gr: proc.port.sent.filter((m) => m.type === 'meters').at(-1).dynGR, frames };
}
{
  // a −20 dB sine at band 5 (411 Hz): IN measures it there, 10 dB over the threshold → 7.5 dB at ratio 4
  const inp = dynRun({ 'dyn.source': 1 }, 0.6, sine(411, 0.1));
  check('3a IN: a −20 dB sine at band 5 → band 5 down 7.5 dB', Math.abs(inp.gr[4] - 7.5) < 0.3, `GR ${inp.gr[4].toFixed(2)} dB`);
  check('3b IN: bands far away untouched', inp.gr[0] === 0 && inp.gr[9] === 0 && inp.gr[7] < 0.05, Array.from(inp.gr, (x) => x.toFixed(1)).join(' '));

  // OUT measures the output: with band 5 muted there is nothing at 411 Hz to measure; IN still acts
  const mute = {};
  for (let b = 0; b < NB; b++) Object.assign(mute, { [`band${b}.gain`]: -60, [`band${b}.gainR`]: -60 });
  const outMuted = dynRun({ 'dyn.source': 2, ...mute }, 0.6, sine(411, 0.1));
  const inMuted = dynRun({ 'dyn.source': 1, ...mute }, 0.6, sine(411, 0.1));
  const bandMuted = dynRun({ 'dyn.source': 0, ...mute }, 0.6, sine(411, 0.1));
  check('3c all faders down: OUT sees nothing, IN and BAND still act', outMuted.gr[4] < 0.05 && inMuted.gr[4] > 7 && bandMuted.gr[4] > 2, `OUT ${outMuted.gr[4].toFixed(2)}, IN ${inMuted.gr[4].toFixed(2)}, BAND ${bandMuted.gr[4].toFixed(2)} dB`);
  const outOpen = dynRun({ 'dyn.source': 2 }, 0.6, sine(411, 0.1));
  check('3d OUT with the faders open: band 5 acts on the output', outOpen.gr[4] > 2, `GR ${outOpen.gr[4].toFixed(2)} dB`);

  // input filter: BP at 2.8 kHz keeps the 411 Hz sine out of the analysis
  const flt = dynRun({ 'dyn.source': 1, 'dyn.filter': 1, 'dyn.filterFreq': 2800 }, 0.6, sine(411, 0.1));
  check('3e IN with input filter BP 2.8 kHz: the 411 Hz sine no longer acts', flt.gr[4] < 0.05, `GR ${flt.gr[4].toFixed(2)} dB`);

  // DELAY 500 ms: the sine starts at 0.2 s, the change comes about 0.5 s later
  const onset = (frames, b, thr) => frames.find((f) => f.gr[b] > thr)?.t ?? Infinity;
  const d0 = dynRun({ 'dyn.source': 1 }, 1.2, sine(411, 0.1, 0.2));
  const d5 = dynRun({ 'dyn.source': 1, 'dyn.delay': 500 }, 1.2, sine(411, 0.1, 0.2));
  const t0 = onset(d0.frames, 4, 3);
  const t5 = onset(d5.frames, 4, 3);
  check('3f DELAY 500 ms: the change comes 0.5 s later', Math.abs(t5 - t0 - 0.5) < 0.05, `${t0.toFixed(3)} s → ${t5.toFixed(3)} s`);

  // R DLY 300 ms: 0.35 s after the L change R is still open, later it follows
  let mid = null;
  let end = null;
  dynRun({ 'dyn.source': 1, 'dyn.rdly': 300 }, 1.2, sine(411, 0.1, 0.2), (proc, k) => {
    if (k === blocks(0.45)) mid = [proc.dG[4], proc.dGR[4]];
    end = [proc.dG[4], proc.dGR[4]];
  });
  check('3g R DLY 300 ms: R follows L 0.3 s later', mid[0] < 0.5 && mid[1] === 1 && Math.abs(end[0] - end[1]) < 1e-6, `at 0.45 s L ${mid[0].toFixed(3)} R ${mid[1].toFixed(3)}`);

  // BAND with delay 0 is the dynamics as before: L and R gains are the same
  let same = true;
  dynRun({}, 0.5, sine(411, 0.1), (proc) => {
    for (let b = 0; b < NB; b++) if (proc.dG[b] !== proc.dGR[b]) same = false;
  });
  check('3h BAND, no delay: one gain per band as before (L = R)', same);
}

/* ---------- 4. presets ---------- */
{
  const old = { format: 'da-resonator', version: 5, params: { 'band0.gain': -3 }, routes: [] };
  const s = S.migrateSnapshot(old);
  check('4a v5 preset: modes off, scanner and band filter neutral, DYN source BAND', s.version === 6 && s.params['filterBand.on'] === 0 && s.params['scan.on'] === 0 && s.params['dyn.source'] === 0 && s.params['dyn.delay'] === 0);
}

console.table(results);
