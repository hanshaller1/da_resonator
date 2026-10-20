// Measurements for docs/klang-original-2026-10-20.md: how clean the DSP is today (harmonics of a driven
// sine, of self-oscillation, of the loops) and what the RESONANCE knob does left of centre.
// Not a test (prints numbers, checks nothing). Run: node scripts/measure-character.mjs
import { BLOCK, FS, importTs, loadProcessor, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const idx = (id) => P.paramIndex(id);
const NB = P.NUM_BANDS;
const F = P.BAND_FREQS;
const send = (proc, v) => proc.port.onmessage({ data: { type: 'params', values: v } });

function setup(o = {}) {
  const v = P.defaultValues();
  const set = (id, x) => (v[idx(id)] = x);
  set('analog', o.analog ?? 0.5);
  set('inputGain', o.gain ?? 0);
  set('reso.route', o.route ?? 0);
  set('reso.knob', o.knob ?? 0);
  set('resOffset', o.kv ?? 0);
  for (let b = 0; b < NB; b++) {
    set(`band${b}.gain`, o.solo === undefined || o.solo === b ? (o.fd ?? 0) : -60);
    if (o.res !== undefined) set(`band${b}.res`, o.res);
    if (o.fb !== undefined && (o.fbBands === undefined || o.fbBands.includes(b))) set(`band${b}.fb`, o.fb);
  }
  if (o.fbAll !== undefined) {
    set('fbAllOn', 1);
    set('fbAll', o.fbAll);
  }
  return v;
}
function render(v, seconds, input = () => 0) {
  const proc = loadProcessor();
  send(proc, v);
  return run(proc, Math.round((seconds * FS) / BLOCK), input).L;
}
let seed = 777;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const burst = (n) => (n < 0.05 * FS ? 0.1 * rnd() : 0);

/** amplitude at f over the last n samples (Hann window, amplitude-corrected) */
function amp(x, f, n = 1 << 14) {
  const a = x.length - n;
  let re = 0, im = 0;
  const w = (2 * Math.PI * f) / FS;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re += x[a + i] * h * Math.cos(w * i);
    im += x[a + i] * h * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / (n * 0.5);
}
/** strongest frequency between lo and hi (1 Hz steps, then 0.1 Hz) */
function peakFreq(x, lo, hi) {
  let best = 0, bf = lo;
  for (let f = lo; f <= hi; f += 1) {
    const a = amp(x, f, 1 << 13);
    if (a > best) [best, bf] = [a, f];
  }
  for (let f = bf - 1; f <= bf + 1; f += 0.1) {
    const a = amp(x, f, 1 << 13);
    if (a > best) [best, bf] = [a, f];
  }
  return bf;
}
/** harmonics 1..10 at f0 → { thd %, h2..h5 in dB re fundamental, peak, rms of the last 0.34 s } */
function harm(x, f0) {
  const h = [];
  for (let k = 1; k <= 10 && k * f0 < 20000; k++) h.push(amp(x, k * f0));
  const thd = Math.sqrt(h.slice(1).reduce((s, a) => s + a * a, 0)) / h[0];
  const n = 1 << 14;
  let pk = 0, ms = 0;
  for (let i = x.length - n; i < x.length; i++) {
    pk = Math.max(pk, Math.abs(x[i]));
    ms += x[i] * x[i];
  }
  const db = (a) => (a > 1e-9 ? (20 * Math.log10(a / h[0])).toFixed(0) : '-inf');
  return { thd: (100 * thd).toFixed(2) + ' %', h2: db(h[1]), h3: db(h[2]), h4: db(h[3]), h5: db(h[4]), peak: pk.toFixed(2), crest: (pk / Math.sqrt(ms / n)).toFixed(2) };
}
function gainDb(h, f) {
  let re = 0, im = 0;
  const w = (2 * Math.PI * f) / FS;
  for (let n = 0; n < h.length; n++) {
    re += h[n] * Math.cos(w * n);
    im -= h[n] * Math.sin(w * n);
  }
  return 20 * Math.log10(Math.hypot(re, im));
}
function response(v) {
  const proc = loadProcessor();
  send(proc, v);
  run(proc, 20);
  const A = 1e-3;
  const h = Array.from(run(proc, (1 << 16) / BLOCK, (n) => (n === 0 ? A : 0)).L, (x) => x / A);
  const g = [];
  for (let f = 40; f <= 12000; f *= Math.pow(2, 1 / 24)) g.push([f, gainDb(h, f)]);
  return g;
}
function diff(a, b) {
  let mx = 0, at = 0, sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = b[i][1] - a[i][1];
    sum += Math.abs(d);
    if (Math.abs(d) > Math.abs(mx)) [mx, at] = [d, a[i][0]];
  }
  return `max ${mx.toFixed(1)} dB at ${at.toFixed(0)} Hz, mean |Δ| ${(sum / a.length).toFixed(1)} dB`;
}
const shape = (g) => {
  const pts = [60, 115, 160, 218, 300, 411, 560, 777, 1100, 1500, 2000, 2800, 3800, 5200, 7500, 11000];
  return pts.map((f) => {
    const i = g.reduce((bi, [ff], k) => (Math.abs(Math.log(ff / f)) < Math.abs(Math.log(g[bi][0] / f)) ? k : bi), 0);
    return `${f}:${g[i][1].toFixed(0)}`;
  }).join(' ');
};

const sine = (f, a) => (n) => a * Math.sin((2 * Math.PI * f * n) / FS);

console.log('\n== A. sine 110 Hz, peak 0.5, default sound (broad bands, no feedback) ==');
for (const gain of [0, 12, 24]) for (const analog of [0, 0.5, 1]) {
  const x = render(setup({ gain, analog }), 1, sine(110, 0.5));
  console.log(`gain ${String(gain).padStart(2)} dB analog ${analog}:`, harm(x, 110));
}

console.log('\n== B. self-oscillation, band 5 (411 Hz) FB 1, BAND route ==');
for (const [res, analog] of [[0.03, 0.5], [0.45, 0.5], [0.45, 0], [0.45, 1], [1, 0.5]]) {
  const x = render(setup({ res, analog, fb: 1, fbBands: [4] }), 3, burst);
  const f0 = peakFreq(x, 380, 440);
  console.log(`RES ${res} analog ${analog}: f0 ${f0.toFixed(1)}`, harm(x, f0));
}

console.log('\n== C. Feedback All AMT 1, default bands ==');
for (const analog of [0, 0.5, 1]) {
  const x = render(setup({ analog, fbAll: 1 }), 3, burst);
  const f0 = peakFreq(x, 25, 12000);
  console.log(`analog ${analog}: f0 ${f0.toFixed(1)}`, harm(x, f0));
}

console.log('\n== D. hardware-like: COMMON route, KNOB FEEDBACK at +1, every band FB 1 (all switches on) ==');
for (const [fd, analog] of [[0, 0.5], [6, 0.5], [6, 1]]) {
  const x = render(setup({ route: 1, knob: 1, kv: 1, fb: 1, fd, analog }), 3, burst);
  const f0 = peakFreq(x, 25, 12000);
  console.log(`faders ${fd} dB analog ${analog}: f0 ${f0.toFixed(1)}`, harm(x, f0));
}
{
  // one band raised (+12 dB) in the common route, knob at 3 o'clock (0.67), FB on everywhere
  const x = render(setup({ route: 1, knob: 1, kv: 0.67, fb: 1 }).map((v, i) => (i === idx('band6.gain') ? 12 : v)), 3, burst);
  const f0 = peakFreq(x, 25, 12000);
  console.log(`band 7 at +12 dB, knob 3 o'clock: f0 ${f0.toFixed(1)}`, harm(x, f0));
}

console.log('\n== E. driven: sine 110 Hz peak 0.5, gain 12 dB, COMMON + KNOB FEEDBACK 0.6, every FB 1 ==');
{
  const x = render(setup({ route: 1, knob: 1, kv: 0.6, fb: 1, gain: 12 }), 2, sine(110, 0.5));
  console.log(harm(x, 110));
}

console.log('\n== F. RESONANCE knob left of centre: response change vs centre (impulse, analog 0) ==');
const cases = [
  ['KNOB RES (default), RES 0.03', { analog: 0 }, 0],
  ['KNOB RES, RES 0.45', { analog: 0, res: 0.45 }, 0],
  ['KNOB FEEDBACK, BAND route, all FB 1', { analog: 0, knob: 1, fb: 1 }, 1],
  ['KNOB FEEDBACK, COMMON route, all FB 1', { analog: 0, knob: 1, fb: 1, route: 1 }, 1],
  ['KNOB FEEDBACK, COMMON, bands 2/4/6/8 FB 1', { analog: 0, knob: 1, fb: 1, route: 1, fbBands: [1, 3, 5, 7] }, 1],
  ['KNOB FEEDBACK, FB ALL on (AMT 1), FB 0', { analog: 0, knob: 1, fbAll: 1 }, 1],
];
for (const [name, o] of cases) {
  const c = response(setup({ ...o, kv: 0 }));
  const l = response(setup({ ...o, kv: -1 }));
  const r = response(setup({ ...o, kv: 0.5 }));
  console.log(`${name}\n   left (−1) vs centre: ${diff(c, l)}\n   right (+0.5) vs centre: ${diff(c, r)}`);
  console.log(`   centre ${shape(c)}\n   left   ${shape(l)}`);
}
