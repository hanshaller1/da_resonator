// Offline tests for the clock mod (src/dsp/modules/cmod.ts), run inside the real worklet.
// Run: node scripts/test-cmod.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const S = importTs('src/shared/mod/sources.ts');
const T = importTs('src/shared/paramdefs/types.ts');
const C = importTs('src/dsp/modules/cmod.ts');

const idx = (id) => P.paramIndex(id);
const divIndex = (label) => T.DIVISION_LABELS.indexOf(label);
const MODE = { Divider: 0, Steps: 1, Euclid: 2, Random: 3 };
const STEP_OUT = S.TRIGGER_OUT_BY_ID['cmod1.step'].index;
const CYCLE_OUT = S.TRIGGER_OUT_BY_ID['lfo1.cycle'].index;
const SRC = S.SOURCE_BY_ID.cmod1.index;
const secBlocks = (s) => Math.round((s * FS) / BLOCK);

/**
 * Fresh processor with cmod1 on and the given param overrides. Records every block's cmod1 value and
 * every fired step (block index + clock position at the end of that block) by wrapping ctx.fire.
 */
function setup(over = {}, triggers = []) {
  const proc = loadProcessor();
  const v = P.defaultValues();
  v[idx('cmod1.on')] = 1;
  for (const [k, x] of Object.entries(over)) v[idx(k)] = x;
  proc.port.onmessage({ data: { type: 'params', values: v } });
  if (triggers.length) proc.port.onmessage({ data: { type: 'modConfig', config: { routes: [], triggers } } });
  const mod = proc.mod;
  const rec = { proc, v, mod, block: 0, fires: [], cycles: [], vals: [], beats: [] };
  const fire = mod.ctx.fire;
  mod.ctx.fire = function (o) {
    if (o === STEP_OUT) rec.fires.push({ block: rec.block, beats: mod.clock.beats });
    if (o === CYCLE_OUT) rec.cycles.push({ block: rec.block, beatsPrev: mod.clock.beatsPrev });
    return fire.call(this, o);
  };
  rec.run = (blocks) =>
    run(proc, blocks, () => 0, () => {
      rec.vals.push(mod.srcVals[SRC]);
      rec.beats.push(mod.clock.beats);
      rec.block++;
    });
  rec.set = (over2) => {
    for (const [k, x] of Object.entries(over2)) v[idx(k)] = x;
    proc.port.onmessage({ data: { type: 'params', values: v } });
  };
  return rec;
}

/** sample index of the end of block b */
const blockEnd = (b) => (b + 1) * BLOCK;

/* ---------- 1. step timing: every step within one block of its ideal time, no drift after 60 s ---------- */
for (const [bpm, div] of [[120, '1/16'], [97, '1/16'], [97, '1/8T'], [133, '1/4D']]) {
  const r = setup({ 'clock.bpm': bpm, 'cmod1.div': divIndex(div) });
  const blocks = secBlocks(60);
  r.run(blocks);
  const D = T.DIVISIONS[divIndex(div)].beats;
  const stepSamples = (D * 60 * FS) / bpm;
  let worst = 0, bad = 0;
  r.fires.forEach((f, k) => {
    const late = blockEnd(f.block) - k * stepSamples; // 0..one block (step 0 fires in the first block)
    if (late < -1e-6 || late > BLOCK + 1e-6) bad++;
    worst = Math.max(worst, late);
  });
  const expected = Math.floor(r.mod.clock.beats / D) + 1;
  const last = r.fires.at(-1);
  const lastLate = blockEnd(last.block) - (r.fires.length - 1) * stepSamples;
  check(
    `1 timing ${bpm} BPM ${div}, 60 s`,
    bad === 0 && r.fires.length === expected,
    `${r.fires.length}/${expected} steps, worst lateness ${worst.toFixed(1)} smp (≤ ${BLOCK}), last step ${lastLate.toFixed(1)} smp late`,
  );
}

/* ---------- 2. divider gate: high for the first half of each step ---------- */
{
  const r = setup({ 'clock.bpm': 120, 'cmod1.div': divIndex('1/8') });
  r.run(secBlocks(10));
  const hi = r.vals.filter((x) => x > 0.5).length;
  let rises = 0;
  for (let i = 1; i < r.vals.length; i++) if (r.vals[i] > 0.5 && r.vals[i - 1] < 0.5) rises++;
  const duty = hi / r.vals.length;
  check('2 divider gate 50 %', Math.abs(duty - 0.5) < 0.01 && rises === r.fires.length - 1 && r.vals.every((x) => x === 0 || x === 1), `duty ${(duty * 100).toFixed(1)} %, ${rises + 1} gates for ${r.fires.length} steps`);
}

/* ---------- 3. Euclid patterns (Bjorklund) + rotation ---------- */
{
  const str = (steps, pulses, rot = 0) => Array.from({ length: steps }, (_, i) => (C.euclidHit(steps, pulses, rot, i) ? 'x' : '.')).join('');
  const cases = [
    ['E(3,8)', str(8, 3), 'x..x..x.'],
    ['E(5,16)', str(16, 5), 'x..x..x..x..x...'],
    ['E(5,8)', str(8, 5), 'x.xx.xx.'],
    ['E(2,5)', str(5, 2), 'x.x..'],
    ['E(3,8) rot 1', str(8, 3, 1), '.x..x..x'],
    ['E(3,8) rot 3', str(8, 3, 3), '.x.x..x.'],
    ['E(0,8)', str(8, 0), '........'],
    ['E(8,8)', str(8, 8), 'xxxxxxxx'],
  ];
  const wrong = cases.filter(([, got, want]) => got !== want).map(([n, got, want]) => `${n}: ${got} ≠ ${want}`);
  check('3a Euclid patterns', wrong.length === 0, wrong.length ? wrong.join('; ') : cases.map(([n, g]) => `${n} ${g}`).join(' | '));

  // in the worklet: fired steps over two cycles follow the pattern
  const pattern = (steps, pulses, rot) => {
    const r = setup({ 'clock.bpm': 120, 'cmod1.mode': MODE.Euclid, 'cmod1.div': divIndex('1/16'), 'cmod1.steps': steps - 1, 'cmod1.pulses': pulses, 'cmod1.rotate': rot });
    const D = 0.25;
    r.run(Math.ceil(((2 * steps * D * 60) / 120) * (FS / BLOCK)) - 1);
    const hits = new Set(r.fires.map((f) => Math.floor(f.beats / D + 1e-9)));
    return Array.from({ length: 2 * steps }, (_, k) => (hits.has(k) ? 'x' : '.')).join('');
  };
  const p38 = pattern(8, 3, 0), p516 = pattern(16, 5, 0), p38r = pattern(8, 3, 2);
  check(
    '3b Euclid in the worklet',
    p38 === 'x..x..x.x..x..x.' && p516 === 'x..x..x..x..x...x..x..x..x..x...' && p38r === 'x.x..x..x.x..x..',
    `E(3,8) ${p38} | E(5,16) ${p516} | E(3,8) rot 2 ${p38r}`,
  );
}

/* ---------- 4. Steps mode: value = step K, `steps` long; bipolar mapping ---------- */
{
  const vals = [0.1, 0.3, 0.6, 0.9, 0.05];
  const over = { 'clock.bpm': 120, 'cmod1.mode': MODE.Steps, 'cmod1.div': divIndex('1/8'), 'cmod1.steps': 4 - 1 };
  vals.forEach((x, s) => (over[`cmod1.step${s}`] = x));
  const r = setup(over);
  r.run(secBlocks(6));
  const D = 0.5;
  let bad = 0;
  for (let b = 0; b < r.vals.length; b++) {
    const want = vals[Math.floor(r.beats[b] / D) % 4];
    if (Math.abs(r.vals[b] - want) > 1e-6) bad++;
  }
  const r2 = setup({ ...over, 'cmod1.uni': 0, 'cmod1.level': 0.5 });
  r2.run(secBlocks(2));
  const lo = Math.min(...r2.vals), hi = Math.max(...r2.vals);
  check(
    '4 steps mode values',
    bad === 0 && Math.abs(lo - 0.5 * (2 * 0.1 - 1)) < 1e-6 && Math.abs(hi - 0.5 * (2 * 0.9 - 1)) < 1e-6,
    `${r.vals.length - bad}/${r.vals.length} blocks match step K (4 of 5 steps used); bipolar × 0.5: ${lo.toFixed(3)}..${hi.toFixed(3)}`,
  );
}

/* ---------- 5. probability ---------- */
{
  const base = { 'clock.bpm': 120, 'cmod1.div': divIndex('1/16') };
  const r0 = setup({ ...base, 'cmod1.prob': 0 });
  r0.run(secBlocks(10));
  const r1 = setup({ ...base, 'cmod1.prob': 1 });
  r1.run(secBlocks(10));
  const rh = setup({ ...base, 'cmod1.prob': 0.5 });
  rh.run(secBlocks(10));
  const rh2 = setup({ ...base, 'cmod1.prob': 0.5 });
  rh2.run(secBlocks(10));
  const n = r1.fires.length;
  const n1 = Math.floor(r1.mod.clock.beats / 0.25) + 1;
  const same = rh.fires.length === rh2.fires.length && rh.fires.every((f, i) => f.block === rh2.fires[i].block);
  check(
    '5 probability 0 / 1 / 0.5',
    r0.fires.length === 0 && r0.vals.every((x) => x === 0) && n === n1 && rh.fires.length > 0.35 * n && rh.fires.length < 0.65 * n && same,
    `prob 0: ${r0.fires.length} fires, prob 1: ${n}/${n1}, prob 0.5: ${rh.fires.length} (deterministic: ${same})`,
  );
}

/* ---------- 6. swing: odd steps late by swing × half a step ---------- */
{
  const r = setup({ 'clock.bpm': 120, 'cmod1.div': divIndex('1/16'), 'cmod1.swing': 0.5 });
  r.run(secBlocks(10));
  const stepSamples = 0.25 * FS * 0.5; // 1/16 at 120 BPM = 6000 samples
  let bad = 0;
  r.fires.forEach((f, k) => {
    const ideal = (k + (k % 2 ? 0.25 : 0)) * stepSamples;
    const late = blockEnd(f.block) - ideal;
    if (late < -1e-6 || late > BLOCK + 1e-6) bad++;
  });
  const n = C.swungStep(r.mod.clock.beats / 0.25, 0.5) + 1;
  const g01 = (r.fires[1].block - r.fires[0].block) * BLOCK, g12 = (r.fires[2].block - r.fires[1].block) * BLOCK;
  check('6 swing 0.5', bad === 0 && r.fires.length === n, `${r.fires.length}/${n} steps on the swung grid (odd steps +1500 smp); gaps ≈ ${g01} / ${g12} smp (ideal 7500 / 4500)`);
}

/* ---------- 7. reset trigger (LFO cycle → cmod reset) ---------- */
{
  const vals = [0.8, 0.2, 0.4, 0.6];
  const over = { 'clock.bpm': 120, 'cmod1.mode': MODE.Steps, 'cmod1.div': divIndex('1/8'), 'cmod1.steps': 3, 'lfo1.on': 1, 'lfo1.rate': 0.7 };
  vals.forEach((x, s) => (over[`cmod1.step${s}`] = x));
  const r = setup(over, [{ src: CYCLE_OUT, dst: S.TRIGGER_IN_BY_ID['cmod1.reset'].index }]);
  r.run(secBlocks(6));
  const stepSamples = 0.5 * FS * 0.5; // 1/8 at 120 BPM
  let bad = 0, checked = 0;
  for (const c of r.cycles) {
    if (!r.fires.some((f) => f.block === c.block)) bad++; // step 1 fires in the reset block
    if (Math.abs(r.vals[c.block] - vals[0]) > 1e-6) bad++; // and outputs step 1
    // following steps are on a grid that starts at the reset block
    const next = r.fires.filter((f) => f.block > c.block).slice(0, 3);
    next.forEach((f, i) => {
      const late = blockEnd(f.block) - (c.block * BLOCK + (i + 1) * stepSamples);
      checked++;
      if ((late < -1e-6 || late >= BLOCK) && !r.cycles.some((c2) => c2.block > c.block && c2.block <= f.block)) bad++;
    });
  }
  check('7 reset trigger restarts at step 1', r.cycles.length >= 3 && bad === 0, `${r.cycles.length} resets, ${checked} steps after them checked`);
}

/* ---------- 8. clock.run off stops stepping ---------- */
{
  const r = setup({ 'clock.bpm': 120, 'cmod1.mode': MODE.Random, 'cmod1.div': divIndex('1/16') });
  r.run(secBlocks(2));
  const before = r.fires.length;
  r.set({ 'clock.run': 0 });
  const mark = r.vals.length;
  r.run(secBlocks(2));
  const stopped = r.fires.length - before;
  const frozen = r.vals.slice(mark + 1).every((x) => x === r.vals[mark + 1]);
  r.set({ 'clock.run': 1 });
  r.run(secBlocks(1));
  const resumed = r.fires.length - before;
  check('8 clock.run off', stopped === 0 && frozen && resumed >= 7, `${before} steps, then ${stopped} while stopped (value frozen: ${frozen}), ${resumed} after restart`);
}

/* ---------- 9. random S&H and slew ---------- */
{
  const r = setup({ 'clock.bpm': 120, 'cmod1.mode': MODE.Random, 'cmod1.div': divIndex('1/8') });
  r.run(secBlocks(10));
  let changes = 0;
  for (let i = 1; i < r.vals.length; i++) if (r.vals[i] !== r.vals[i - 1]) changes++;
  const inRange = r.vals.every((x) => x >= 0 && x <= 1);
  const spread = Math.max(...r.vals) - Math.min(...r.vals);

  // slew: alternate 0 / 1, value just before the next step
  const over = { 'clock.bpm': 120, 'cmod1.mode': MODE.Steps, 'cmod1.div': divIndex('1/4'), 'cmod1.steps': 1, 'cmod1.step0': 0, 'cmod1.step1': 1 };
  const glide = (slew) => {
    const s = setup({ ...over, 'cmod1.slew': slew });
    s.run(secBlocks(2));
    const stepBlocks = (0.5 * FS) / BLOCK; // 1/4 at 120 BPM = 187.5 blocks
    const b0 = Math.floor(stepBlocks); // block in which step 2 (value 1) starts
    return { first: s.vals[b0], end: s.vals[Math.floor(2 * stepBlocks) - 2], mid: s.vals[Math.round(b0 + stepBlocks / 2)] };
  };
  const g0 = glide(0), g1 = glide(1), gh = glide(0.5);
  check(
    '9 random S&H, slew',
    changes === r.fires.length - 1 && inRange && spread > 0.5 && g0.first === 1 && g1.first < 0.1 && g1.end > 0.95 && g1.end < 1 && gh.mid > 0.97,
    `${changes + 1} values for ${r.fires.length} steps; slew 0 → ${g0.first}; slew 1: ${g1.first.toFixed(3)} → ${g1.end.toFixed(3)} after a step; slew 0.5: ${gh.mid.toFixed(3)} at half a step`,
  );
}

/* ---------- 10. no NaN under random settings (fuzz) ---------- */
{
  const r = setup({ 'cmod2.on': 1 });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const all = [];
  const ids = ['mode', 'div', 'steps', 'pulses', 'rotate', 'prob', 'swing', 'slew', 'level', 'uni'];
  for (let round = 0; round < 200; round++) {
    const over = { 'clock.bpm': 20 + rnd() * 280, 'clock.run': rnd() < 0.9 ? 1 : 0 };
    for (const n of [1, 2])
      for (const id of ids) {
        const spec = P.PARAM_BY_ID[`cmod${n}.${id}`];
        const x = spec.min + rnd() * (spec.max - spec.min);
        over[`cmod${n}.${id}`] = spec.curve === 'discrete' || spec.curve === 'toggle' ? Math.round(x) : x;
      }
    r.set(over);
    if (round % 50 === 0) r.proc.port.onmessage({ data: { type: 'clockReset' } });
    r.run(20);
    all.push(r.mod.srcVals[SRC], r.mod.srcVals[SRC + 1]);
  }
  const ok = r.vals.every((x) => Number.isFinite(x) && Math.abs(x) <= 1) && all.every(Number.isFinite);
  check('10 no NaN (fuzz, both slots)', ok, `${r.vals.length} blocks, ${r.fires.length} steps, all values finite and within ±1`);
}

console.log('\nClock mod tests');
console.table(results);
