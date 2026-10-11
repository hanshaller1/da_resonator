// Offline tests for the pre / post filter (src/dsp/modules/filter.ts).
// Run: node scripts/test-filter.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results } from './testkit.mjs';

const F = importTs('src/dsp/modules/filter.ts');
const P = importTs('src/shared/params.ts');
const S = importTs('src/shared/mod/sources.ts');

const TYPES = ['LP', 'BP', 'HP', 'Notch'];
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

/* ---------- helpers: one stage driven directly with a block context ---------- */
function stage(slot = 'filterPre') {
  const st = new F.FilterStage(slot);
  const eff = P.defaultValues();
  const ctx = {
    fs: FS, n: BLOCK, dt: BLOCK / FS, eff,
    clock: { bpm: 120, running: true, beats: 0, beatsPrev: 0 },
    taps: [], triggered: () => false, fire() {},
  };
  const set = (vals) => { for (const [k, v] of Object.entries(vals)) eff[P.paramIndex(`${slot}.${k}`)] = v; };
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  /** run `samples` samples of input(n) (both channels); onBlock(k, pos) before each block; returns outputs */
  const runFor = (samples, input, onBlock) => {
    const blocks = Math.ceil(samples / BLOCK);
    const L = new Float32Array(blocks * BLOCK), R = new Float32Array(blocks * BLOCK);
    const ret = [];
    for (let k = 0; k < blocks; k++) {
      onBlock?.(k, k * BLOCK);
      for (let s = 0; s < BLOCK; s++) l[s] = r[s] = input(k * BLOCK + s);
      ret.push(st.process(l, r, BLOCK, ctx));
      L.set(l, k * BLOCK);
      R.set(r, k * BLOCK);
    }
    return { L, R, ret };
  };
  return { st, eff, ctx, set, runFor };
}

/** amplitude of frequency f in x[from..from+len) (single-bin DFT) */
function amp(x, f, from, len) {
  let re = 0, im = 0;
  const w = (2 * Math.PI * f) / FS;
  for (let n = 0; n < len; n++) {
    re += x[from + n] * Math.cos(w * (from + n));
    im += x[from + n] * Math.sin(w * (from + n));
  }
  return (2 * Math.hypot(re, im)) / len;
}

/** measured gain (dB) of a configured filter at frequency f (fresh stage per tone) */
function measure(vals, f, settle = 0.4) {
  const { set, runFor } = stage();
  set({ on: 1, drive: 0, mix: 1, ...vals });
  const A = 0.1;
  const s0 = Math.round(settle * FS);
  const N = Math.round((Math.ceil(Math.max(0.15 * f, 30)) * FS) / f); // ≈ whole periods
  const { L } = runFor(s0 + N, (n) => A * Math.sin((2 * Math.PI * f * n) / FS));
  return db(amp(L, f, s0, N) / A);
}

/** analytic magnitude of the TPT SVF (bilinear, prewarped analog prototype), written independently */
function svfDb(type, slope24, fc, res, f) {
  const q0 = 0.5 * Math.pow(50, res);
  const k = 1 / (slope24 ? Math.sqrt(q0) : q0);
  const W = Math.tan((Math.PI * f) / FS) / Math.tan((Math.PI * fc) / FS);
  const dMag = Math.hypot(1 - W * W, k * W);
  const nMag = type === 'LP' ? 1 : type === 'BP' ? k * W : type === 'HP' ? W * W : Math.abs(1 - W * W);
  const m = nMag / dMag;
  return db(slope24 ? m * m : m);
}

/* ---------- 1. magnitude vs analytic SVF response ---------- */
{
  const rows = [];
  let worst = 0, worstAt = '', ok = true, n = 0;
  for (const [fc, res] of [[1000, 0.4], [6000, 0.7]]) {
    for (const slope of [0, 1]) {
      for (let t = 0; t < 4; t++) {
        const errs = [];
        for (const m of [0.25, 0.5, 0.8, 1, 1.25, 2, 3]) {
          const f = fc * m;
          if (f > 20000) continue;
          const want = svfDb(TYPES[t], slope === 1, fc, res, f);
          const got = measure({ type: t, slope, cutoff: fc, res }, f);
          const lib = db(F.filterMagnitude(t, slope === 1, fc, res, 1, f, FS));
          n++;
          // the notch centre is −∞ dB: there only require a deep notch
          const pass = want < -40 ? got < -40 : Math.abs(got - want) <= 1 && Math.abs(lib - want) < 0.01;
          if (!pass) ok = false;
          const e = want < -40 ? 0 : Math.abs(got - want);
          if (e > worst) { worst = e; worstAt = `${TYPES[t]} ${slope ? 24 : 12} dB fc ${fc} @ ${Math.round(f)} Hz`; }
          errs.push(want < -40 ? `${got.toFixed(0)}` : `${(got - want).toFixed(2)}`);
        }
        rows.push({ type: TYPES[t], slope: slope ? '24 dB' : '12 dB', fc, res, 'error dB @ fc×[¼ ½ .8 1 1.25 2 3]': errs.join(' ') });
      }
    }
  }
  console.log('\n1. Measured − analytic magnitude (dB); notch centre shows the measured depth');
  console.table(rows);
  check('1 LP/BP/HP/Notch vs analytic SVF ±1 dB', ok, `${n} points, worst ${worst.toFixed(3)} dB (${worstAt})`);
}

/* ---------- 2. slopes: 12 vs 24 dB/oct, same gain at the cutoff ---------- */
{
  // one octave well inside the stop band (8…16× the cutoff, little bilinear warping)
  const oct = (v, f1, f2) => measure(v, f1) - measure(v, f2);
  const lp12 = oct({ type: 0, slope: 0, cutoff: 100, res: 0.1 }, 800, 1600);
  const lp24 = oct({ type: 0, slope: 1, cutoff: 100, res: 0.1 }, 800, 1600);
  const hp24 = oct({ type: 2, slope: 1, cutoff: 8000, res: 0.1 }, 1000, 500);
  const at12 = measure({ type: 0, slope: 0, cutoff: 1000, res: 1 }, 1000, 1.0);
  const at24 = measure({ type: 0, slope: 1, cutoff: 1000, res: 1 }, 1000, 1.0);
  const ok = Math.abs(lp12 - 12) < 0.5 && Math.abs(lp24 - 24) < 1 && Math.abs(hp24 - 24) < 1 && Math.abs(at12 - at24) < 0.5 && Math.abs(at12 - db(25)) < 0.5;
  check(
    '2 slopes 12 / 24 dB per octave',
    ok,
    `LP12 ${lp12.toFixed(1)}, LP24 ${lp24.toFixed(1)}, HP24 ${hp24.toFixed(1)} dB/oct; LP res 1 at fc: 12 dB ${at12.toFixed(2)}, 24 dB ${at24.toFixed(2)} dB (Q 25 = ${db(25).toFixed(2)})`,
  );
}

/* ---------- 3. cutoff accuracy: BP peak position ---------- */
{
  const rows = [];
  let ok = true;
  const d = 0.03; // octaves
  for (const fc of [30, 100, 1000, 5000, 12000, 19000]) {
    const v = { type: 1, slope: 0, cutoff: fc, res: 0.8 };
    const gL = measure(v, fc * 2 ** -d, 0.6), g0 = measure(v, fc, 0.6), gR = measure(v, fc * 2 ** d, 0.6);
    const p = (d * (gL - gR)) / (2 * (gL - 2 * g0 + gR)); // parabolic peak offset in octaves
    const errPct = (2 ** p - 1) * 100;
    const pass = Math.abs(errPct) < 1 && Math.abs(g0) < 0.3;
    ok &&= pass;
    rows.push({ cutoff: fc, 'peak error %': errPct.toFixed(3), 'gain at fc dB': g0.toFixed(2), ok: pass });
  }
  console.log('\n3. BP (res 0.8) peak position vs cutoff');
  console.table(rows);
  check('3 cutoff accuracy (BP peak within 1 %)', ok, `30 Hz … 19 kHz`);
}

/* ---------- 4. stability: 40 Hz full-depth LFO on both cutoffs, res 1, drive 24 dB, 10 s ---------- */
{
  const proc = loadProcessor();
  const idx = (id) => P.paramIndex(id);
  const v = P.defaultValues();
  for (const [slot, type] of [['filterPre', 0], ['filterPost', 1]]) {
    v[idx(`${slot}.on`)] = 1;
    v[idx(`${slot}.type`)] = type;
    v[idx(`${slot}.slope`)] = 1;
    v[idx(`${slot}.cutoff`)] = Math.sqrt(20 * 20000); // norm 0.5: full depth sweeps 20 Hz … 20 kHz
    v[idx(`${slot}.res`)] = 1;
    v[idx(`${slot}.drive`)] = 24;
  }
  v[idx('lfo1.on')] = 1;
  v[idx('lfo1.rate')] = 40;
  v[idx('route0.depth')] = 1;
  v[idx('route1.depth')] = 1;
  proc.port.onmessage({ data: { type: 'params', values: v } });
  const route = (slot, src, dst) => ({ slot, src: S.SOURCE_BY_ID[src].index, dst: idx(dst) });
  proc.port.onmessage({ data: { type: 'modConfig', config: { routes: [route(0, 'lfo1', 'filterPre.cutoff'), route(1, 'lfo1', 'filterPost.cutoff')], triggers: [] } } });

  // watch both stages' outputs and the effective cutoff they see
  const stats = { pre: { pk: 0, fin: true }, post: { pk: 0, fin: true }, lo: Infinity, hi: 0 };
  const iCut = idx('filterPre.cutoff');
  for (const [name, st] of [['pre', proc.mod.preFilter], ['post', proc.mod.postFilter]]) {
    const orig = st.process.bind(st);
    st.process = (l, r, n, ctx) => {
      const ret = orig(l, r, n, ctx);
      const s = stats[name];
      for (let i = 0; i < n; i++) {
        const a = Math.abs(l[i]), b = Math.abs(r[i]);
        if (!(a < Infinity) || !(b < Infinity)) s.fin = false;
        if (a > s.pk) s.pk = a;
        if (b > s.pk) s.pk = b;
      }
      if (name === 'pre') { stats.lo = Math.min(stats.lo, ctx.eff[iCut]); stats.hi = Math.max(stats.hi, ctx.eff[iCut]); }
      return ret;
    };
  }
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const blocks = Math.round((10 * FS) / BLOCK);
  const iL = new Float32Array(BLOCK), iR = new Float32Array(BLOCK), oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
  let outFin = true, outPk = 0;
  for (let k = 0; k < blocks; k++) {
    for (let s = 0; s < BLOCK; s++) {
      const n = k * BLOCK + s;
      iL[s] = 0.5 * rnd() + 0.4 * Math.sin((2 * Math.PI * 220 * n) / FS);
      iR[s] = 0.5 * rnd() + 0.4 * Math.sin((2 * Math.PI * 330 * n) / FS);
    }
    proc.process([[iL, iR]], [[oL, oR]]);
    for (let s = 0; s < BLOCK; s++) {
      if (!Number.isFinite(oL[s]) || !Number.isFinite(oR[s])) outFin = false;
      outPk = Math.max(outPk, Math.abs(oL[s]), Math.abs(oR[s]));
    }
  }
  const swept = stats.lo < 25 && stats.hi > 19000;
  const bounded = stats.pre.pk < 40 && stats.post.pk < 40;

  // every type × slope directly on a stage: per-block stepped 40 Hz sweep over the full range, 2 s each
  let typesOk = true;
  const typePk = [];
  for (let t = 0; t < 4; t++) for (const slope of [0, 1]) {
    const { set, runFor, eff } = stage();
    set({ on: 1, type: t, slope, res: 1, drive: 24, mix: 1 });
    const ic = P.paramIndex('filterPre.cutoff');
    const { L, R } = runFor(2 * FS, () => 0.5 * rnd(), (k, pos) => { eff[ic] = 20 * 1000 ** (0.5 + 0.5 * Math.sin((2 * Math.PI * 40 * pos) / FS)); });
    let pk = 0, fin = true;
    for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) fin = false; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    typePk.push(`${TYPES[t]}${slope ? 24 : 12} ${pk.toFixed(1)}`);
    typesOk &&= fin && pk < 40;
  }
  check(
    '4 stability: 40 Hz full-depth cutoff LFO, res 1, drive 24 dB',
    stats.pre.fin && stats.post.fin && outFin && swept && bounded && typesOk,
    `10 s worklet: cutoff ${stats.lo.toFixed(0)}…${stats.hi.toFixed(0)} Hz, peak pre ${stats.pre.pk.toFixed(2)} post ${stats.post.pk.toFixed(2)} out ${outPk.toFixed(2)}; stage peaks: ${typePk.join(', ')}`,
  );
}

/* ---------- 5. off = bit-exact pass-through, also after switching off ---------- */
{
  const { set, runFor } = stage();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const input = new Float32Array(FS);
  for (let i = 0; i < input.length; i++) input[i] = Math.fround(0.7 * rnd());
  set({ on: 0, type: 2, cutoff: 3000, res: 0.9, drive: 12 });
  const a = runFor(0.2 * FS, (n) => input[n]);
  const exactOff = a.ret.every((x) => x === false) && a.L.every((x, i) => x === input[i]);

  const offAt = Math.round((0.4 * FS) / BLOCK);
  const b = runFor(0.8 * FS, (n) => input[n], (k) => set({ on: k < offAt ? 1 : 0 }));
  const firstFalse = b.ret.indexOf(false, offAt);
  const fadeBlocks = firstFalse - offAt;
  let exactAfter = b.ret.slice(firstFalse).every((x) => x === false);
  for (let i = firstFalse * BLOCK; i < b.L.length; i++) if (b.L[i] !== input[i] || b.R[i] !== input[i]) exactAfter = false;
  const processedWhileOn = b.ret.slice(0, offAt).every((x) => x === true);
  check(
    '5 off = bit-exact pass-through',
    exactOff && processedWhileOn && exactAfter && fadeBlocks >= 3 && fadeBlocks <= 5,
    `off: ${exactOff ? 'identical' : 'DIFFERENT'}; switched off → pass-through after ${fadeBlocks} blocks (${((fadeBlocks * BLOCK) / FS * 1000).toFixed(1)} ms), then ${exactAfter ? 'identical' : 'DIFFERENT'}`,
  );
}

/* ---------- 5b. silence after a burst: state reaches exact zero (no denormal slowdown) ---------- */
{
  const { st, set, runFor } = stage();
  set({ on: 1, type: 0, slope: 1, cutoff: 20, res: 0 });
  runFor(BLOCK, () => 0.5);
  runFor(20 * FS, () => 0);
  const state = [...st.state];
  check('5b silent input: state flushed to 0', state.every((x) => x === 0), `after 20 s at 20 Hz LP 24 dB: ${state.some((x) => x !== 0) ? state.join(', ') : 'all 0'}`);
}

/* ---------- 6. no clicks: on/off, type, slope, cutoff, drive, mix jumps on a 100 Hz sine ---------- */
{
  const { set, runFor } = stage();
  set({ on: 0, type: 0, slope: 0, cutoff: 300, res: 0.6, drive: 0, mix: 1 });
  const at = (s) => Math.round((s * FS) / BLOCK) * BLOCK;
  const changes = new Map([
    [at(0.3), ['on', () => set({ on: 1 })]],
    [at(0.6), ['LP → HP', () => set({ type: 2 })]],
    [at(0.9), ['12 → 24 dB', () => set({ slope: 1 })]],
    [at(1.2), ['cutoff 300 → 60 Hz', () => set({ cutoff: 60 })]],
    [at(1.5), ['HP → Notch', () => set({ type: 3 })]],
    [at(1.8), ['drive 0 → 24 dB', () => set({ drive: 24 })]],
    [at(2.1), ['mix 1 → 0.3', () => set({ mix: 0.3 })]],
    [at(2.4), ['24 → 12 dB', () => set({ slope: 0 })]],
    [at(2.7), ['off', () => set({ on: 0 })]],
  ]);
  const { L } = runFor(3 * FS, (n) => 0.5 * Math.sin((2 * Math.PI * 100 * n) / FS), (k, pos) => changes.get(pos)?.[1]());
  const maxDiff = (a, b) => { let m = 0; for (let n = Math.max(1, a); n < Math.min(L.length, b); n++) m = Math.max(m, Math.abs(L[n] - L[n - 1])); return m; };
  const rows = [];
  let ok = true;
  for (const [pos, [what]] of changes) {
    const trans = maxDiff(pos, pos + 0.03 * FS);
    const settled = Math.max(maxDiff(pos - 0.1 * FS, pos), maxDiff(pos + 0.15 * FS, pos + 0.25 * FS));
    const pass = trans <= settled * 1.5 + 0.005;
    ok &&= pass;
    rows.push({ at: (pos / FS).toFixed(2) + ' s', change: what, 'transition max|Δx|': trans.toFixed(4), 'settled max|Δx|': settled.toFixed(4), ok: pass });
  }
  console.log('\n6. Switches and jumps on a 100 Hz sine (res 0.6)');
  console.table(rows);
  check('6 no clicks on toggle / type / slope / jumps', ok, `${changes.size} change points`);
}

/* ---------- 6b. zipper: 40 Hz ±1.5 oct cutoff LFO, effective values only once per block ---------- */
{
  // BP shows coefficient steps directly in its output (LP hides them in the integrator state)
  const RES = 0.5, cutAt = (t) => 1000 * 2 ** (1.5 * Math.sin(2 * Math.PI * 40 * t));
  const input = (n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / FS);
  // reference SVF: per-sample coefficients from the continuous LFO (ideal) or held per block (naive)
  const ref = (perSample) => {
    const k = 1 / (0.5 * Math.pow(50, RES));
    let s1 = 0, s2 = 0, g = 0;
    const out = new Float32Array(2 * FS);
    for (let n = 0; n < out.length; n++) {
      if (perSample || n % BLOCK === 0) g = Math.tan((Math.PI * cutAt(perSample ? (n - BLOCK) / FS : n / FS)) / FS);
      const x = input(n);
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
      s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
      out[n] = k * v1;
    }
    return out;
  };
  const { set, runFor, eff } = stage();
  set({ on: 1, type: 1, slope: 0, res: RES, drive: 0, mix: 1 });
  const ic = P.paramIndex('filterPre.cutoff');
  const { L } = runFor(2 * FS, input, (k, pos) => { eff[ic] = cutAt(pos / FS); });
  // energy above 8 kHz (4th-order HP; the clean modulated signal has almost none there) and how much
  // of it sits at fixed positions in the 128-sample block (block-rate zipper: max / mean over positions)
  const zip = (x) => {
    const g = Math.tan((Math.PI * 8000) / FS), k = Math.SQRT2;
    const st = [0, 0, 0, 0], fold = new Float64Array(BLOCK);
    let e = 0, cnt = 0;
    for (let n = 0; n < x.length; n++) {
      let y = x[n];
      for (let s = 0; s < 2; s++) {
        const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        const v3 = y - st[2 * s + 1], v1 = a1 * st[2 * s] + a2 * v3, v2 = st[2 * s + 1] + a2 * st[2 * s] + a3 * v3;
        st[2 * s] = 2 * v1 - st[2 * s]; st[2 * s + 1] = 2 * v2 - st[2 * s + 1];
        y = y - k * v1 - v2;
      }
      if (n > 0.3 * FS) { e += y * y; cnt++; fold[n % BLOCK] += y * y; }
    }
    const mean = fold.reduce((a, b) => a + b) / BLOCK;
    return { hf: db(Math.sqrt(e / cnt)), fold: Math.max(...fold) / mean };
  };
  const real = zip(L), ideal = zip(ref(true)), naive = zip(ref(false));
  check(
    '6b zipper-free 40 Hz cutoff modulation',
    real.hf < ideal.hf + 3 && real.fold < 3 && naive.fold > 10,
    `HF > 8 kHz / block-periodic ratio: stage ${real.hf.toFixed(1)} dB / ${real.fold.toFixed(2)}, per-sample ideal ${ideal.hf.toFixed(1)} / ${ideal.fold.toFixed(2)}, per-block steps ${naive.hf.toFixed(1)} / ${naive.fold.toFixed(1)}`,
  );
}

/* ---------- 6c. drive: level compensated for typical levels, adds harmonics ---------- */
{
  const level = (drive, gen) => {
    const { set, runFor } = stage();
    set({ on: 1, type: 0, slope: 0, cutoff: 20000, res: 0, mix: 1, drive });
    const N = 0.5 * FS;
    const { L } = runFor(N, gen);
    let e = 0, ei = 0;
    for (let n = 0.1 * FS; n < N; n++) { e += L[n] * L[n]; ei += gen(n) ** 2; }
    return { db: 10 * Math.log10(e / ei), L };
  };
  let seed = 11;
  const noise = [];
  for (let n = 0; n < FS; n++) noise.push(((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * 2 - 1) * 0.218); // ≈ −18 dBFS RMS
  const sigs = { 'sine −12 dBFS': (n) => 0.25 * Math.sin((2 * Math.PI * 220 * n) / FS), 'noise −18 dBFS RMS': (n) => noise[n] };
  const rows = [];
  let ok = true;
  for (const [name, gen] of Object.entries(sigs)) {
    const ref = level(0, gen).db;
    const row = { signal: name };
    for (const d of [6, 12, 18, 24]) {
      const x = level(d, gen).db - ref;
      ok &&= Math.abs(x) < 3;
      row[`${d} dB`] = `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
    }
    rows.push(row);
  }
  // 24 dB drive on a sine: 3rd harmonic well up (odd-order saturation)
  const { L } = level(24, sigs['sine −12 dBFS']);
  const h3 = 20 * Math.log10(amp(L, 660, 0.1 * FS, 0.3 * FS) / amp(L, 220, 0.1 * FS, 0.3 * FS));
  ok &&= h3 > -20;
  console.log('\n6c. Level change vs drive 0 dB (dB)');
  console.table(rows);
  check('6c drive: level compensated (±3 dB at typical levels)', ok, `3rd harmonic at 24 dB drive: ${h3.toFixed(1)} dB`);
}

/* ---------- 7. performance: both filters on at 24 dB (+ drive, modulated cutoff) ---------- */
{
  const idx = (id) => P.paramIndex(id);
  const setup = (filters) => {
    const proc = loadProcessor();
    const v = P.defaultValues();
    v[idx('fbAllOn')] = 1;
    v[idx('spread')] = 0.5;
    for (let b = 0; b < 10; b++) v[idx(`band${b}.fb`)] = 0.5;
    if (filters) {
      for (const slot of ['filterPre', 'filterPost']) {
        v[idx(`${slot}.on`)] = 1;
        v[idx(`${slot}.slope`)] = 1;
        v[idx(`${slot}.res`)] = 0.6;
        v[idx(`${slot}.drive`)] = 12;
        v[idx(`${slot}.mix`)] = 0.8;
      }
      v[idx('lfo1.on')] = 1;
      v[idx('lfo1.rate')] = 5;
      v[idx('route0.depth')] = 0.5;
    }
    proc.port.onmessage({ data: { type: 'params', values: v } });
    if (filters) {
      const routes = [{ slot: 0, src: S.SOURCE_BY_ID.lfo1.index, dst: idx('filterPre.cutoff') }];
      proc.port.onmessage({ data: { type: 'modConfig', config: { routes, triggers: [] } } });
    }
    return proc;
  };
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const iL = new Float32Array(BLOCK * 64), iR = new Float32Array(BLOCK * 64);
  for (let i = 0; i < iL.length; i++) { iL[i] = rnd() * 0.3; iR[i] = rnd() * 0.3; }
  const ins = [];
  for (let k = 0; k < 64; k++) ins.push([[iL.subarray(k * BLOCK, (k + 1) * BLOCK), iR.subarray(k * BLOCK, (k + 1) * BLOCK)]]);
  const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  const blocks = Math.ceil((10 * FS) / BLOCK);
  const time = (proc) => {
    for (let k = 0; k < 400; k++) proc.process(ins[k & 63], outs); // warm-up
    // best of 5: shared test machines are noisy
    let ms = Infinity;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      for (let k = 0; k < blocks; k++) proc.process(ins[k & 63], outs);
      ms = Math.min(ms, performance.now() - t0);
    }
    return ms;
  };
  const msOff = time(setup(false));
  const msOn = time(setup(true));
  const x = 10000 / msOn;
  check('7 performance, both filters 24 dB + drive (10 s stereo)', x > 15, `${msOn.toFixed(0)} ms → ${x.toFixed(1)}x realtime (filters off: ${msOff.toFixed(0)} ms, +${(msOn - msOff).toFixed(0)} ms for both filters; best of 5)`);
}

console.log('\nFilter tests');
console.table(results);
