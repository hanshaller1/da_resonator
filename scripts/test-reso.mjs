// Offline tests for the resonance setup of 2026-10-16 (docs/dsp-durchgang-2026-10-16.md):
// flat broad default bands, Feedback All scale, the COMMON feedback route, the FEEDBACK knob
// (incl. inverted feedback), knob curve and band weighting.
// Run: node scripts/test-reso.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const idx = (id) => P.paramIndex(id);
const NB = P.NUM_BANDS;
const F = P.BAND_FREQS;
const send = (proc, v) => proc.port.onmessage({ data: { type: 'params', values: v } });

/** default sound with overrides: res (all bands), fader dB (all or solo band), route, knob mode / value / curve / weight */
function setup({ res = null, fd = 0, solo = null, analog = 0.5, route = 0, knob = 0, kv = 0, curve = 0, weight = 0 } = {}) {
  const v = P.defaultValues();
  v[idx('analog')] = analog;
  for (let b = 0; b < NB; b++) {
    v[idx(`band${b}.gain`)] = solo === null || solo === b ? fd : -60;
    if (res !== null) v[idx(`band${b}.res`)] = res;
  }
  v[idx('reso.route')] = route;
  v[idx('reso.knob')] = knob;
  v[idx('resOffset')] = kv;
  v[idx('reso.curve')] = curve;
  v[idx('reso.weight')] = weight;
  return v;
}
function render(v, seconds, input = () => 0) {
  const proc = loadProcessor();
  send(proc, v);
  return run(proc, Math.round((seconds * FS) / BLOCK), input);
}
let seed = 777;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const burst = (n) => (n < 0.05 * FS ? 0.1 * rnd() : 0);
const ms = (x, a, b) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return e / (b - a);
};
/** keeps ringing on its own after a short noise burst (not just a slow decay) */
function sustains(v, seconds = 3) {
  const { L } = render(v, seconds, burst);
  const n = L.length, h = Math.round(0.5 * FS);
  const last = ms(L, n - h, n), prev = ms(L, n - 3 * h, n - 2 * h);
  return Math.sqrt(last) > 1e-3 && last > 0.5 * prev && L.every(Number.isFinite);
}
/** smallest value (0..1) of `mk(x)` that self-oscillates, 6 bisection steps; 2 = never */
function onset(mk) {
  if (!sustains(mk(1))) return 2;
  let lo = 0, hi = 1;
  for (let k = 0; k < 6; k++) {
    const m = (lo + hi) / 2;
    if (sustains(mk(m))) hi = m;
    else lo = m;
  }
  return hi;
}
/** magnitude response (dB) of the impulse response at f */
function gainDb(h, f) {
  let re = 0, im = 0;
  const w = (2 * Math.PI * f) / FS;
  for (let n = 0; n < h.length; n++) {
    re += h[n] * Math.cos(w * n);
    im -= h[n] * Math.sin(w * n);
  }
  return 20 * Math.log10(Math.hypot(re, im));
}
function impulse(v, len = 1 << 15) {
  const proc = loadProcessor();
  send(proc, v);
  run(proc, 20);
  const A = 0.01;
  const { L } = run(proc, len / BLOCK, (n) => (n === 0 ? A : 0));
  return Array.from(L, (x) => x / A);
}
const f2 = (x) => x.toFixed(2);

/* ---------- 1. default bands are broad and sum flat at 0 dB ---------- */
{
  const h = impulse(setup({ analog: 0 }), 1 << 16);
  const g = [];
  for (let f = 50; f <= 9000; f *= Math.pow(2, 1 / 12)) g.push([f, gainDb(h, f)]);
  const mid = g.filter(([f]) => f >= 100 && f <= 3000).map(([, d]) => d);
  const mean = mid.reduce((a, b) => a + b) / mid.length;
  const all = g.map(([, d]) => d);
  const ripple = Math.max(...all) - Math.min(...all);
  check('1 default bands flat at 0 dB', Math.abs(mean) < 0.5 && ripple < 3 && P.PARAM_BY_ID['band0.res'].def === P.RES_DEFAULT, `100 Hz–3 kHz mean ${f2(mean)} dB, 50 Hz–9 kHz ripple ${f2(ripple)} dB`);
}

/* ---------- 2. Feedback All self-oscillates from ≈ 0.75, broad or narrow bands ---------- */
{
  const fa = (res) => (a) => {
    const v = setup({ res });
    v[idx('fbAllOn')] = 1;
    v[idx('fbAll')] = a;
    return v;
  };
  const broad = onset(fa(null)), narrow = onset(fa(0.45));
  check('2 Feedback All onset ≈ 0.75', broad > 0.65 && broad < 0.85 && narrow > 0.65 && narrow < 0.85, `broad ${f2(broad)}, RES 0.45 ${f2(narrow)}`);
}

/* ---------- 3. COMMON route: after the fader, so raising the fader makes the band ring ---------- */
{
  const band = (route, fd, a) => {
    const v = setup({ res: 0.45, route, fd, solo: 5 });
    v[idx('band5.fb')] = a;
    return v;
  };
  const at0 = onset((a) => band(1, 0, a));
  const commonUp = sustains(band(1, 12, 0.3));
  const bandUp = sustains(band(0, 12, 0.3));
  // pitch: the oscillation sits on the band centre (777 Hz), analog off
  const v = band(1, 12, 0.6);
  v[idx('analog')] = 0;
  const { L } = render(v, 2, burst);
  let best = 0, bf = 0;
  const n = 1 << 14, a = L.length - n;
  for (let f = 700; f <= 860; f += 1) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * f) / FS;
    for (let i = 0; i < n; i++) {
      re += L[a + i] * Math.cos(w * i);
      im += L[a + i] * Math.sin(w * i);
    }
    if (re * re + im * im > best) [best, bf] = [re * re + im * im, f];
  }
  check(
    '3 COMMON route: fader drives the ringing, pitch on the centre',
    at0 > 0.82 && at0 < 0.92 && commonUp && !bandUp && Math.abs(bf - F[5]) <= 3 && L.every(Number.isFinite),
    `onset at 0 dB ${f2(at0)}; FB 0.3 at +12 dB: COMMON rings ${commonUp}, BAND rings ${bandUp}; pitch ${bf} Hz`,
  );
}

/* ---------- 4. COMMON route with every band on stays bounded ---------- */
{
  const v = setup({ route: 1, fd: 12, analog: 1, knob: 1, kv: 1 });
  for (let b = 0; b < NB; b++) v[idx(`band${b}.fb`)] = 1;
  v[idx('fbAllOn')] = 1;
  v[idx('fbAll')] = 1;
  const { L, R } = render(v, 2, burst);
  let pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  check('4 COMMON, everything at full: finite, ≤ 1', L.every(Number.isFinite) && R.every(Number.isFinite) && pk <= 1, `peak ${pk.toFixed(3)}`);
}

/* ---------- 5. FEEDBACK knob (hardware attenuverter): centre = none, right more, left inverted ---------- */
{
  const fb = (knob, kv) => (a) => {
    const v = setup({ res: 0.45, knob, kv, solo: 5 });
    v[idx('band5.fb')] = a;
    return v;
  };
  // centre: no feedback, identical to all FB at 0
  const x = (n) => 0.2 * Math.sin((2 * Math.PI * 500 * n) / FS) + 0.05 * rnd();
  const mk = (fbv) => {
    const v = setup({ res: 0.45, knob: 1, kv: 0 });
    v[idx('band5.fb')] = fbv;
    v[idx('fbAllOn')] = fbv > 0 ? 1 : 0;
    seed = 99;
    return render(v, 0.5, x).L;
  };
  const a = mk(0), b = mk(0.6);
  const same = a.every((s, i) => s === b[i]);
  const right = onset(fb(1, 1));
  // FB 1: rings from 3 o'clock (knob 2/3 on the 270° sweep), not at 2 o'clock
  const at3 = (kv) => sustains(fb(1, kv)(1));
  const three = !at3(0.6) && at3(0.72);
  // left: inverted feedback damps the band (its centre drops), and never rings
  const centre = (kv, a2) => {
    const v = setup({ res: 0.45, knob: 1, kv, solo: 5, analog: 0 });
    v[idx('band5.fb')] = a2;
    return gainDb(impulse(v), F[5]);
  };
  const plain = centre(0, 0), inverted = centre(-1, 0.5);
  const left = sustains(fb(1, -1)(1));
  check(
    '5 FEEDBACK knob: centre = none, right ×1.3 (FB 1 rings from 3 o\'clock), left inverted',
    same && right > 0.6 && right < 0.73 && three && inverted < plain - 3 && !left,
    `centre = no feedback ${same}; right onset ${f2(right)} (0.87 / 1.3); FB 1 at 2:30 / 3:15 rings ${!three ? 'wrong' : 'no / yes'}; FB 0.5 at full left: centre ${f2(inverted)} dB vs ${f2(plain)} dB, FB 1 rings ${left}`,
  );
}

/* ---------- 6. FEEDBACK knob also drives Feedback All ---------- */
{
  const fa = (a) => {
    const v = setup({ knob: 1, kv: 1 });
    v[idx('fbAllOn')] = 1;
    v[idx('fbAll')] = a;
    return v;
  };
  const o = onset(fa);
  check('6 FEEDBACK knob scales Feedback All', o > 0.5 && o < 0.65, `onset at full right ${f2(o)} (≈ 0.75 / 1.3)`);
}

/* ---------- 7. RES knob: curve and band weighting ---------- */
{
  const S = P.resKnobShape;
  const shapes = [S(0.5, 0), S(0.5, 1), S(0.5, 2), S(-0.5, 1), S(1, 1), S(1, 2)];
  // S-curve "balanced": fine around the centre and at the stops, half travel at half the knob, sign kept
  const sOk = S(0.5, 3) === 0.5 && S(0.25, 3) < 0.2 && S(0.75, 3) > 0.8 && S(1, 3) === 1 && S(-0.25, 3) === -S(0.25, 3);
  const shapeOk = sOk && shapes[0] === 0.5 && shapes[1] > 0.7 && shapes[2] < 0.3 && shapes[3] === -shapes[1] && Math.abs(shapes[4] - 1) < 1e-12 && Math.abs(shapes[5] - 1) < 1e-12;
  // HIGHS: the knob leaves band 1 alone and moves band 10 fully; LOWS the other way round.
  // Measured as the band's centre gain, which rises with RES (narrower, lifted peak).
  const centre = (b, weight, kv) => gainDb(impulse(setup({ res: 0.3, solo: b, analog: 0, kv, weight })), F[b]);
  const moved = (b, weight) => centre(b, weight, 0.5) - centre(b, weight, 0);
  const lowStill = Math.abs(moved(0, 1)) < 0.01;
  const highMoves = moved(9, 1) > 6;
  const lowsMoves = moved(0, 2) > 6 && Math.abs(moved(9, 2)) < 0.01;
  check('7 knob curve and band weighting', shapeOk && lowStill && highMoves && lowsMoves, `shapes ${shapes.map(f2).join(' ')}, S ${sOk}; HIGHS: band 1 still ${lowStill}, band 10 moves ${highMoves}; LOWS mirrored ${lowsMoves}`);
}

/* ---------- 8. FOCUS knob: a RES spotlight swept from band 1 (left) to band 10 (right) ---------- */
{
  const centre = (b, kv) => gainDb(impulse(setup({ res: 0.3, solo: b, analog: 0, knob: 2, kv })), F[b]);
  const lowL = centre(0, -1), lowR = centre(0, 1), highL = centre(9, -1), highR = centre(9, 1);
  const midC = centre(4, 0), midL = centre(4, -1);
  const shift = [-1, 0, 1].map((kv) => [0, 4, 5, 9].map((b) => P.resFocusShift(b, kv)));
  const shiftOk = shift[0][0] === P.FOCUS_DEPTH && shift[2][3] === P.FOCUS_DEPTH && shift[0][3] < 1e-6 && Math.abs(shift[1][1] - shift[1][2]) < 1e-12;
  check(
    '8 FOCUS knob sweeps a resonance spotlight',
    shiftOk && lowL > lowR + 6 && highR > highL + 6 && midC > midL + 6,
    `band 1 left/right ${f2(lowL)} / ${f2(lowR)} dB, band 10 ${f2(highL)} / ${f2(highR)} dB, band 5 centre/left ${f2(midC)} / ${f2(midL)} dB`,
  );
}

console.table(results);
