// Integration tests: modules working together in the worklet (plan step I1).
// Run: node scripts/test-integration.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const R = importTs('src/shared/mod/routing.ts');
const S = importTs('src/shared/mod/sources.ts');
const idx = (id) => P.paramIndex(id);

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const noise = (amp) => () => amp * rnd();

/** values: {id: plain}; routes: [[source, target, depth]]; triggers: [[out, in]] */
function setup(values, routes = [], triggers = []) {
  const v = P.defaultValues();
  for (const [id, x] of Object.entries(values)) v[idx(id)] = x;
  const routing = new R.ModRouting();
  for (const [s, t, d] of routes) {
    const r = routing.addRoute(s, t);
    if (!r.depthParam) throw new Error(`route ${s} → ${t} refused: ${r.reason}`);
    v[idx(r.depthParam)] = d;
  }
  for (const [o, i] of triggers) {
    const c = routing.addTriggerRoute(o, i);
    if (!c.ok) throw new Error(`trigger ${o} → ${i} refused: ${c.reason}`);
  }
  const proc = loadProcessor();
  proc.port.onmessage({ data: { type: 'params', values: v } });
  proc.port.onmessage({ data: { type: 'modConfig', config: routing.config() } });
  return proc;
}
const frames = (proc) => proc.port.sent.filter((m) => m.type === 'mod');
const effOf = (f, id) => {
  for (let k = 0; k < f.mod.length; k += 2) if (f.mod[k] === idx(id)) return f.mod[k + 1];
  return null;
};
const srcOf = (f, id) => f.src[S.SOURCE_BY_ID[id].index];
function windowsRms(x, win) {
  const out = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += x[i + j] * x[i + j];
    out.push(Math.sqrt(s / win));
  }
  return out;
}

/* 1. LFO (square, 2 Hz) → post filter cutoff: brightness switches at the LFO rate */
{
  const proc = setup(
    { mix: 0, 'filterPost.on': 1, 'filterPost.type': 0, 'filterPost.cutoff': 1000, 'lfo1.on': 1, 'lfo1.shape': 3, 'lfo1.rate': 2 },
    [['lfo1', 'filterPost.cutoff', 0.35]],
  );
  const { L } = run(proc, Math.round((2 * FS) / BLOCK), noise(0.3));
  const w = windowsRms(L.subarray(FS / 4), FS / 20).map((x) => 20 * Math.log10(x + 1e-12));
  const hi = Math.max(...w), lo = Math.min(...w);
  let flips = 0;
  const mid = (hi + lo) / 2;
  for (let i = 1; i < w.length; i++) if ((w[i] > mid) !== (w[i - 1] > mid)) flips++;
  check('1 LFO → post filter cutoff', hi - lo > 6 && flips >= 5 && flips <= 8, `level swing ${(hi - lo).toFixed(1)} dB, ${flips} flips in 1.75 s (2 Hz square ≈ 7)`);
}

/* 2. env follower (input) → band dynamics threshold */
{
  const proc = setup(
    { 'dyn.on': 1, 'ef1.on': 1, 'ef1.tap': 0, 'ef1.attack': 5, 'ef1.release': 50 },
    [['ef1', 'dyn.threshold', -0.5]],
  );
  run(proc, Math.round((2 * FS) / BLOCK), (n) => (Math.floor(n / (FS / 4)) % 2 ? 0.5 : 0.01) * Math.sin(n * 0.05));
  const f = frames(proc);
  const thr = f.map((x) => effOf(x, 'dyn.threshold'));
  const ef = f.map((x) => srcOf(x, 'ef1'));
  check(
    '2 env follower → dynamics threshold',
    // threshold norm = base (−18 dB → 0.7) − 0.5 × ef1
    Math.max(...ef) > 0.8 && f.every((x, i) => Math.abs(thr[i] - (0.7 - 0.5 * ef[i])) < 0.01),
    `ef1 ${Math.min(...ef).toFixed(2)}..${Math.max(...ef).toFixed(2)}, threshold (norm) ${Math.min(...thr).toFixed(2)}..${Math.max(...thr).toFixed(2)}`,
  );
}

/* 3. clock mod step → LFO reset: a very slow saw restarts on every step */
{
  const base = { 'lfo1.on': 1, 'lfo1.shape': 2, 'lfo1.rate': 0.05, 'cmod1.on': 1, 'cmod1.mode': 0, 'cmod1.div': 10 /* 1/4 */ };
  const withReset = setup(base, [], [['cmod1.step', 'lfo1.reset']]);
  const free = setup(base);
  const blocks = Math.round((4 * FS) / BLOCK);
  run(withReset, blocks);
  run(free, blocks);
  const maxReset = Math.max(...frames(withReset).map((f) => srcOf(f, 'lfo1')));
  const maxFree = Math.max(...frames(free).map((f) => srcOf(f, 'lfo1')));
  check('3 clock mod step → LFO reset', maxReset < -0.94 && maxFree > -0.65, `saw max with resets ${maxReset.toFixed(3)}, without ${maxFree.toFixed(3)}`);
}

/* 4. macro → LFO rate and → depth of the LFO's route at the same time */
{
  const proc = setup({ 'lfo1.on': 1, 'lfo1.rate': 0.5, 'macro1.value': 0 }, [
    ['lfo1', 'band4.res', 0],
    ['macro1', 'lfo1.rate', 0.5],
    ['macro1', 'route0.depth', 0.5],
  ]);
  run(proc, 200);
  const swing0 = (() => { const e = frames(proc).slice(-30).map((f) => effOf(f, 'band4.res')); return Math.max(...e) - Math.min(...e); })();
  const v = P.defaultValues();
  Object.entries({ 'lfo1.on': 1, 'lfo1.rate': 0.5, 'macro1.value': 1, 'route0.depth': 0, 'route1.depth': 0.5, 'route2.depth': 0.5 }).forEach(([k, x]) => (v[idx(k)] = x));
  proc.port.onmessage({ data: { type: 'params', values: v } });
  proc.port.sent.length = 0;
  run(proc, 400);
  const f = frames(proc);
  const e = f.map((x) => effOf(x, 'band4.res'));
  const rate = f.map((x) => effOf(x, 'lfo1.rate')).at(-1);
  check('4 macro → LFO rate + route depth', swing0 < 0.001 && Math.max(...e) - Math.min(...e) > 0.5 && rate > 0.9, `swing ${swing0.toFixed(3)} → ${(Math.max(...e) - Math.min(...e)).toFixed(3)}, rate norm ${rate.toFixed(2)}`);
}

/* 5. feedback through audio: EF on the output → band resonance + feedback, 10 s, stays bounded */
{
  const proc = setup(
    { 'ef1.on': 1, 'ef1.tap': P.NUM_BANDS + 2, 'ef1.attack': 1, 'ef1.release': 30, 'band3.fb': 0.9, 'fbAllOn': 1, fbAll: 0.9, 'dyn.on': 1 },
    [['ef1', 'band3.res', 1], ['ef1', 'band3.fb', 1], ['ef1', 'fbAll', 1]],
  );
  const { L, R } = run(proc, Math.round((10 * FS) / BLOCK), noise(0.5));
  let peak = 0, finite = true;
  for (let i = 0; i < L.length; i++) {
    if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) finite = false;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  check('5 audio feedback loop (EF out → resonator)', finite && peak <= 1, `finite ${finite}, peak ${peak.toFixed(3)}`);
}

/* 6. worst case CPU: every module on, 64 routes, feedback, dynamics, two 24 dB filters with drive */
{
  const vals = { fbAllOn: 1, fbAll: 0.6, spread: 0.5, 'dyn.on': 1, 'dyn.threshold': -30 };
  for (const f of ['filterPre', 'filterPost']) Object.assign(vals, { [`${f}.on`]: 1, [`${f}.slope`]: 1, [`${f}.drive`]: 12, [`${f}.res`]: 0.5, [`${f}.cutoff`]: 3000 });
  for (let n = 1; n <= 4; n++) Object.assign(vals, { [`lfo${n}.on`]: 1, [`lfo${n}.rate`]: 0.3 * n, [`lfo${n}.shape`]: n % 6, [`ef${n}.on`]: 1, [`ef${n}.tap`]: n * 3 });
  for (let n = 1; n <= 2; n++) Object.assign(vals, { [`cmod${n}.on`]: 1, [`cmod${n}.mode`]: n });
  for (let b = 0; b < P.NUM_BANDS; b++) vals[`band${b}.fb`] = 0.5;
  const srcs = ['lfo1', 'lfo2', 'lfo3', 'lfo4', 'cmod1', 'cmod2', 'ef1', 'ef2', 'ef3', 'ef4', 'macro1', 'macro2'];
  const targets = P.PARAMS.filter((p) => ['resonator', 'filter', 'dyn'].includes(p.modClass) && p.modulatable && p.curve !== 'discrete' && p.curve !== 'toggle').map((p) => p.id);
  const routes = [];
  for (let k = 0; routes.length < 64 && k < 500; k++) routes.push([srcs[k % srcs.length], targets[(k * 7) % targets.length], 0.2]);
  const routing = new R.ModRouting();
  const valid = routes.filter(([s, t]) => routing.addRoute(s, t).depthParam);
  const proc = setup(vals, valid.slice(0, 64));
  const blocks = Math.round((10 * FS) / BLOCK);
  const iL = new Float32Array(BLOCK), iR = new Float32Array(BLOCK), oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
  for (let s = 0; s < BLOCK; s++) { iL[s] = rnd() * 0.3; iR[s] = rnd() * 0.3; }
  for (let k = 0; k < 400; k++) proc.process([[iL, iR]], [[oL, oR]]);
  let ms = Infinity;
  for (let runN = 0; runN < 3; runN++) {
    const t0 = performance.now();
    for (let k = 0; k < blocks; k++) proc.process([[iL, iR]], [[oL, oR]]);
    ms = Math.min(ms, performance.now() - t0);
  }
  const x = 10000 / ms;
  check('6 worst case CPU (all modules, 64 routes)', x > 8 && oL.every(Number.isFinite), `${Math.min(64, valid.length)} routes, ${ms.toFixed(0)} ms for 10 s → ${x.toFixed(1)}x realtime (best of 3)`);
}

/* 7. determinism: the same patch renders bit-identical twice */
{
  const vals = { 'lfo1.on': 1, 'lfo1.shape': 4, 'cmod1.on': 1, 'cmod1.mode': 3, 'ef1.on': 1, 'dyn.on': 1, 'filterPre.on': 1, 'band2.fb': 0.95 };
  const routes = [['lfo1', 'band2.res', 0.3], ['cmod1', 'filterPre.cutoff', -0.4], ['ef1', 'spread', 0.5]];
  seed = 99;
  const a = run(setup(vals, routes), 600, noise(0.3)).L;
  seed = 99;
  const b = run(setup(vals, routes), 600, noise(0.3)).L;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
  check('7 deterministic render', diff === 0, `max diff ${diff}`);
}

/* 8. every factory preset renders: finite, bounded, audible (pulses-like input) */
{
  const F = importTs('src/presets/factory.ts');
  const bad = [];
  const info = [];
  for (const pr of F.factoryPresets()) {
    const v = P.defaultValues();
    for (const [id, x] of Object.entries(pr.snapshot.params)) v[idx(id)] = x;
    const routing = new R.ModRouting();
    const dropped = routing.load(pr.snapshot.routes, pr.snapshot.triggers);
    const proc = loadProcessor();
    proc.port.onmessage({ data: { type: 'params', values: v } });
    proc.port.onmessage({ data: { type: 'modConfig', config: routing.config() } });
    seed = 7;
    const { L, R: Rr } = run(proc, Math.round((4 * FS) / BLOCK), (n) => (n % 24000 < 2400 ? noise(0.5)() * (1 - (n % 24000) / 2400) : 0));
    let peak = 0, sq = 0, finite = true;
    for (let i = 0; i < L.length; i++) {
      if (!Number.isFinite(L[i] + Rr[i])) finite = false;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
      sq += L[i] * L[i];
    }
    const rmsDb = 10 * Math.log10(sq / L.length + 1e-20);
    info.push(`${pr.name} ${rmsDb.toFixed(0)}`);
    if (!finite || peak > 1 || rmsDb < -60 || dropped.length) bad.push(`${pr.name} (finite ${finite}, peak ${peak.toFixed(2)}, ${rmsDb.toFixed(1)} dB, dropped ${dropped.length})`);
  }
  check('8 factory presets render', bad.length === 0, bad.length ? bad.join('; ') : info.join(', ') + ' dBFS');
}

console.log('\nIntegration tests');
console.table(results);
