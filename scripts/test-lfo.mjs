// Offline tests for the LFO module (src/dsp/modules/lfo.ts) running inside the real worklet.
// Run: node scripts/test-lfo.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const S = importTs('src/shared/mod/sources.ts');
const T = importTs('src/shared/paramdefs/types.ts');

const DT = BLOCK / FS;
const idx = (id) => P.paramIndex(id);
const divIndex = (label) => T.DIVISIONS.findIndex((d) => d.label === label);
const src = (id) => S.SOURCE_BY_ID[id].index;
const f32 = Math.fround;
const frac = (x) => x - Math.floor(x);

/** processor with base values from `set` (id → value), routes [src, dst, depth] and trigger routes [out, in] */
function setup(set, routes = [], triggers = []) {
  const proc = loadProcessor();
  const v = P.defaultValues();
  for (const [id, val] of Object.entries(set)) v[idx(id)] = val;
  routes.forEach(([, , depth], slot) => (v[idx(`route${slot}.depth`)] = depth));
  proc.port.onmessage({ data: { type: 'params', values: v } });
  proc.port.onmessage({
    data: {
      type: 'modConfig',
      config: {
        routes: routes.map(([s, d], slot) => ({ slot, src: src(s), dst: idx(d) })),
        triggers: triggers.map(([o, i]) => ({ src: S.TRIGGER_OUT_BY_ID[o].index, dst: S.TRIGGER_IN_BY_ID[i].index })),
      },
    },
  });
  // record which trigger outputs fire in which block
  const fired = new Set();
  const fire = proc.mod.ctx.fire;
  proc.mod.ctx.fire = (o) => {
    fired.add(o);
    fire(o);
  };
  const sendBase = () => proc.port.onmessage({ data: { type: 'params', values: v } });
  return { proc, v, fired, sendBase };
}

/**
 * run `blocks` blocks and record per block: source values, clock, trigger fires.
 * before(k) runs ahead of block k (param changes).
 */
function capture(env, blocks, ids, before) {
  const { proc, fired } = env;
  const vals = Object.fromEntries(ids.map((id) => [id, new Float64Array(blocks)]));
  const cyc = Object.fromEntries(ids.map((id) => [id, []]));
  const beats = new Float64Array(blocks), beatsPrev = new Float64Array(blocks);
  const trig = Object.fromEntries(ids.map((id) => [id, S.TRIGGER_OUT_BY_ID[`${id}.cycle`]?.index]));
  const iL = new Float32Array(BLOCK), oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
  let finite = true;
  for (let k = 0; k < blocks; k++) {
    before?.(k);
    fired.clear();
    proc.process([[iL, iL]], [[oL, oR]]);
    for (const id of ids) {
      vals[id][k] = proc.mod.srcVals[src(id)];
      if (fired.has(trig[id])) cyc[id].push(k);
    }
    beats[k] = proc.mod.clock.beats;
    beatsPrev[k] = proc.mod.clock.beatsPrev;
    for (let s = 0; s < BLOCK; s++) if (!Number.isFinite(oL[s]) || !Number.isFinite(oR[s])) finite = false;
  }
  return { vals, cyc, beats, beatsPrev, finite };
}

const allFinite = (a) => a.every(Number.isFinite);
const maxAbs = (a, b) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b(i))), 0);

/* ---------- 1. frequency accuracy (free rate) ---------- */
{
  const rates = [0.05, 3.7, 36.9];
  const ids = ['lfo1', 'lfo2', 'lfo3'];
  const set = {};
  ids.forEach((id, i) => Object.assign(set, { [`${id}.on`]: 1, [`${id}.rate`]: rates[i] }));
  const env = setup(set);
  const blocks = 7531; // ~20 s, not on a cycle boundary
  const { vals, cyc } = capture(env, blocks, ids);
  const detail = [];
  let ok = true;
  ids.forEach((id, i) => {
    const f = f32(rates[i]);
    // value of block k is the phase at its end: sin(2π f (k+1) dt)
    const err = maxAbs(vals[id], (k) => Math.sin(2 * Math.PI * f * (k + 1) * DT));
    // frequency from interpolated upward zero crossings
    const zc = [];
    const a = vals[id];
    for (let k = 1; k < blocks; k++) if (a[k - 1] < 0 && a[k] >= 0) zc.push((k - 1 + -a[k - 1] / (a[k] - a[k - 1])) * DT);
    const fEst = zc.length > 1 ? (zc.length - 1) / (zc.at(-1) - zc[0]) : NaN;
    const relF = Math.abs(fEst - f) / f;
    // one cycle trigger per wrap (+1 at the start), in exactly the blocks where the accumulator wraps
    const want = [0];
    for (let k = 0, acc = 0; k < blocks; k++) {
      acc += DT * f;
      if (acc >= 1) {
        acc -= Math.floor(acc);
        want.push(k);
      }
    }
    const sameTrig = want.length === cyc[id].length && want.every((k, j) => cyc[id][j] === k);
    ok &&= err < 1e-4 && (rates[i] < 0.1 || relF < 1e-4) && sameTrig;
    detail.push(`${rates[i]} Hz: max err ${err.toExponential(1)}, f ${Number.isFinite(fEst) ? fEst.toFixed(5) : '-'}, ${cyc[id].length}/${want.length} cycle triggers`);
  });
  check('1 free rate: frequency + cycle triggers', ok, detail.join(' | '));
}

/* ---------- 2. sync: phase lock to the clock, 30 s at 137 BPM ---------- */
{
  const divs = ['1/4', '1/8T', '1 Bar', '1/16D'];
  const phases = [0, 0.25, 0.5, 0.9];
  const ids = ['lfo1', 'lfo2', 'lfo3', 'lfo4'];
  const set = { 'clock.bpm': 137 };
  ids.forEach((id, i) =>
    Object.assign(set, { [`${id}.on`]: 1, [`${id}.sync`]: 1, [`${id}.div`]: divIndex(divs[i]), [`${id}.phase`]: phases[i], [`${id}.rate`]: 13 }),
  );
  const env = setup(set);
  const blocks = Math.round((30 * FS) / BLOCK);
  const { vals, cyc, beats, beatsPrev } = capture(env, blocks, ids);
  const bpm = f32(137);
  const ideal = (k) => ((k + 1) * DT * bpm) / 60;
  const clockErr = maxAbs(beats, ideal);
  const detail = [`clock drift ${clockErr.toExponential(1)} beats`];
  let ok = clockErr < 1e-6;
  ids.forEach((id, i) => {
    const d = T.DIVISIONS[divIndex(divs[i])].beats;
    const err = maxAbs(vals[id], (k) => Math.sin(2 * Math.PI * frac(ideal(k) / d + phases[i])));
    // cycle triggers exactly where the clock crosses a division (+1 at the start)
    const want = [0];
    for (let k = 1; k < blocks; k++) if (Math.floor(beats[k] / d) > Math.floor(beatsPrev[k] / d)) want.push(k);
    const sameTrig = want.length === cyc[id].length && want.every((k, j) => cyc[id][j] === k);
    ok &&= err < 1e-4 && sameTrig && Math.abs(want.length - 1 - ideal(blocks - 1) / d) < 1;
    detail.push(`${divs[i]}: err ${err.toExponential(1)}, ${cyc[id].length}/${want.length} cycle triggers`);
  });
  check('2 sync phase lock (137 BPM, 30 s)', ok, detail.join(' | '));
}

/* ---------- 3. sync follows a tempo change ---------- */
{
  const env = setup({ 'clock.bpm': 137, 'lfo1.on': 1, 'lfo1.sync': 1, 'lfo1.div': divIndex('1/8'), 'lfo1.shape': 2 });
  const blocks = Math.round((10 * FS) / BLOCK);
  const half = blocks >> 1;
  const { vals, beats } = capture(env, blocks, ['lfo1'], (k) => {
    if (k === half) {
      env.v[idx('clock.bpm')] = 91;
      env.sendBase();
    }
  });
  const err = maxAbs(vals.lfo1, (k) => 2 * frac(beats[k] / 0.5) - 1);
  const expBeats = (half * DT * f32(137)) / 60 + ((blocks - half) * DT * 91) / 60;
  check('3 sync follows tempo change', err < 1e-4 && Math.abs(beats[blocks - 1] - expBeats) < 1e-6, `saw vs clock err ${err.toExponential(1)}, beats ${beats[blocks - 1].toFixed(4)}`);
}

/** up to 4 LFO slots in one processor: settings per slot as { key: value } (key without `lfoN.`) */
function slots(list, blocks, routes = []) {
  const set = {};
  list.forEach((cfg, i) => {
    set[`lfo${i + 1}.on`] = 1;
    for (const [k, val] of Object.entries(cfg)) set[`lfo${i + 1}.${k}`] = val;
  });
  const ids = list.map((_, i) => `lfo${i + 1}`);
  const { vals } = capture(setup(set, routes), blocks, ids);
  return ids.map((id) => vals[id]);
}

/* ---------- 4. morph / smooth / uni / level stay within range (also under modulation) ---------- */
{
  const combos = [];
  for (let shape = 0; shape < 6; shape++)
    for (const morph of [0, 0.25, 0.5, 0.75, 1])
      for (const smooth of [0, 0.3, 1])
        for (const uni of [0, 1]) combos.push({ shape, morph, smooth, uni, level: 0.7, rate: 7.3 });
  let worst = '';
  for (let c = 0; c < combos.length; c += 3) {
    const group = combos.slice(c, c + 3);
    // lfo4 (S&H, fast) sweeps phase, morph and rate of the three LFOs under test at full depth
    const mod = { shape: 4, rate: 11 };
    const routes = group.flatMap((_, i) => [['lfo4', `lfo${i + 1}.phase`, 1], ['lfo4', `lfo${i + 1}.morph`, -1], ['lfo4', `lfo${i + 1}.rate`, 0.5]]);
    const out = slots([...group, ...Array(3 - group.length).fill({ on: 0 }), mod], 400, routes);
    group.forEach((g, i) => {
      const lo = g.uni ? 0 : -g.level, hi = g.level;
      if (out[i].some((x) => !Number.isFinite(x) || x < lo - 1e-6 || x > hi + 1e-6))
        worst = `shape ${g.shape} morph ${g.morph} smooth ${g.smooth} uni ${g.uni}: ${Math.min(...out[i])}..${Math.max(...out[i])}`;
    });
  }
  check('4 range: shapes × morph × smooth × uni', !worst, worst || `${combos.length} combinations, phase/morph/rate modulated`);
}

/* ---------- 5. morph shapes the waveform as documented ---------- */
{
  // square pulse width 50% → 2%
  const sq = slots([0, 0.5, 1].map((morph) => ({ shape: 3, morph, rate: 13.7 })), 6000);
  const [d0, d5, d1] = sq.map((a) => a.filter((x) => x > 0).length / a.length);
  // saw at 0.5 = triangle, at 1 = ramp down
  const f = f32(2.13);
  const [tri, ramp] = slots([{ shape: 2, morph: 0.5, rate: 2.13 }, { shape: 2, morph: 1, rate: 2.13 }], 2000);
  const triErr = maxAbs(tri, (k) => 1 - 2 * Math.abs(2 * frac(f * (k + 1) * DT) - 1));
  const rampErr = maxAbs(ramp, (k) => 1 - 2 * frac(f * (k + 1) * DT));
  // sine skew: the peak moves from a quarter cycle to just before the trough (one cycle at 0.5 Hz)
  const sines = slots([{ shape: 0, morph: 0, rate: 0.5 }, { shape: 0, morph: 1, rate: 0.5 }], Math.round(2 / DT) - 1);
  const [p0, p1] = sines.map((a) => {
    let best = 0;
    for (let k = 1; k < a.length; k++) if (a[k] > a[best]) best = k;
    return frac(f32(0.5) * (best + 1) * DT);
  });
  // S&H hold probability: 0 → new value every cycle, 1 → frozen
  const sh = slots([0, 0.5, 1].map((morph) => ({ shape: 4, morph, rate: 10 })), 7500); // 200 cycles
  const [s0, s5, s1] = sh.map((a) => {
    let c = 0;
    for (let k = 1; k < a.length; k++) if (a[k] !== a[k - 1]) c++;
    return c;
  });
  const cycles = Math.floor(f32(10) * 7500 * DT);
  const ok =
    Math.abs(d0 - 0.5) < 0.01 && Math.abs(d5 - 0.26) < 0.01 && Math.abs(d1 - 0.02) < 0.01 &&
    triErr < 1e-4 && rampErr < 1e-4 && Math.abs(p0 - 0.25) < 0.01 && Math.abs(p1 - 0.77) < 0.01 &&
    s0 >= cycles - 1 && s5 > cycles * 0.35 && s5 < cycles * 0.65 && s1 === 0;
  check(
    '5 morph per shape',
    ok,
    `PW ${d0.toFixed(3)}/${d5.toFixed(3)}/${d1.toFixed(3)} | saw→tri err ${triErr.toExponential(1)}, ramp err ${rampErr.toExponential(1)} | sine peak at ${p0.toFixed(3)} → ${p1.toFixed(3)} | S&H steps ${s0}/${s5}/${s1} of ${cycles}`,
  );
}

/* ---------- 6. smooth: one-pole slew, smooth² × 1 s ---------- */
{
  // square at 0.02 Hz: +1 for 25 s; the slew starts at 0
  const at = (smooth, sec) => {
    const k = Math.round(sec / DT) - 1;
    return capture(setup({ 'lfo1.on': 1, 'lfo1.shape': 3, 'lfo1.rate': 0.02, 'lfo1.smooth': smooth }), k + 1, ['lfo1']).vals.lfo1[k];
  };
  const tau1 = at(1, 1), tau05 = at(0.5, 0.25), none = at(0, DT);
  const target = 1 - Math.exp(-1);
  check(
    '6 smooth time constant',
    Math.abs(tau1 - target) < 0.01 && Math.abs(tau05 - target) < 0.01 && none === 1,
    `after τ: smooth 1 → ${tau1.toFixed(3)} (1 s), smooth 0.5 → ${tau05.toFixed(3)} (250 ms), want ${target.toFixed(3)}; smooth 0 → ${none}`,
  );
}

/* ---------- 7. rate sweep / rate modulation: no phase jumps ---------- */
{
  // a) base rate swept 0.01 → 40 Hz (exponential) over 20 s, new value every block
  const env = setup({ 'lfo1.on': 1 });
  const blocks = Math.round((20 * FS) / BLOCK);
  const rateAt = (k) => f32(0.01 * Math.pow(4000, k / (blocks - 1)));
  const { vals } = capture(env, blocks, ['lfo1'], (k) => {
    env.v[idx('lfo1.rate')] = rateAt(k);
    env.sendBase();
  });
  let acc = 0, err = 0, jump = 0;
  for (let k = 0; k < blocks; k++) {
    acc = frac(acc + DT * rateAt(k));
    err = Math.max(err, Math.abs(vals.lfo1[k] - Math.sin(2 * Math.PI * acc)));
    // a sine can't move further than 2π × phase step per block
    if (k > 0) jump = Math.max(jump, Math.abs(vals.lfo1[k] - vals.lfo1[k - 1]) / (2 * Math.PI * rateAt(k) * DT));
  }

  // b) rate modulated by another LFO (route lfo2 → lfo1.rate): integrate the effective rate
  const env2 = setup({ 'lfo1.on': 1, 'lfo1.rate': 4, 'lfo2.on': 1, 'lfo2.rate': 0.3, 'lfo2.shape': 1 }, [['lfo2', 'lfo1.rate', 0.6]]);
  const b2 = Math.round((10 * FS) / BLOCK);
  const iRate = idx('lfo1.rate');
  const effRate = new Float64Array(b2);
  const r2 = capture(env2, b2, ['lfo1'], (k) => k > 0 && (effRate[k - 1] = env2.proc.mod.eff[iRate]));
  effRate[b2 - 1] = env2.proc.mod.eff[iRate];
  let acc2 = 0, err2 = 0, jump2 = 0, lo = Infinity, hi = 0;
  for (let k = 0; k < b2; k++) {
    acc2 = frac(acc2 + DT * effRate[k]);
    err2 = Math.max(err2, Math.abs(r2.vals.lfo1[k] - Math.sin(2 * Math.PI * acc2)));
    if (k > 0) jump2 = Math.max(jump2, Math.abs(r2.vals.lfo1[k] - r2.vals.lfo1[k - 1]) / (2 * Math.PI * effRate[k] * DT));
    lo = Math.min(lo, effRate[k]);
    hi = Math.max(hi, effRate[k]);
  }
  check(
    '7 rate sweep / rate mod without jumps',
    err < 1e-4 && jump <= 1.0001 && err2 < 1e-4 && jump2 <= 1.0001 && hi / lo > 10,
    `sweep 0.01→40 Hz: phase err ${err.toExponential(1)}, max step ${(jump * 100).toFixed(1)}% of bound | modulated ${lo.toFixed(2)}..${hi.toFixed(2)} Hz: err ${err2.toExponential(1)}, max step ${(jump2 * 100).toFixed(1)}%`,
  );
}

/* ---------- 8. reset trigger via a trigger route (lfo2.cycle → lfo1.reset) ---------- */
{
  // free: lfo1 is a slow saw restarted by lfo2's cycle
  const env = setup({ 'lfo1.on': 1, 'lfo1.shape': 2, 'lfo1.rate': 0.4, 'lfo2.on': 1, 'lfo2.rate': 2.3 }, [], [['lfo2.cycle', 'lfo1.reset']]);
  const blocks = Math.round((10 * FS) / BLOCK);
  const { vals, cyc } = capture(env, blocks, ['lfo1', 'lfo2']);
  const r1 = f32(0.4);
  const resets = new Set(cyc.lfo2);
  let acc = 0, err = 0;
  for (let k = 0; k < blocks; k++) {
    acc = resets.has(k) ? DT * r1 : acc + DT * r1;
    err = Math.max(err, Math.abs(vals.lfo1[k] - (2 * frac(acc) - 1)));
  }
  const sameBlock = cyc.lfo2.every((k) => cyc.lfo1.includes(k));

  // sync: lfo1 locked to 1/4 at 137 BPM, re-anchored at the beat position of every reset
  const env2 = setup(
    { 'clock.bpm': 137, 'lfo1.on': 1, 'lfo1.sync': 1, 'lfo1.div': divIndex('1/4'), 'lfo1.phase': 0.1, 'lfo2.on': 1, 'lfo2.rate': 0.77 },
    [],
    [['lfo2.cycle', 'lfo1.reset']],
  );
  const s = capture(env2, blocks, ['lfo1', 'lfo2']);
  const rs = new Set(s.cyc.lfo2);
  let anchor = 0, err2 = 0;
  for (let k = 0; k < blocks; k++) {
    if (rs.has(k)) anchor = s.beatsPrev[k];
    err2 = Math.max(err2, Math.abs(s.vals.lfo1[k] - Math.sin(2 * Math.PI * frac(s.beats[k] - anchor + 0.1))));
  }
  check(
    '8 reset via trigger route',
    cyc.lfo2.length >= 23 && err < 1e-4 && sameBlock && s.cyc.lfo2.length >= 7 && err2 < 1e-4,
    `free: ${cyc.lfo2.length} resets, saw err ${err.toExponential(1)}, lfo1.cycle on every reset: ${sameBlock} | sync: ${s.cyc.lfo2.length} re-anchors, err ${err2.toExponential(1)}`,
  );
}

/* ---------- 9. deterministic random + clock reset replays it ---------- */
{
  const mk = () =>
    setup({
      'lfo1.on': 1, 'lfo1.shape': 4, 'lfo1.rate': 9,
      'lfo2.on': 1, 'lfo2.shape': 5, 'lfo2.sync': 1, 'lfo2.div': divIndex('1/16'),
      'lfo3.on': 1, 'lfo3.shape': 4, 'lfo3.rate': 9,
    });
  const ids = ['lfo1', 'lfo2', 'lfo3'];
  const a = capture(mk(), 3000, ids);
  const b = capture(mk(), 3000, ids);
  const same = ids.every((id) => a.vals[id].every((x, i) => x === b.vals[id][i]));
  // after a clock reset the S&H line starts over
  const env = mk();
  const first = capture(env, 1000, ['lfo1']).vals.lfo1;
  env.proc.port.onmessage({ data: { type: 'clockReset' } });
  const again = capture(env, 1000, ['lfo1']).vals.lfo1;
  const replay = first.every((x, i) => x === again[i]);
  const distinct = new Set(a.vals.lfo1).size;
  const differ = a.vals.lfo1.some((x, i) => x !== a.vals.lfo3[i]); // every slot has its own seed
  check(
    '9 deterministic random',
    same && replay && distinct > 50 && differ,
    `identical runs: ${same}, replay after clock reset: ${replay}, ${distinct} S&H values, slots differ: ${differ}`,
  );
}

/* ---------- 10. stress: random settings every block, no NaN ---------- */
{
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ids = ['lfo1', 'lfo2', 'lfo3', 'lfo4'];
  const set = {};
  ids.forEach((id) => (set[`${id}.on`] = 1));
  const env = setup(set, [['lfo1', 'band3.res', 0.8], ['lfo2', 'lfo3.rate', 1], ['lfo3', 'band6.gain', -0.5]], [['lfo4.cycle', 'lfo1.reset']]);
  const pick = (k) => {
    if (k % 7) return;
    for (const id of ids) {
      env.v[idx(`${id}.shape`)] = Math.floor(rnd() * 6);
      env.v[idx(`${id}.rate`)] = rnd() < 0.1 ? 40 : 0.01 + rnd() * 40;
      env.v[idx(`${id}.sync`)] = rnd() < 0.3 ? 1 : 0;
      env.v[idx(`${id}.div`)] = Math.floor(rnd() * T.DIVISIONS.length);
      for (const p of ['phase', 'morph', 'smooth', 'level']) env.v[idx(`${id}.${p}`)] = rnd() < 0.2 ? Math.round(rnd()) : rnd();
      env.v[idx(`${id}.uni`)] = rnd() < 0.5 ? 1 : 0;
    }
    env.v[idx('clock.bpm')] = 20 + rnd() * 280;
    env.sendBase();
  };
  const r = capture(env, 8000, ids, pick);
  const inRange = ids.every((id) => r.vals[id].every((x) => Number.isFinite(x) && x >= -1 && x <= 1));
  check('10 stress: no NaN, in range', inRange && r.finite, `4 LFOs, settings changed every 7 blocks for ${(8000 * DT).toFixed(1)} s, audio finite: ${r.finite}`);
}

console.log('\nLFO tests');
console.table(results);
