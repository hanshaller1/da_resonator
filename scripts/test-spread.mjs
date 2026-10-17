// Offline tests for the bipolar SPREAD (2026-10-16): centre neutral, ODD/EVEN both ways, CLASSIC ±6 dB,
// the crossfade when the function switches, the v4 → v5 preset migration, the response picture and the
// L/R band meters beside the faders.
// Run: node scripts/test-spread.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const S = importTs('src/core/state.ts');
const R = importTs('src/ui/response.ts');
const idx = (id) => P.paramIndex(id);
const NB = P.NUM_BANDS;

let seed = 777;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const noise = () => 0.1 * rnd();
const ms = (x, a = 0, b = x.length) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return e / (b - a);
};
const db = (a, b) => 10 * Math.log10(a / b);
const skip = Math.round(0.3 * FS);

/** one band solo (others muted in L and R), spread and its function */
function values(band, spread, classic = 0) {
  const v = P.defaultValues();
  v[idx('analog')] = 0;
  v[idx('mix')] = 1;
  v[idx('spread')] = spread;
  v[idx('reso.spread')] = classic;
  for (let b = 0; b < NB; b++) {
    if (band !== null && b !== band) {
      v[idx(`band${b}.gain`)] = -60;
      v[idx(`band${b}.gainR`)] = -60;
    }
  }
  return v;
}
function render(v, seconds, input = noise, onBlock) {
  const proc = loadProcessor({ linkR: false });
  proc.port.onmessage({ data: { type: 'params', values: v } });
  return run(proc, Math.round((seconds * FS) / BLOCK), input, onBlock && ((k) => onBlock(proc, k)));
}
const level = (band, spread, classic) => {
  seed = 777;
  const o = render(values(band, spread, classic), 1);
  return { L: ms(o.L, skip), R: ms(o.R, skip), out: o };
};

/* ---------- 1. ODD/EVEN both ways ---------- */
{
  const c = level(4, 0); // band 5 (odd)
  const p = level(4, 1);
  const n = level(4, -1);
  const e = level(5, -1); // band 6 (even)
  check('1a centre: band 5 the same in L and R', Math.abs(db(c.L, c.R)) < 0.01, `L−R ${db(c.L, c.R).toFixed(3)} dB`);
  check('1b right stop: odd band 5 only in L, +3 dB', db(p.L, p.R) > 40 && Math.abs(db(p.L, c.L) - 3.01) < 0.1, `L−R ${db(p.L, p.R).toFixed(1)} dB, L ${db(p.L, c.L).toFixed(2)} dB`);
  check('1c left stop: odd band 5 only in R', db(n.R, n.L) > 40 && Math.abs(db(n.R, c.R) - 3.01) < 0.1, `R−L ${db(n.R, n.L).toFixed(1)} dB`);
  check('1d left stop: even band 6 only in L', db(e.L, e.R) > 40, `L−R ${db(e.L, e.R).toFixed(1)} dB`);
  const h = level(4, -0.5);
  const hp = level(4, 0.5);
  check('1e half left mirrors half right', Math.abs(db(h.R, hp.L)) < 0.05 && Math.abs(db(h.L, hp.R)) < 0.05, `R(−50%) vs L(+50%) ${db(h.R, hp.L).toFixed(3)} dB`);
}

/* ---------- 2. CLASSIC ---------- */
{
  const c0 = level(null, 0, 0);
  const c1 = level(null, 0, 1);
  const dmax = c0.out.L.reduce((m, x, i) => Math.max(m, Math.abs(x - c1.out.L[i]), Math.abs(c0.out.R[i] - c1.out.R[i])), 0);
  check('2a centre: CLASSIC and ODD/EVEN sound the same', dmax < 1e-6, `max diff ${dmax.toExponential(1)}`);
  const p = level(null, 1, 1);
  check('2b right stop: R +6 dB, L −6 dB', Math.abs(db(p.R, c1.R) - 6) < 0.05 && Math.abs(db(p.L, c1.L) + 6) < 0.05, `R ${db(p.R, c1.R).toFixed(2)} dB, L ${db(p.L, c1.L).toFixed(2)} dB`);
  const n = level(null, -0.5, 1);
  check('2c half left: L 6 dB over R', Math.abs(db(n.L, n.R) - 6) < 0.05, `L−R ${db(n.L, n.R).toFixed(2)} dB`);
  check('2d every band moves alike (not odd/even)', Math.abs(db(level(4, 1, 1).R, level(5, 1, 1).R) - db(level(4, 0, 1).R, level(5, 0, 1).R)) < 0.05);
}

/* ---------- 3. switching the function crossfades (no click) ---------- */
{
  const f = P.BAND_FREQS[4];
  const sine = (n) => 0.3 * Math.sin((2 * Math.PI * f * n) / FS);
  const v = values(4, 1, 0);
  const at = Math.round((0.6 * FS) / BLOCK);
  const out = render(v, 1.2, sine, (proc, k) => {
    if (k === at - 1) {
      const w = v.slice();
      w[idx('reso.spread')] = 1;
      proc.port.onmessage({ data: { type: 'params', values: w } });
    }
  });
  const maxDiff = (x, a, b) => {
    let m = 0;
    for (let n = a + 1; n < b; n++) m = Math.max(m, Math.abs(x[n] - x[n - 1]));
    return m;
  };
  const pos = at * BLOCK;
  let ok = true;
  const rows = [];
  for (const ch of ['L', 'R']) {
    const x = out[ch];
    const trans = maxDiff(x, pos, pos + 0.03 * FS);
    const settled = Math.max(maxDiff(x, pos - 0.1 * FS, pos), maxDiff(x, pos + 0.2 * FS, pos + 0.3 * FS));
    ok &&= trans <= settled * 1.05 + 0.002 && x.every(Number.isFinite);
    rows.push(`${ch} ${trans.toFixed(4)} ≤ ${settled.toFixed(4)}`);
  }
  check('3 ODD/EVEN → CLASSIC at the stop: no click', ok, rows.join(', '));
}

/* ---------- 4. presets: v4 → v5 ---------- */
{
  const old = {
    format: 'da-resonator',
    version: 4,
    params: { spread: 0.4, 'route0.depth': 0.6, 'route1.depth': 0.5 },
    routes: [{ slot: 0, source: 'lfo1', target: 'spread' }, { slot: 1, source: 'lfo2', target: 'mix' }],
  };
  const s = S.migrateSnapshot(old);
  check('4a v4 preset: spread value kept (right of centre)', s.params.spread === 0.4 && s.version === S.SNAPSHOT_VERSION);
  check('4b v4 preset: route onto spread at half depth, others unchanged', s.params['route0.depth'] === 0.3 && s.params['route1.depth'] === 0.5);
  check('4c v4 preset: function ODD/EVEN', s.params['reso.spread'] === 0);
  check('4f default function CLASSIC; a v6 preset without it takes CLASSIC', P.PARAM_BY_ID['reso.spread'].def === 1 && S.migrateSnapshot({ format: 'da-resonator', version: 6, params: {} }).params['reso.spread'] === 1);
  const F = importTs('src/presets/factory.ts');
  const list = F.FACTORY_PRESETS;
  const uses = (d) => (d.params?.spread ?? 0) !== 0 || d.routes?.some((r) => r.target === 'spread');
  check('4g factory presets that use SPREAD keep ODD/EVEN, the others take the default', list.length > 0 && list.every((d) => (uses(d) ? d.params?.['reso.spread'] === 0 : d.params?.['reso.spread'] === undefined)), `${list.filter(uses).length} of ${list.length} use SPREAD`);
  const again = S.migrateSnapshot(s);
  check('4d v5 preset: loads unchanged', again.params['route0.depth'] === 0.3);
  // the same LFO swing: norm offset × range
  const spec = P.PARAM_BY_ID.spread;
  check('4e range −1..1, centre 0', spec.min === -1 && spec.max === 1 && spec.def === 0 && P.formatValue(spec, 0.4) === '+40%' && P.formatValue(spec, -0.4) === '-40%');
}

/* ---------- 5. response picture ---------- */
{
  const store = (set) => ({ get: (id) => (id in set ? set[id] : P.PARAM_BY_ID[id].def) });
  const c = R.readModel(store({}), undefined, 0);
  const l = R.readModel(store({ spread: 1, 'reso.spread': 0 }), undefined, 0);
  const r = R.readModel(store({ spread: 1, 'reso.spread': 0 }), undefined, 1);
  const both0 = R.readModel(store({ 'reso.spread': 0 }), undefined, 'both');
  const both = R.readModel(store({ spread: 1, 'reso.spread': 0 }), undefined, 'both');
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check('5a ODD/EVEN right stop: L has the odd bands (+3 dB), R the even ones', near(l.gains[0], Math.SQRT2 * c.gains[0]) && near(l.gains[1], 0) && near(r.gains[0], 0) && near(r.gains[1], Math.SQRT2 * c.gains[1]));
  check('5b ODD/EVEN: the L+R average keeps its level', both.gains.every((g, i) => near(g, both0.gains[i])));
  const cl = R.readModel(store({ spread: -1, 'reso.spread': 1 }), undefined, 0);
  const cr = R.readModel(store({ spread: -1, 'reso.spread': 1 }), undefined, 1);
  check('5c CLASSIC left stop: L +6 dB, R −6 dB on every band', cl.gains.every((g, i) => Math.abs(20 * Math.log10(g / c.gains[i]) - 6) < 1e-6) && cr.gains.every((g, i) => Math.abs(20 * Math.log10(g / c.gains[i]) + 6) < 1e-6));
}

/* ---------- 6. L/R band meters beside the faders (after the fader and SPREAD) ---------- */
{
  /** mean square of a band's L and R meter frames after the settling time, and of the output */
  const meters = (band, set) => {
    seed = 777;
    const v = values(band, 0);
    for (const [k, x] of Object.entries(set)) v[idx(k)] = x;
    const proc = loadProcessor({ linkR: false });
    proc.port.onmessage({ data: { type: 'params', values: v } });
    const o = run(proc, Math.round(FS / BLOCK), noise);
    const frames = proc.port.sent.filter((m) => m.type === 'meters').slice(10);
    const msOf = (key) => frames.reduce((a, f) => a + f[key][band] ** 2, 0) / frames.length;
    return { L: msOf('bandsL'), R: msOf('bandsR'), both: msOf('bands'), outL: ms(o.L, skip), outR: ms(o.R, skip) };
  };
  const c = meters(4, {});
  check('6a centre: L and R meters equal the combined band meter', Math.abs(db(c.L, c.both)) < 0.01 && Math.abs(db(c.R, c.both)) < 0.01, `L ${db(c.L, c.both).toFixed(3)} dB, R ${db(c.R, c.both).toFixed(3)} dB`);
  const oe = meters(4, { spread: 1 });
  check('6b ODD/EVEN right stop: odd band 5 shows +3 dB in L, nothing in R', Math.abs(db(oe.L, c.L) - 3.01) < 0.1 && db(oe.L, oe.R) > 40, `L ${db(oe.L, c.L).toFixed(2)} dB, L−R ${db(oe.L, oe.R).toFixed(1)} dB`);
  const ev = meters(5, { spread: 1 });
  check('6c ODD/EVEN right stop: even band 6 shows in R only', db(ev.R, ev.L) > 40, `R−L ${db(ev.R, ev.L).toFixed(1)} dB`);
  const cl = meters(4, { spread: 1, 'reso.spread': 1 });
  check('6d CLASSIC right stop: R +6 dB, L −6 dB', Math.abs(db(cl.R, c.R) - 6) < 0.05 && Math.abs(db(cl.L, c.L) + 6) < 0.05, `R ${db(cl.R, c.R).toFixed(2)} dB, L ${db(cl.L, c.L).toFixed(2)} dB`);
  const f = meters(4, { 'band4.gainR': -10 });
  check('6e R fader 10 dB lower: the R meter is 10 dB lower', Math.abs(db(f.L, f.R) - 10) < 0.05, `L−R ${db(f.L, f.R).toFixed(2)} dB`);
  const half = meters(4, { spread: 0.5 });
  check('6f the meters match what band 5 alone sends to L and R', Math.abs(db(half.L, half.outL)) < 0.3 && Math.abs(db(half.R, half.outR)) < 0.3, `L ${db(half.L, half.outL).toFixed(2)} dB, R ${db(half.R, half.outR).toFixed(2)} dB`);
}

console.table(results);
