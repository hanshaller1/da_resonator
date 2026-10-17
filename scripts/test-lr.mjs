// Offline tests for L/R per band (docs/lr-pro-band-2026-10-16.md): level, RES, FB and Feedback All
// per channel in the worklet, route channels (L+R, L, R, INV), and the helpers of the channel switch.
// Run: node scripts/test-lr.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const RT = importTs('src/shared/mod/routing.ts');
const idx = (id) => P.paramIndex(id);
const NB = P.NUM_BANDS;
const F = P.BAND_FREQS;
const B = 4; // band 5, 411 Hz

let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const burst = (n) => (n < 0.05 * FS ? 0.1 * rnd() : 0);
const noise = () => 0.1 * rnd();
const ms = (x, a = 0, b = x.length) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return e / (b - a);
};
const db = (a, b) => 10 * Math.log10(a / b);

/** both channels alike, then `set` (id → value; R twins as `band4.gainR` …); solo: other bands muted in L and R */
function values(set = {}, solo = B) {
  const v = P.defaultValues();
  v[idx('analog')] = 0; // no component tolerance: the channels differ only where a test says so
  v[idx('mix')] = 1;
  v[idx('spread')] = 0;
  for (let b = 0; b < NB; b++) {
    if (solo !== null && b !== solo) {
      v[idx(`band${b}.gain`)] = -60;
      v[idx(`band${b}.gainR`)] = -60;
    }
  }
  for (const [id, x] of Object.entries(set)) v[idx(id)] = x;
  return v;
}
/** routes: [[source, target, depth, ch]] */
function render(v, seconds, input, routes = []) {
  const proc = loadProcessor({ linkR: false });
  const routing = new RT.ModRouting();
  for (const [s, t, d, ch] of routes) {
    const r = routing.addRoute(s, t, ch);
    if (!r.depthParam) throw new Error(`route ${s} → ${t} refused: ${r.reason}`);
    v[idx(r.depthParam)] = d;
  }
  proc.port.onmessage({ data: { type: 'params', values: v } });
  if (routes.length) proc.port.onmessage({ data: { type: 'modConfig', config: routing.config() } });
  return run(proc, Math.round((seconds * FS) / BLOCK), input);
}
/** keeps ringing on its own after a short noise burst: per channel */
function sustains(v, seconds = 3) {
  const out = render(v, seconds, burst);
  const n = out.L.length, h = Math.round(0.5 * FS);
  const one = (x) => {
    const last = ms(x, n - h, n), prev = ms(x, n - 3 * h, n - 2 * h);
    return Math.sqrt(last) > 1e-3 && last > 0.5 * prev && x.every(Number.isFinite);
  };
  return { L: one(out.L), R: one(out.R) };
}

/* ---------- 1. level per channel ---------- */
{
  const skip = Math.round(0.3 * FS);
  const a = render(values({ [`band${B}.gain`]: -6, [`band${B}.gainR`]: 6 }), 1.5, noise);
  const d = db(ms(a.R, skip), ms(a.L, skip));
  check('1a band 5: L −6 dB, R +6 dB gives R 12 dB louder', Math.abs(d - 12) < 1, `R−L ${d.toFixed(2)} dB`);
  const b = render(values({ [`band${B}.gainR`]: -60 }), 1.5, noise);
  const m = db(ms(b.L, skip), ms(b.R, skip));
  check('1b band 5: R muted, L at 0 dB', m > 40, `L−R ${m.toFixed(1)} dB`);
  const c = render(values({}), 1.5, noise);
  // (the channels carry their own denormal guard, a few 1e-10 apart)
  const dmax = c.L.reduce((m, x, i) => Math.max(m, Math.abs(x - c.R[i])), 0);
  check('1c linked values: L and R the same', dmax < 1e-6, `max |L−R| ${dmax.toExponential(1)}`);
}

/* ---------- 2. RES per channel ---------- */
{
  // impulse; the narrow channel rings longer: compare the tail after 150 ms
  const imp = (n) => (n === 0 ? 1 : 0);
  const a = render(values({ [`band${B}.res`]: 0.03, [`band${B}.resR`]: 0.85 }), 0.6, imp);
  const a0 = Math.round(0.15 * FS), a1 = Math.round(0.4 * FS);
  const tail = db(ms(a.R, a0, a1), ms(a.L, a0, a1));
  check('2a RES only in R: R rings longer than L', tail > 20, `tail R−L ${tail.toFixed(1)} dB`);
  const b = render(values({ [`band${B}.res`]: 0.85, [`band${B}.resR`]: 0.03 }), 0.6, imp);
  const tb = db(ms(b.L, a0, a1), ms(b.R, a0, a1));
  check('2b RES only in L: L rings longer than R', tb > 20, `tail L−R ${tb.toFixed(1)} dB`);
}

/* ---------- 3. FB per channel, both feedback routes ---------- */
{
  // BAND: FB at full rings a 0 dB band; COMMON (after the fader, test-reso 3): RES 0.45, fader +12 dB
  const band = (fbL, fbR) => values({ [`band${B}.fb`]: fbL, [`band${B}.fbR`]: fbR });
  const common = (fbL, fbR, gL = 12, gR = 12) =>
    values({ 'reso.route': 1, [`band${B}.res`]: 0.45, [`band${B}.resR`]: 0.45, [`band${B}.gain`]: gL, [`band${B}.gainR`]: gR, [`band${B}.fb`]: fbL, [`band${B}.fbR`]: fbR });
  for (const [name, mk, a] of [
    ['BAND', band, 1],
    ['COMMON', common, 0.6],
  ]) {
    const l = sustains(mk(a, 0));
    check(`3 ${name}: FB only in L, L sustains and R does not`, l.L && !l.R, JSON.stringify(l));
    const r = sustains(mk(0, a));
    check(`3 ${name}: FB only in R, R sustains and L does not`, r.R && !r.L, JSON.stringify(r));
  }
  // COMMON takes the loop after the fader of its own channel
  const f = sustains(common(0.3, 0.3, 12, 0));
  check('3 COMMON: same FB, fader +12 dB in L and 0 dB in R, only L sustains', f.L && !f.R, JSON.stringify(f));
}

/* ---------- 4. Feedback All per channel ---------- */
{
  const l = sustains(values({ fbAllOn: 1, fbAll: 1, fbAllOnR: 0, fbAllR: 1 }, null));
  check('4a FB ALL on in L only: L sustains, R does not', l.L && !l.R, JSON.stringify(l));
  const r = sustains(values({ fbAllOn: 1, fbAll: 0, fbAllOnR: 1, fbAllR: 1 }, null));
  check('4b FB ALL amount in R only: R sustains, L does not', r.R && !r.L, JSON.stringify(r));
  const both = sustains(values({ fbAllOn: 1, fbAll: 1, fbAllOnR: 1, fbAllR: 1 }, null));
  check('4c FB ALL in both: both sustain', both.L && both.R, JSON.stringify(both));
}

/* ---------- 5. route channels ---------- */
{
  // steady sine at the band; an LFO on the band level; envelopes in 20 ms windows after 0.3 s
  const sine = (n) => 0.2 * Math.sin((2 * Math.PI * F[B] * n) / FS);
  const win = Math.round(0.02 * FS);
  const env = (x) => {
    const out = [];
    for (let i = Math.round(0.3 * FS); i + win <= x.length; i += win) out.push(10 * Math.log10(ms(x, i, i + win) + 1e-12));
    return out;
  };
  const corr = (a, b) => {
    const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
    let n = 0, da = 0, dbb = 0;
    for (let i = 0; i < a.length; i++) {
      n += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      dbb += (b[i] - mb) ** 2;
    }
    return n / Math.sqrt(da * dbb);
  };
  const spread = (e) => Math.max(...e) - Math.min(...e);
  const go = (ch) => {
    const out = render(values({ [`band${B}.gain`]: -12, [`band${B}.gainR`]: -12, 'lfo1.on': 1, 'lfo1.rate': 2 }), 2.3, sine, [['lfo1', `band${B}.gain`, 0.15, ch]]);
    const l = env(out.L), r = env(out.R);
    return { l, r, c: corr(l, r) };
  };
  const lr = go('LR');
  check('5a L+R: both channels move together', lr.c > 0.95 && spread(lr.l) > 6, `corr ${lr.c.toFixed(3)}, swing ${spread(lr.l).toFixed(1)} dB`);
  const inv = go('INV');
  check('5b INV: R moves against L', inv.c < -0.9 && spread(inv.r) > 6, `corr ${inv.c.toFixed(3)}, swing ${spread(inv.r).toFixed(1)} dB`);
  const l = go('L');
  check('5c L: only L moves', spread(l.l) > 6 && spread(l.r) < 0.5, `swing L ${spread(l.l).toFixed(1)} dB, R ${spread(l.r).toFixed(2)} dB`);
  const r = go('R');
  check('5d R: only R moves', spread(r.r) > 6 && spread(r.l) < 0.5, `swing L ${spread(r.l).toFixed(2)} dB, R ${spread(r.r).toFixed(1)} dB`);
}

/* ---------- 6. routing: channel of a route ---------- */
{
  const routing = new RT.ModRouting();
  const a = routing.addRoute('lfo1', `band${B}.gain`, 'INV');
  const b = routing.addRoute('lfo2', 'mix', 'L');
  const cfg = routing.config().routes;
  check('6a route onto a band value keeps its channel (INV)', a.ch === 'INV' && cfg.find((r) => r.slot === a.slot).ch === 3);
  check('6b route onto a param without R falls back to L+R', b.ch === 'LR' && (cfg.find((r) => r.slot === b.slot).ch ?? 0) === 0);
  routing.setRouteChannel(a.slot, 'R');
  check('6c setRouteChannel changes it', routing.routes().find((r) => r.slot === a.slot).ch === 'R');
  check('6d an R twin is no route target', !routing.canRoute('lfo1', `band${B}.gainR`).ok);
}

/* ---------- 7. channel switch helpers (ui/channel.ts) ---------- */
{
  const C = importTs('src/ui/channel.ts');
  const { ParamStore } = importTs('src/core/ParamStore.ts');
  const near = (a, b) => Math.abs(a - b) < 1e-6; // the store keeps float32
  const [l1, r1] = C.moveLinked(0.3, 0.5, 0.1);
  check('7a L+R: same travel keeps the offset', near(l1, 0.4) && near(r1, 0.6));
  const [l2, r2] = C.moveLinked(0.3, 0.8, 0.4);
  check('7b L+R: a channel stops at its end, the other goes on', near(l2, 0.7) && near(r2, 1));
  const [l3, r3] = C.moveLinked(0.1, 0.4, -0.3);
  check('7c L+R: same at the bottom', near(l3, 0) && near(r3, 0.1));

  check('7d switch starts at L+R; new routes on band values follow it', C.channelSel.get() === 'LR' && C.newRouteChannel(`band${B}.gain`) === 'LR');
  C.channelSel.set('R');
  check('7e switch on R: new route on a band value gets R, elsewhere L+R', C.newRouteChannel(`band${B}.fb`) === 'R' && C.newRouteChannel('mix') === 'LR');
  C.channelSel.set('LR');

  const p = new ParamStore();
  for (let b = 0; b < NB; b++) {
    p.set(`band${b}.gain`, -3 - b);
    p.set(`band${b}.res`, 0.2 + b * 0.05);
    p.set(`band${b}.fb`, 0.1 * (b % 3));
  }
  p.set('fbAllOn', 1);
  p.set('fbAll', 0.4);
  C.copyLtoR(p);
  check('7f R = L copies every pair', C.STEREO_PAIRS.length === 3 * NB + 2 && C.STEREO_PAIRS.every(([l, r]) => p.get(l) === p.get(r)));
  p.set(`band${B}.gainR`, 6);
  check('7g pairDiffers sees an R offset', C.pairDiffers(p, `band${B}.gain`) && !C.pairDiffers(p, `band${B + 1}.gain`));
  C.resetBands(p, 'gain');
  const gains0 = Array.from({ length: NB }, (_, b) => p.get(`band${b}.gain`) === 0 && p.get(`band${b}.gainR`) === 0).every(Boolean);
  check('7h RESET: all faders 0 dB in L and R, RES and FB untouched', gains0 && near(p.get('band3.res'), 0.35) && near(p.get('band3.resR'), 0.35) && near(p.get('band1.fb'), 0.1));
  C.resetBands(p, 'res');
  const resDef = P.PARAM_BY_ID['band0.res'].def;
  check('7i RES RESET: RES of all bands at default in L and R', Array.from({ length: NB }, (_, b) => near(p.get(`band${b}.res`), resDef) && near(p.get(`band${b}.resR`), resDef)).every(Boolean));
  C.resetBands(p, 'fb');
  check('7j FB RESET: FB of all bands 0 in L and R, FB ALL untouched', Array.from({ length: NB }, (_, b) => p.get(`band${b}.fb`) === 0 && p.get(`band${b}.fbR`) === 0).every(Boolean) && p.get('fbAllOn') === 1);
}

/* ---------- 8. band groups (MACRO targets BAND LOW / MID / HIGH / ALL) ---------- */
{
  const v = () => values({ 'macro1.value': 0.8 }, null);
  // the same noise for every render
  const go = (routes) => ((seed = 7), render(v(), 0.5, noise, routes));
  const one = go([['macro1', 'bands.low', 0.4, 'INV']]);
  const three = go([0, 1, 2].map((b) => ['macro1', `band${b}.gain`, 0.4, 'INV']));
  const none = go([]);
  const same = one.L.every((x, i) => x === three.L[i]) && one.R.every((x, i) => x === three.R[i]);
  const moved = one.L.some((x, i) => x !== none.L[i]);
  check('8a a route onto BAND LOW sounds exactly like one route per low band', same && moved, `same ${same}, differs from no route ${moved}`);

  const routing = new RT.ModRouting();
  const r = routing.addRoute('macro1', 'bands.all', 'L');
  const { ParamStore } = importTs('src/core/ParamStore.ts');
  const M = importTs('src/core/midiMap.ts');
  const keys = Object.keys(new ParamStore().getState());
  const ok = r.ch === 'L' && P.BAND_GROUPS.length === 4 && !keys.some((k) => k.startsWith('bands.')) && !M.midiMappable('bands.mid');
  check('8b band group: route keeps its channel, not stored, not MIDI-mapped', ok, `ch ${r.ch}, stored ${keys.filter((k) => k.startsWith('bands.'))}`);
}

console.table(results);
