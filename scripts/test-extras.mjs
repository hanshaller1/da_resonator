// Offline tests for the controls added on 2026-10-17: filter KEY / ENV / SPREAD, EF HOLD, LFO STEPS / R PHASE,
// band filter KEY / ENV / PEAK / RES AMT.
// Run: node scripts/test-extras.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const S = importTs('src/shared/mod/sources.ts');
const F = importTs('src/dsp/modules/filter.ts');
const idx = (id) => P.paramIndex(id);
const src = (id) => S.SOURCE_BY_ID[id].index;
const f2 = (x) => x.toFixed(2);

/* ---------- filter stage on its own: a fake block context ---------- */
function stage(set) {
  const st = new F.FilterStage('filterPre');
  const eff = Float32Array.from(P.defaultValues());
  eff[idx('filterPre.on')] = 1;
  for (const [id, v] of Object.entries(set)) eff[idx(id)] = v;
  return { st, eff, ctx: { fs: FS, n: BLOCK, dt: BLOCK / FS, eff } };
}
/** steady-state gain (dB) of L and R for a sine at f and amplitude a */
function sineGain({ st, ctx }, f, a = 0.5) {
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  let eIn = 0, eL = 0, eR = 0;
  const blocks = Math.round((0.6 * FS) / BLOCK);
  for (let k = 0; k < blocks; k++) {
    for (let i = 0; i < BLOCK; i++) l[i] = r[i] = a * Math.sin((2 * Math.PI * f * (k * BLOCK + i)) / FS);
    const inE = l.reduce((s, x) => s + x * x, 0);
    st.process(l, r, BLOCK, ctx);
    if (k > blocks / 2) {
      eIn += inE;
      eL += l.reduce((s, x) => s + x * x, 0);
      eR += r.reduce((s, x) => s + x * x, 0);
    }
  }
  return [10 * Math.log10(eL / eIn), 10 * Math.log10(eR / eIn)];
}

/* 1. KEY: BP on the centre of band 6 (777 Hz) whatever FREQ says; Focus follows the RESONANCE knob */
{
  const bp = { 'filterPre.type': 1, 'filterPre.res': 0.6, 'filterPre.cutoff': 8000 };
  const at = (key, f, extra = {}) => sineGain(stage({ ...bp, 'filterPre.key': key, ...extra }), f)[0];
  const band6 = at(2 + 5, 777), band6off = at(2 + 5, 3000);
  const off = at(0, 777);
  // Focus with the knob at the left stop = band 1 (29 Hz), at the right stop band 10 (11 kHz)
  const fLeft = F.filterKeyCutoff(1, 1000, -1), fRight = F.filterKeyCutoff(1, 1000, 1), fMid = F.filterKeyCutoff(1, 1000, 0);
  const focusOk = fLeft === 29 && fRight === 11000 && Math.abs(fMid - Math.sqrt(411 * 777)) < 1e-9;
  check('1 filter KEY: band centre / Focus', band6 > -0.5 && band6off < -10 && off < -15 && focusOk, `band 6 at 777 Hz ${f2(band6)} dB, at 3 kHz ${f2(band6off)} dB, KEY off at 777 Hz ${f2(off)} dB; focus ${fLeft} / ${f2(fMid)} / ${fRight} Hz`);
}

/* 2. ENV AMT: a loud signal opens a closed LP, a quiet one does not; ENV 0 is the plain filter */
{
  const lp = { 'filterPre.type': 0, 'filterPre.cutoff': 300, 'filterPre.res': 0 };
  const loud = sineGain(stage({ ...lp, 'filterPre.env': 4 }), 2000, 0.8)[0];
  const quiet = sineGain(stage({ ...lp, 'filterPre.env': 4 }), 2000, 0.004)[0];
  const plain = sineGain(stage(lp), 2000, 0.8)[0];
  check('2 filter ENV AMT opens the filter with the level', loud > plain + 15 && quiet < plain + 3, `2 kHz through LP 300 Hz: loud ${f2(loud)} dB, quiet ${f2(quiet)} dB, ENV 0 ${f2(plain)} dB`);
}

/* 3. SPREAD: L cutoff down, R up by one octave each at +2 */
{
  const lp = { 'filterPre.type': 0, 'filterPre.cutoff': 1000, 'filterPre.res': 0, 'filterPre.slope': 1 };
  const [l, r] = sineGain(stage({ ...lp, 'filterPre.spread': 2 }), 1000);
  const [l0, r0] = sineGain(stage(lp), 1000);
  check('3 filter SPREAD moves L down and R up', l < l0 - 10 && r > r0 + 5 && Math.abs(l0 - r0) < 1e-9, `1 kHz through LP 1 kHz 24 dB: SPREAD +2 L ${f2(l)} R ${f2(r)} dB, SPREAD 0 L ${f2(l0)} R ${f2(r0)} dB`);
}

/* ---------- sources inside the worklet ---------- */
function setup(set, routes = []) {
  const proc = loadProcessor();
  const v = P.defaultValues();
  for (const [id, val] of Object.entries(set)) v[idx(id)] = val;
  routes.forEach(([, , depth], slot) => (v[idx(`route${slot}.depth`)] = depth));
  proc.port.onmessage({ data: { type: 'params', values: v } });
  proc.port.onmessage({ data: { type: 'modConfig', config: { routes: routes.map(([s, d], slot) => ({ slot, src: src(s), dst: idx(d) })), triggers: [] } } });
  return proc;
}
function blocks(proc, n, input = () => 0, each) {
  const iL = new Float32Array(BLOCK), oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < BLOCK; i++) iL[i] = input(k * BLOCK + i);
    proc.process([[iL, iL]], [[oL, oR]]);
    each?.(k);
  }
}

/* 4. LFO STEPS: a saw quantised to 4 levels */
{
  const proc = setup({ 'lfo1.on': 1, 'lfo1.shape': 2, 'lfo1.rate': 2, 'lfo1.steps': 3 });
  const seen = new Set();
  blocks(proc, 400, undefined, () => seen.add(proc.mod.srcVals[src('lfo1')].toFixed(4)));
  const want = ['-1.0000', '-0.3333', '0.3333', '1.0000'];
  check('4 LFO STEPS quantises the wave', seen.size === 4 && want.every((x) => seen.has(x)), `levels ${[...seen].sort().join(' ')}`);
}

/* 5. LFO R PHASE: 180° gives the R side the inverted sine; a route moves L and R apart */
{
  const proc = setup({ 'lfo1.on': 1, 'lfo1.shape': 0, 'lfo1.rate': 1, 'lfo1.rphase': 180 }, [['lfo1', 'band0.gain', 0.5]]);
  let err = 0, apart = 0;
  const iL = idx('band0.gain'), iR = P.PARAMS[iL].twin;
  blocks(proc, 300, undefined, () => {
    const a = proc.mod.srcVals[src('lfo1')], b = proc.mod.srcValsR[src('lfo1')];
    err = Math.max(err, Math.abs(a + b));
    apart = Math.max(apart, Math.abs(proc.mod.eff[iL] - proc.mod.eff[iR]));
  });
  const p0 = setup({ 'lfo1.on': 1, 'lfo1.shape': 0, 'lfo1.rate': 1 }, [['lfo1', 'band0.gain', 0.5]]);
  let same = 0;
  blocks(p0, 300, undefined, () => (same = Math.max(same, Math.abs(p0.mod.eff[iL] - p0.mod.eff[iR]))));
  check('5 LFO R PHASE: R side runs 180° later', err < 1e-6 && apart > 6 && same === 0, `|L + R| max ${err.toExponential(1)}; band 1 level L−R up to ${f2(apart)} dB (0° ${same})`);
}

/* 6. EF HOLD: the envelope stays at its peak for HOLD, then falls; HOLD 0 falls at once */
{
  const burst = (n) => (n < 0.05 * FS ? 0.5 * Math.sin((2 * Math.PI * 500 * n) / FS) : 0);
  const after = (hold, ms) => {
    const proc = setup({ 'ef1.on': 1, 'ef1.release': 50, 'ef1.hold': hold });
    blocks(proc, Math.round(((50 + ms) * 0.001 * FS) / BLOCK), burst);
    return proc.mod.srcVals[src('ef1')];
  };
  const h100 = after(300, 100), h400 = after(300, 450), h0 = after(0, 100);
  check('6 EF HOLD keeps the peak, then releases', h100 > h0 + 0.2 && h400 < h100 - 0.2, `HOLD 300 ms: 100 ms after the burst ${f2(h100)}, 450 ms after ${f2(h400)}; HOLD 0: ${f2(h0)}`);
}

/* ---------- band filter KEY, ENV, PEAK, RES AMT (layers inside the worklet) ---------- */
const BF = { 'filterBand.on': 1, 'filterBand.type': 0, 'filterBand.slope': 24, 'filterBand.depth': 60, 'filterBand.cutoff': 8000 };
const layer = (proc, b) => proc.lyrDb[b * 2];

/* 7. KEY: band 6 / last MIDI note set the cutoff */
{
  const off = setup(BF), band6 = setup({ ...BF, 'filterBand.key': 7 }), note = setup({ ...BF, 'filterBand.key': 12 });
  note.port.onmessage({ data: { type: 'note', note: 57 } }); // A3 = 220 Hz
  for (const p of [off, band6, note]) blocks(p, 4);
  const a = layer(off, 5), b = layer(band6, 5), c = layer(band6, 7), d = layer(note, 3), e = layer(note, 5);
  check('7 band filter KEY: band / MIDI note', a > -0.1 && Math.abs(b + 3.01) < 0.1 && c < -20 && Math.abs(d + 2.9) < 0.3 && e < -10,
    `band 6 (777 Hz): KEY off ${f2(a)} dB, KEY band 6 ${f2(b)} dB (band 8 ${f2(c)}); KEY note A3: band 4 ${f2(d)}, band 6 ${f2(e)} dB`);
}

/* 8. ENV: a loud input opens an LP at 100 Hz */
{
  const set = { ...BF, 'filterBand.cutoff': 100, 'filterBand.env': 4, 'filterBand.envRel': 500 };
  const loud = setup(set), quiet = setup(set);
  const sine = (amp) => (n) => amp * Math.sin((2 * Math.PI * 300 * n) / FS);
  blocks(loud, 40, sine(0.5));
  blocks(quiet, 40, sine(0.005));
  const l = layer(loud, 5), q = layer(quiet, 5);
  check('8 band filter ENV opens with the level', l > q + 20, `band 6 with LP 100 Hz, ENV +4: loud input ${f2(l)} dB, quiet ${f2(q)} dB`);
}

/* 9. PEAK: +12 dB bell at the cutoff */
{
  const p = setup({ ...BF, 'filterBand.key': 7, 'filterBand.peak': 12 });
  blocks(p, 4);
  const b = layer(p, 5), n = layer(p, 4);
  check('9 band filter PEAK lifts the cutoff band', Math.abs(b - 8.99) < 0.1 && n < b - 6, `band 6 at the cutoff ${f2(b)} dB (−3 + 12), band 5 ${f2(n)} dB`);
}

/* 10. RES AMT: open bands up, closed ones down; 0 leaves RES alone */
{
  const p = setup({ ...BF, 'filterBand.cutoff': 1000, 'filterBand.resAmt': 1 }), z = setup({ ...BF, 'filterBand.cutoff': 1000 });
  blocks(p, 200);
  blocks(z, 200);
  const lo = p.lyrResCur[0], hi = p.lyrResCur[18], zero = Math.max(...z.lyrResCur.map(Math.abs));
  check('10 band filter RES AMT shifts RES with the curve', lo > 0.45 && hi < -0.45 && zero === 0, `band 1 ${f2(lo)}, band 10 ${f2(hi)} (RES AMT 0: ${zero})`);
}

console.table(results);
