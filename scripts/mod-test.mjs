// Offline tests for the modulation system: rules / loop checks (shared/mod) and the worklet ModEngine.
// Run: node scripts/mod-test.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const R = importTs('src/shared/mod/routing.ts');
const S = importTs('src/shared/mod/sources.ts');

/* ---------- 1. rules ---------- */
{
  const r = new R.ModRouting();
  const ok = (s, t) => r.canRoute(s, t).ok;
  const cases = [
    ['macro1 → band3.res', ok('macro1', 'band3.res'), true],
    ['lfo1 → lfo1.rate (self)', ok('lfo1', 'lfo1.rate'), false],
    ['lfo1 → lfo2.rate', ok('lfo1', 'lfo2.rate'), true],
    ['lfo1 → bypass (toggle)', ok('lfo1', 'bypass'), false],
    ['lfo1 → macro2.value', ok('lfo1', 'macro2.value'), false],
    ['lfo1 → clock.bpm', ok('lfo1', 'clock.bpm'), false],
    ['macro1 → clock.bpm', ok('macro1', 'clock.bpm'), true],
    ['lfo1 → lfo2.shape (discrete)', ok('lfo1', 'lfo2.shape'), false],
    ['cmod1 → lfo2.shape (discrete)', ok('cmod1', 'lfo2.shape'), true],
    ['dyn3 → dyn.threshold', ok('dyn3', 'dyn.threshold'), false],
    ['dyn3 → band2.gain', ok('dyn3', 'band2.gain'), true],
    ['ef1 → route0.depth', ok('ef1', 'route0.depth'), true],
  ];
  const bad = cases.filter(([, got, want]) => got !== want).map(([n]) => n);
  check('1 class rules (4.2 matrix)', bad.length === 0, bad.length ? 'wrong: ' + bad.join(', ') : `${cases.length} cases`);

  // loops: lfo1 → lfo2.rate, then lfo2 → lfo1.rate must be refused, also via a route depth and via ef
  r.addRoute('lfo1', 'lfo2.rate');
  const direct = r.canRoute('lfo2', 'lfo1.rate');
  r.addRoute('lfo2', 'ef1.attack');
  const indirect = r.canRoute('ef1', 'lfo1.phase');
  const added = r.addRoute('macro1', 'band0.res');
  const viaDepth = r.canRoute('ef1', `route${added.slot}.depth`); // fine: route of macro1 → band0
  r.addRoute('lfo3', 'band1.res');
  const lfo3Route = r.routes().find((x) => x.source === 'lfo3');
  const ownDepth = r.canRoute('lfo3', lfo3Route.depthParam); // lfo3 → depth of its own route: no loop (lfo3 → route B → route A)
  check(
    '2 loop detection',
    !direct.ok && !indirect.ok && viaDepth.ok && ownDepth.ok,
    `direct: ${direct.reason ?? 'ok?'} | indirect: ${indirect.reason ?? 'ok?'} | own route depth allowed: ${ownDepth.ok}`,
  );

  const t1 = r.canTriggerRoute('cmod1.step', 'lfo1.reset');
  const t2 = r.canTriggerRoute('lfo1.cycle', 'lfo1.reset');
  r.addTriggerRoute('lfo1.cycle', 'cmod1.reset');
  const t3 = r.canTriggerRoute('cmod1.step', 'lfo1.reset');
  check('3 trigger routes', t1.ok && !t2.ok && !t3.ok, `own reset: ${t2.reason} | loop: ${t3.reason}`);

  const snap = r.routes();
  const r2 = new R.ModRouting();
  const dropped = r2.load([...snap, { source: 'lfo2', target: 'lfo1.rate' }], r.triggerRoutes());
  check('4 load drops loops', dropped.length === 1 && r2.routes().length === snap.length, `dropped ${dropped.join(', ')}`);
}

/* ---------- worklet helpers ---------- */
const base = () => P.defaultValues();
const idx = (id) => P.paramIndex(id);
const send = (proc, values) => proc.port.onmessage({ data: { type: 'params', values } });
const config = (routes, triggers = []) => ({
  routes: routes.map(([slot, src, dst]) => ({ slot, src: S.SOURCE_BY_ID[src].index, dst: idx(dst) })),
  triggers,
});
const modFrames = (proc) => proc.port.sent.filter((m) => m.type === 'mod');
const effOf = (frame, id) => {
  for (let k = 0; k < frame.mod.length; k += 2) if (frame.mod[k] === idx(id)) return frame.mod[k + 1];
  return null;
};

/* ---------- 5. LFO → band res: readout follows the LFO ---------- */
{
  const proc = loadProcessor();
  const v = base();
  v[idx('band3.res')] = 0.45; // mid travel, so ±0.3 stays inside the range
  v[idx('lfo1.on')] = 1;
  v[idx('lfo1.rate')] = 2;
  v[idx('route0.depth')] = 0.3;
  send(proc, v);
  proc.port.onmessage({ data: { type: 'modConfig', config: config([[0, 'lfo1', 'band3.res']]) } });
  run(proc, Math.round(FS / BLOCK)); // 1 s
  const frames = modFrames(proc);
  const effs = frames.map((f) => effOf(f, 'band3.res'));
  const lo = Math.min(...effs), hi = Math.max(...effs);
  const baseNorm = P.toNorm(P.PARAM_BY_ID['band3.res'], v[idx('band3.res')]);
  const srcs = frames.map((f) => f.src[S.SOURCE_BY_ID.lfo1.index]);
  check(
    '5 LFO → band res (readout)',
    frames.length >= 55 && Math.abs(hi - (baseNorm + 0.3)) < 0.02 && Math.abs(lo - (baseNorm - 0.3)) < 0.02 && Math.max(...srcs) > 0.98,
    `${frames.length} readouts/s, eff ${lo.toFixed(3)}..${hi.toFixed(3)} around ${baseNorm.toFixed(3)}`,
  );
}

/* ---------- 6. LFO → output gain is audible, at the LFO rate ---------- */
{
  const proc = loadProcessor();
  const v = base();
  v[idx('mix')] = 0; // dry only: the output is the input × output gain
  v[idx('outputGain')] = -12;
  v[idx('lfo1.on')] = 1;
  v[idx('lfo1.rate')] = 4;
  v[idx('route0.depth')] = 0.3;
  send(proc, v);
  proc.port.onmessage({ data: { type: 'modConfig', config: config([[0, 'lfo1', 'outputGain']]) } });
  const { L } = run(proc, Math.round(FS / BLOCK), (n) => 0.25 * Math.sin((2 * Math.PI * 1000 * n) / FS));
  // envelope per 5 ms window, count maxima of the envelope (≈ 4 per second)
  const win = 240, env = [];
  for (let i = 0; i + win <= L.length; i += win) {
    let m = 0;
    for (let j = 0; j < win; j++) m = Math.max(m, Math.abs(L[i + j]));
    env.push(m);
  }
  const e = env.slice(20);
  const lo = Math.min(...e), hi = Math.max(...e);
  let peaks = 0;
  for (let i = 1; i < e.length - 1; i++) if (e[i] > e[i - 1] && e[i] >= e[i + 1] && e[i] > (lo + hi) / 2 + 0.3 * (hi - lo)) peaks++;
  check('6 LFO → output gain audible', hi / lo > 4 && peaks >= 3 && peaks <= 5, `env ${lo.toFixed(3)}..${hi.toFixed(3)}, ${peaks} peaks in ~0.9 s`);
}

/* ---------- 7. macro modulates a route depth ---------- */
{
  const proc = loadProcessor();
  const v = base();
  v[idx('lfo1.on')] = 1;
  v[idx('lfo1.rate')] = 3;
  v[idx('route0.depth')] = 0; // route lfo1 → band2.res starts at depth 0 …
  v[idx('route1.depth')] = 1; // … macro1 → route0.depth at full depth
  v[idx('macro1.value')] = 0;
  send(proc, v);
  proc.port.onmessage({ data: { type: 'modConfig', config: config([[0, 'lfo1', 'band2.res'], [1, 'macro1', 'route0.depth']]) } });
  run(proc, 200);
  const spread = () => {
    const effs = modFrames(proc).slice(-50).map((f) => effOf(f, 'band2.res'));
    return Math.max(...effs) - Math.min(...effs);
  };
  const off = spread();
  v[idx('macro1.value')] = 0.5; // depth param: norm 0.5 (=0) + 0.5 → +1
  send(proc, v);
  run(proc, 400);
  const on = spread();
  check('7 macro → route depth', off < 0.001 && on > 0.5, `LFO swing on band2.res: macro 0 → ${off.toFixed(3)}, macro 0.5 → ${on.toFixed(3)}`);
}

/* ---------- 8. clock: tempo, sync, macro → tempo ---------- */
{
  const proc = loadProcessor();
  const v = base();
  v[idx('clock.bpm')] = 120;
  send(proc, v);
  const blocks = Math.round((10 * FS) / BLOCK);
  run(proc, blocks);
  const f = modFrames(proc).at(-1);
  const expected = (blocks * BLOCK * 120) / 60 / FS;
  check('8 clock 120 BPM, 10 s', Math.abs(f.beats - expected) < 1e-6, `beats ${f.beats.toFixed(6)} (expected ${expected.toFixed(6)})`);
}

/* ---------- 9. invalid config is ignored by the worklet ---------- */
{
  const proc = loadProcessor();
  const v = base();
  v[idx('lfo1.on')] = 1;
  v[idx('lfo2.on')] = 1;
  send(proc, v);
  proc.port.onmessage({ data: { type: 'modConfig', config: config([[0, 'lfo1', 'lfo2.rate'], [1, 'lfo2', 'lfo1.rate']]) } });
  const { L } = run(proc, 50, (n) => Math.sin(n * 0.05) * 0.3);
  const fr = modFrames(proc).at(-1);
  check('9 cyclic config rejected', fr.mod.length === 0 && L.every(Number.isFinite), 'worklet kept the previous (empty) config');
}

console.log('\nModulation tests');
console.table(results);
