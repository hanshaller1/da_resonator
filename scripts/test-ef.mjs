// Offline tests for the envelope followers (src/dsp/modules/ef.ts): time constants, mapping, gain,
// band taps, gate trigger, NaN safety, cost. Run: node scripts/test-ef.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const S = importTs('src/shared/mod/sources.ts');
const M = importTs('src/shared/paramdefs/modules.ts');
const { EnvFollowerDsp } = importTs('src/dsp/modules/ef.ts');

const idx = (id) => P.paramIndex(id);
const db = (x) => 20 * Math.log10(x);
const TAP = Object.fromEntries(M.EF_TAPS.map((t, i) => [t, i]));

/* ---------- direct: one follower with a hand-built block context ---------- */
function direct(params = {}, n = 1) {
  const eff = P.defaultValues();
  eff[idx('ef1.on')] = 1;
  for (const [k, v] of Object.entries(params)) eff[idx(`ef1.${k}`)] = typeof v === 'string' ? TAP[v] : v;
  const ctx = {
    fs: FS, n, dt: n / FS, eff,
    clock: { bpm: 120, running: true, beats: 0, beatsPrev: 0 },
    taps: Array.from({ length: M.NUM_TAPS }, () => new Float32Array(BLOCK)),
    triggered: () => false,
    fires: 0,
    fire() { ctx.fires++; },
  };
  const ef = new EnvFollowerDsp(1);
  const tap = Math.round(eff[idx('ef1.tap')]);
  /** feed `len` samples of sig(i) block by block; returns update() after every block */
  const feed = (len, sig) => {
    const out = new Float64Array(Math.ceil(len / n));
    for (let k = 0, i = 0; i < len; k++, i += n) {
      for (let j = 0; j < n; j++) ctx.taps[tap][j] = sig(i + j);
      ef.analyse(ctx);
      out[k] = ef.update(ctx);
    }
    return out;
  };
  return { ef, ctx, feed };
}
/** output (thr -60, curve 0, level 1) → envelope in dB */
const outDb = (u) => -60 + 60 * u;

/* ---------- 1. attack / release time constants (63 % / 1/e), sample-exact feed ---------- */
{
  const A = 0.5;
  const rows = [];
  let ok = true;
  // fractional sample count where the envelope crosses `target` (linear interpolation)
  const crossing = (envs, target, rising) => {
    for (let k = 1; k < envs.length; k++) {
      const a = envs[k - 1], b = envs[k];
      if (rising ? b >= target : b <= target) return k - 1 + (target - a) / (b - a); // index + fraction
    }
    return NaN;
  };
  for (const atk of [0.1, 1, 10, 100, 500]) {
    const { feed } = direct({ attack: atk, release: 5000, threshold: -60 });
    const envs = Array.from(feed(Math.ceil(atk * 1e-3 * FS * 3) + 10, () => A), (u) => 10 ** (outDb(u) / 20));
    // envs[k] is the envelope after k+1 samples
    const ms = ((crossing(envs, A * (1 - Math.exp(-1)), true) + 1) / FS) * 1000;
    const err = ms / atk - 1;
    ok &&= Math.abs(err) < 0.1;
    rows.push({ stage: 'attack', set: `${atk} ms`, measured: `${ms.toFixed(3)} ms`, error: `${(err * 100).toFixed(2)} %` });
  }
  for (const rel of [5, 50, 500, 5000]) {
    const { feed } = direct({ attack: 0.1, release: rel, threshold: -60 });
    feed(0.05 * FS, () => A); // settle at A
    const envs = Array.from(feed(Math.ceil(rel * 1e-3 * FS * 1.5) + 10, () => 0), (u) => 10 ** (outDb(u) / 20));
    const ms = ((crossing(envs, A * Math.exp(-1), false) + 1) / FS) * 1000;
    const err = ms / rel - 1;
    ok &&= Math.abs(err) < 0.1;
    rows.push({ stage: 'release', set: `${rel} ms`, measured: `${ms.toFixed(2)} ms`, error: `${(err * 100).toFixed(2)} %` });
  }
  console.log('\n1. Time constants (step 0 → −6 dBFS → 0, 63 % / 37 % crossing)');
  console.table(rows);
  check('1 attack/release time constants ±10 %', ok, `${rows.length} settings, worst ${Math.max(...rows.map((r) => Math.abs(parseFloat(r.error)))).toFixed(2)} %`);
}

/* ---------- 2. same through the worklet: DC step on the input, tap In, mod readouts ---------- */
{
  const proc = loadProcessor();
  const v = P.defaultValues();
  v[idx('ef1.on')] = 1;
  v[idx('ef1.tap')] = TAP.In;
  v[idx('ef1.attack')] = 40;
  v[idx('ef1.release')] = 400;
  v[idx('ef1.threshold')] = -60;
  proc.port.onmessage({ data: { type: 'params', values: v } });
  const A = 0.5, S0 = 100 * BLOCK, S1 = 400 * BLOCK, END = 800 * BLOCK;
  const frames = []; // [samples processed before the update() that produced the value, value]
  let seen = 0;
  run(proc, END / BLOCK, (i) => (i >= S0 && i < S1 ? A : 0), (k) => {
    const sent = proc.port.sent;
    for (; seen < sent.length; seen++) if (sent[seen].type === 'mod') frames.push([k * BLOCK, sent[seen].src[S.SOURCE_BY_ID.ef1.index]]);
  });
  const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const atk = [], rel = [];
  for (const [t, u] of frames) {
    if (u <= 0) continue;
    const r = 10 ** (outDb(u) / 20) / A;
    if (t > S0 && t <= S1 && r > 0.15 && r < 0.9) atk.push((-(t - S0) / FS / Math.log(1 - r)) * 1000);
    if (t > S1 && r < 0.85 && r > 0.1) rel.push((-(t - S1) / FS / Math.log(r)) * 1000);
  }
  const ta = median(atk), tr = median(rel);
  check(
    '2 worklet step, tap In (attack 40 ms, release 400 ms)',
    Math.abs(ta / 40 - 1) < 0.1 && Math.abs(tr / 400 - 1) < 0.1 && atk.length > 3 && rel.length > 3,
    `τ attack ${ta.toFixed(1)} ms (${atk.length} readouts), τ release ${tr.toFixed(1)} ms (${rel.length} readouts)`,
  );
}

/* ---------- 3. threshold / curve / level mapping, 4. gain ---------- */
{
  const settle = (p, level) => {
    const { feed } = direct({ attack: 0.1, release: 5000, ...p });
    const out = feed(0.03 * FS, () => level);
    return out[out.length - 1];
  };
  const bend = (u, c) => (c === 0 ? u : (Math.exp(6 * c * u) - 1) / (Math.exp(6 * c) - 1));
  const cases = [
    // [label, params, input level, expected]
    ['-20 dB, thr -40, lin', { threshold: -40 }, 0.1, 0.5],
    ['-20 dB, thr -40, curve +1 (exp)', { threshold: -40, curve: 1 }, 0.1, bend(0.5, 1)],
    ['-20 dB, thr -40, curve -1 (log)', { threshold: -40, curve: -1 }, 0.1, bend(0.5, -1)],
    ['-20 dB, thr -40, curve +0.5, level 50 %', { threshold: -40, curve: 0.5, level: 0.5 }, 0.1, 0.5 * bend(0.5, 0.5)],
    ['-30 dB, thr -60', { threshold: -60 }, 10 ** (-30 / 20), 0.5],
    ['below threshold (-46 dB, thr -40)', { threshold: -40 }, 0.005, 0],
    ['at 0 dBFS', { threshold: -24 }, 1, 1],
    ['above 0 dBFS (-0.9 dB + 6 dB gain)', { threshold: -24, gain: 6 }, 0.9, 1],
    ['thr 0: just below 0 dBFS', { threshold: 0 }, 0.9, 0],
    ['thr 0: above 0 dBFS', { threshold: 0, gain: 6 }, 0.9, 1],
  ];
  const bad = [];
  for (const [label, p, lvl, want] of cases) {
    const got = settle(p, lvl);
    if (!(Math.abs(got - want) < 1e-4)) bad.push(`${label}: ${got.toFixed(4)} ≠ ${want.toFixed(4)}`);
  }
  // shape: curve -1 > 0 > +1 for every level inside the range, all monotonic in the level
  let shapeOk = true;
  for (const c of [-1, -0.3, 0, 0.3, 1]) {
    let prev = -1;
    for (let d = -45; d <= 0; d += 5) {
      const u = settle({ threshold: -40, curve: c }, 10 ** (d / 20));
      if (u < prev - 1e-9) shapeOk = false;
      prev = u;
    }
  }
  const mid = [-1, 0, 1].map((c) => settle({ threshold: -40, curve: c }, 10 ** (-30 / 20)));
  shapeOk &&= mid[0] > mid[1] && mid[1] > mid[2];
  check('3 threshold / curve / level mapping', bad.length === 0 && shapeOk, bad.length ? bad.join(' | ') : `${cases.length} cases exact, curve order log > lin > exp at -30 dB: ${mid.map((x) => x.toFixed(3)).join(' > ')}`);

  const g = [12, -12].map((gain) => outDb(settle({ threshold: -60, gain }, 0.1)));
  const gainOk = Math.abs(g[0] - -8) < 0.05 && Math.abs(g[1] - -32) < 0.05 && settle({ threshold: -60, gain: 24 }, 0.1) === 1;
  check('4 input gain', gainOk, `-20 dB in: +12 dB → ${g[0].toFixed(2)} dB, -12 dB → ${g[1].toFixed(2)} dB, +24 dB → clipped to 1`);
}

/* ---------- worklet helpers ---------- */
const send = (proc, values) => proc.port.onmessage({ data: { type: 'params', values } });
const modConfig = (proc, routes, triggers = []) =>
  proc.port.onmessage({
    data: {
      type: 'modConfig',
      config: { routes: routes.map(([slot, src, dst]) => ({ slot, src: S.SOURCE_BY_ID[src].index, dst: idx(dst) })), triggers },
    },
  });
const srcSeries = (proc, id) => proc.port.sent.filter((m) => m.type === 'mod').map((m) => m.src[S.SOURCE_BY_ID[id].index]);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/* ---------- 5. band taps follow only their band ---------- */
{
  const rows = [];
  let ok = true;
  const reading = (hz) => {
    const proc = loadProcessor();
    const v = P.defaultValues();
    for (const [n, tap] of [[1, 'Band 3'], [2, 'Band 8'], [3, 'In']]) {
      v[idx(`ef${n}.on`)] = 1;
      v[idx(`ef${n}.tap`)] = TAP[tap];
      v[idx(`ef${n}.attack`)] = 1;
      v[idx(`ef${n}.release`)] = 200;
      v[idx(`ef${n}.threshold`)] = -60;
    }
    v[idx('ef4.tap')] = TAP['Band 3']; // ef4 stays off: must read 0
    send(proc, v);
    run(proc, Math.round(FS / BLOCK), (i) => 0.25 * Math.sin((2 * Math.PI * hz * i) / FS));
    return ['ef1', 'ef2', 'ef3', 'ef4'].map((id) => avg(srcSeries(proc, id).slice(-20)));
  };
  const lo = reading(115), hi = reading(2800);
  const fmt = (u) => (u > 0 ? `${outDb(u).toFixed(1)} dB` : '< -60 dB');
  rows.push({ input: '115 Hz (band 3 centre)', 'EF1 Band 3': fmt(lo[0]), 'EF2 Band 8': fmt(lo[1]), 'EF3 In': fmt(lo[2]), 'EF4 off': lo[3] });
  rows.push({ input: '2.8 kHz (band 8 centre)', 'EF1 Band 3': fmt(hi[0]), 'EF2 Band 8': fmt(hi[1]), 'EF3 In': fmt(hi[2]), 'EF4 off': hi[3] });
  console.log('\n5. Band taps (sine -12 dBFS, threshold -60 dB)');
  console.table(rows);
  const sep1 = outDb(lo[0]) - outDb(lo[1]), sep2 = outDb(hi[1]) - outDb(hi[0]);
  ok = sep1 > 25 && sep2 > 25 && Math.abs(outDb(lo[2]) - -12) < 1 && Math.abs(outDb(hi[2]) - -12) < 1 && lo[3] === 0 && hi[3] === 0 && outDb(lo[0]) > -20 && outDb(hi[1]) > -20;
  check('5 band tap follows only its band', ok, `own band vs other band: ${sep1.toFixed(1)} dB / ${sep2.toFixed(1)} dB apart, In tap -12 dB, off slot 0`);
}

/* ---------- 6. gate: once per burst (ef1.gate → lfo1.reset), hysteresis ---------- */
{
  const proc = loadProcessor();
  const v = P.defaultValues();
  v[idx('ef1.on')] = 1;
  v[idx('ef1.tap')] = TAP.In;
  v[idx('ef1.attack')] = 1;
  v[idx('ef1.release')] = 15;
  v[idx('ef1.threshold')] = -30;
  v[idx('lfo1.on')] = 1;
  v[idx('lfo1.shape')] = 2; // saw: a reset shows as a drop to -1
  v[idx('lfo1.rate')] = 1;
  send(proc, v);
  modConfig(proc, [], [{ src: S.TRIGGER_OUT_BY_ID['ef1.gate'].index, dst: S.TRIGGER_IN_BY_ID['lfo1.reset'].index }]);
  // bursts every 0.6 s from 0.3 s: 4 loud ones (-6 dB), then one hovering at the threshold
  // (-29 dB ± 1.3 dB at 6 Hz: dips below -30 dB but never below the -33 dB re-arm level)
  const hover = 10 ** (-29 / 20);
  const sig = (i) => {
    const t = i / FS;
    const k = Math.floor((t - 0.3) / 0.6), inBurst = t >= 0.3 && k < 5 && t - 0.3 - k * 0.6 < 0.3;
    if (!inBurst) return 0;
    const amp = k < 4 ? 0.5 : hover * 10 ** ((1.3 * Math.sin(2 * Math.PI * 6 * t)) / 20);
    return amp * Math.sin((2 * Math.PI * 1000 * i) / FS);
  };
  run(proc, Math.round((3.2 * FS) / BLOCK), sig);
  const saw = srcSeries(proc, 'lfo1');
  let resets = 0;
  for (let k = 1; k < saw.length; k++) if (saw[k] < saw[k - 1] - 0.1) resets++;
  const efv = srcSeries(proc, 'ef1');
  check('6 gate fires once per burst', resets === 5 && efv.every(Number.isFinite), `${resets} LFO resets for 5 bursts (last one hovers ±1.3 dB around the threshold)`);
}

/* ---------- 7. no NaN: extreme settings, hot feedback, broken taps ---------- */
{
  const proc = loadProcessor();
  const v = P.defaultValues();
  const set = [
    [1, 'Out', 0.1, 5, 24, 0, 1],
    [2, 'Res Out', 500, 5000, -24, -60, -1],
    [3, 'Band 1', 0.1, 5000, 24, -60, 1],
    [4, 'Band 10', 500, 5, 0, -0.5, -1],
  ];
  for (const [n, tap, a, r, g, thr, c] of set) {
    Object.entries({ on: 1, tap: TAP[tap], attack: a, release: r, gain: g, threshold: thr, curve: c }).forEach(([k, x]) => (v[idx(`ef${n}.${k}`)] = x));
  }
  v[idx('fbAllOn')] = 1;
  v[idx('fbAll')] = 1;
  for (let b = 0; b < 10; b++) v[idx(`band${b}.fb`)] = 1;
  send(proc, v);
  modConfig(proc, [[0, 'ef1', 'band3.res'], [1, 'ef2', 'resOffset'], [2, 'ef3', 'ef4.threshold']]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const { L } = run(proc, Math.round((2 * FS) / BLOCK), (i) => (i < FS ? rnd() : 0));
  const vals = ['ef1', 'ef2', 'ef3', 'ef4'].flatMap((id) => srcSeries(proc, id));
  const wOk = vals.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) && L.every(Number.isFinite);

  const { ef, ctx, feed } = direct({ attack: 1, release: 50, threshold: -60 }, BLOCK);
  const bad = feed(BLOCK * 2, (i) => (i % 3 === 0 ? NaN : i % 3 === 1 ? Infinity : -Infinity));
  const after = feed(0.2 * FS, () => 0.1);
  const dOk = Array.from(bad).every(Number.isFinite) && Math.abs(outDb(after[after.length - 1]) - -20) < 0.1 && Number.isFinite(ef.envelope) && ctx.fires <= 2;
  check('7 no NaN (extreme params, hot feedback, NaN/Inf taps)', wOk && dOk, `${vals.length} worklet readouts in 0..1; after NaN/Inf blocks the follower recovers to ${outDb(after[after.length - 1]).toFixed(2)} dB`);
}

/* ---------- 8. cost: dsp-test 8 setup with all 4 followers on ---------- */
{
  const measure = (efsOn, routes) => {
    const v = P.defaultValues();
    v[idx('fbAllOn')] = 1;
    v[idx('spread')] = 0.5;
    for (let b = 0; b < 10; b++) v[idx(`band${b}.fb`)] = 0.5;
    const taps = ['In', 'Band 5', 'Res Out', 'Out'];
    if (efsOn) for (let n = 1; n <= 4; n++) { v[idx(`ef${n}.on`)] = 1; v[idx(`ef${n}.tap`)] = TAP[taps[n - 1]]; }
    const proc = loadProcessor();
    send(proc, v);
    if (routes) modConfig(proc, [[0, 'ef1', 'band2.res'], [1, 'ef2', 'band7.fb'], [2, 'ef3', 'resOffset'], [3, 'ef4', 'outputGain']]);
    let seed = 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    const iL = new Float32Array(BLOCK * 64), iR = new Float32Array(BLOCK * 64);
    for (let i = 0; i < iL.length; i++) { iL[i] = rnd() * 0.3; iR[i] = rnd() * 0.3; }
    const ins = [];
    for (let k = 0; k < 64; k++) ins.push([[iL.subarray(k * BLOCK, (k + 1) * BLOCK), iR.subarray(k * BLOCK, (k + 1) * BLOCK)]]);
    const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
    const blocks = Math.ceil((10 * FS) / BLOCK);
    for (let k = 0; k < 400; k++) proc.process(ins[k & 63], outs);
    let ms = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      for (let k = 0; k < blocks; k++) proc.process(ins[k & 63], outs);
      ms = Math.min(ms, performance.now() - t0);
    }
    return 10000 / ms;
  };
  const off = measure(false, false), on = measure(true, false), routed = measure(true, true);
  check('8 cost of 4 followers (10 s stereo)', on > 15 && routed > 15, `${on.toFixed(1)}x realtime with 4 EFs on, ${routed.toFixed(1)}x with 4 EF → resonator routes, ${off.toFixed(1)}x all off`);
}

console.log('\nEnvelope follower tests');
console.table(results);
