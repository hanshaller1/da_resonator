// Offline test bench for src/dsp/resonator.worklet.ts
// Run: node scripts/dsp-test.mjs
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FS = 48000;
const BLOCK = 128;
const BAND_FREQS = [29, 61, 115, 218, 411, 777, 1500, 2800, 5200, 11000];
const NB = 10;
// param layout (mirrors src/shared/params.ts)
const G = { inputGain: 0, analog: 1, resOffset: 2, fbAllOn: 3, fbAll: 4, fbAllTone: 5, spread: 6, mix: 7, outputGain: 8, bypass: 9 };
const NG = 10;
const bi = (b, k) => NG + b * 3 + ['gain', 'res', 'fb'].indexOf(k);
const NUM_PARAMS = NG + NB * 3;

/* ---------- bundle + load ---------- */
const FULL = (() => {
  const c = buildSync({ entryPoints: [path.join(root, 'src/shared/params.ts')], bundle: true, write: false, format: 'cjs', platform: 'neutral', target: 'es2020' }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('module', 'exports', c)(module, module.exports);
  return module.exports;
})();
const code = buildSync({
  entryPoints: [path.join(root, 'src/dsp/resonator.worklet.ts')],
  bundle: true, write: false, format: 'iife', platform: 'neutral', target: 'es2020',
}).outputFiles[0].text;

function loadProcessor() {
  const registry = {};
  const ctx = {
    sampleRate: FS,
    currentTime: 0,
    console,
    registerProcessor: (name, cls) => (registry[name] = cls),
  };
  vm.createContext(ctx);
  vm.runInContext(
    `class AudioWorkletProcessor { constructor() { const sent = []; this.port = { sent, onmessage: null, postMessage(m) { sent.push(m); } }; } }`,
    ctx,
  );
  // The context's own built-ins are bound once as function parameters: free-variable lookups
  // through a vm context's contextified global are ~20x slower than in a real
  // AudioWorkletGlobalScope (and host-realm Math would not be inlined by TurboFan).
  vm.runInContext(
    `(function (Math, Number, Float32Array, Float64Array, Uint8Array, Object, Array, Map, Set, Error) {\n${code}\n})(Math, Number, Float32Array, Float64Array, Uint8Array, Object, Array, Map, Set, Error);`,
    ctx,
  );
  const names = Object.keys(registry);
  if (names.length !== 1) throw new Error('expected one registered processor, got ' + names);
  const proc = new registry[names[0]]({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  // the values here are the resonator's historic layout (left channel since L/R per band): fill the
  // rest with defaults and copy every L value onto its R twin, like an older preset is loaded
  const handle = proc.port.onmessage;
  proc.port.onmessage = (e) => {
    const d = e?.data;
    if (d && d.type === 'params' && d.values) {
      const v = FULL.defaultValues();
      v.set(d.values.subarray(0, Math.min(d.values.length, v.length)));
      for (const p of FULL.PARAMS) if (p.twinOf !== undefined) v[p.index] = v[p.twinOf];
      return handle({ data: { ...d, values: v } });
    }
    return handle(e);
  };
  return { proc, name: names[0] };
}

function defaults() {
  const v = new Float32Array(NUM_PARAMS);
  Object.assign(v, { [G.inputGain]: 0, [G.analog]: 0.5, [G.resOffset]: 0, [G.fbAllOn]: 0, [G.fbAll]: 0.35, [G.fbAllTone]: 6000, [G.spread]: 0, [G.mix]: 1, [G.outputGain]: 0, [G.bypass]: 0 });
  for (let b = 0; b < NB; b++) { v[bi(b, 'gain')] = 0; v[bi(b, 'res')] = 0.3; v[bi(b, 'fb')] = 0; }
  return v;
}

/** render `seconds`; inputFn(n) -> [l, r] or null (missing input) */
function render(params, seconds, inputFn, onBlock) {
  const { proc } = loadProcessor();
  proc.port.onmessage({ data: { type: 'params', values: params } });
  const total = Math.round(seconds * FS);
  const L = new Float32Array(total), R = new Float32Array(total);
  const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  const iL = new Float32Array(BLOCK), iR = new Float32Array(BLOCK);
  for (let pos = 0; pos < total; pos += BLOCK) {
    let inputs = [[]];
    if (inputFn) {
      for (let i = 0; i < BLOCK; i++) {
        const v = inputFn(pos + i);
        iL[i] = v ? v[0] : 0; iR[i] = v ? v[1] : 0;
      }
      inputs = [[iL, iR]];
    }
    if (onBlock) onBlock(proc, pos);
    proc.process(inputs, [[outL, outR]]);
    const m = Math.min(BLOCK, total - pos);
    L.set(outL.subarray(0, m), pos); R.set(outR.subarray(0, m), pos);
  }
  return { L, R, proc };
}

/* ---------- analysis helpers ---------- */
function fftMag(sig, size) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < Math.min(size, sig.length); i++) re[i] = sig[i];
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < size; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
function peakFreq(sig, size = 1 << 18, fmin = 10) {
  const mag = fftMag(sig, size);
  let best = Math.ceil((fmin * size) / FS);
  for (let i = best; i < mag.length - 1; i++) if (mag[i] > mag[best]) best = i;
  // parabolic interpolation on log magnitude
  const a = Math.log(mag[best - 1] + 1e-30), b = Math.log(mag[best] + 1e-30), c = Math.log(mag[best + 1] + 1e-30);
  const p = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return ((best + p) * FS) / size;
}
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
const allFinite = (...xs) => xs.every((x) => x.every(Number.isFinite));
const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

const results = [];
const check = (name, pass, detail) => { results.push({ test: name, result: pass ? 'PASS' : 'FAIL', detail }); };
const soloBand = (v, b) => { for (let j = 0; j < NB; j++) v[bi(j, 'gain')] = j === b ? 0 : -60; };

/* 1. impulse response per band */
{
  const rows = [];
  let ok = true;
  for (let b = 0; b < NB; b++) {
    const v = defaults(); v[G.analog] = 0; soloBand(v, b);
    const { L, R } = render(v, 2.8, (n) => (n === 0 ? [0.25, 0.25] : null));
    const fL = peakFreq(L), fR = peakFreq(R);
    const errL = (fL / BAND_FREQS[b] - 1) * 100, errR = (fR / BAND_FREQS[b] - 1) * 100;
    const pass = Math.abs(errL) < 5 && Math.abs(errR) < 5;
    ok &&= pass;
    rows.push({ band: b + 1, nominal: BAND_FREQS[b], peakL: fL.toFixed(1), peakR: fR.toFixed(1), 'err %': errL.toFixed(2), ok: pass });
  }
  console.log('\n1. Impulse response peak per band (analog 0, res 0.3)');
  console.table(rows);
  check('1 band centres ±5 %', ok, 'all 10 bands');
}

/* 2. default settings, white noise */
{
  const v = defaults();
  const { L, R } = render(v, 3, () => { const x = rnd() * 0.5; return [x, rnd() * 0.5]; });
  const r = Math.max(rms(L), rms(R));
  const fin = allFinite(L, R);
  check('2 default + white noise', fin && r < 2, `finite=${fin}, out RMS ${db(r)} dBFS (in RMS ${db(0.5 / Math.sqrt(3))} dBFS)`);
}

/* 3. res=1, impulse ringing */
{
  const rows = [];
  let ok = true;
  for (const b of [0, 2]) {
    const v = defaults(); v[G.analog] = 0; soloBand(v, b); v[bi(b, 'res')] = 1;
    const { L, R } = render(v, 3, (n) => (n === 0 ? [0.5, 0.5] : null));
    const w = 4800;
    const r0 = rms(L, 2400, 2400 + w), r1 = rms(L, FS, FS + w), r2 = rms(L, 2 * FS, 2 * FS + w);
    // ringing: at 1 s still within 60 dB of the early level; decaying monotonically
    const pass = allFinite(L, R) && r1 > r0 * 1e-3 && r2 < r1 && r1 < r0;
    ok &&= pass;
    rows.push({ band: b + 1, 'rms@0.05s dB': db(r0), 'rms@1s dB': db(r1), 'rms@2s dB': db(r2), ok: pass });
  }
  console.log('\n3. res = 1 impulse ringing');
  console.table(rows);
  check('3 res=1 rings >1 s and decays', ok, 'bands 1 (29 Hz) and 3 (115 Hz)');
}

/* 4. per-band fb=1 self-oscillation */
{
  const rows = [];
  let ok = true;
  for (let b = 0; b < NB; b++) {
    const v = defaults(); soloBand(v, b); v[bi(b, 'fb')] = 1;
    const { L, R } = render(v, 5, null);
    const pk = Math.max(peak(L), peak(R));
    const last = L.subarray(4 * FS);
    const f = peakFreq(last, 1 << 18);
    const err = (f / BAND_FREQS[b] - 1) * 100;
    const amp = rms(last) * Math.SQRT2;
    const pass = allFinite(L, R) && pk < 2 && Math.abs(err) < 5 && amp > 0.05;
    ok &&= pass;
    rows.push({ band: b + 1, nominal: BAND_FREQS[b], osc: f.toFixed(1), 'err %': err.toFixed(2), 'amp(last 1s)': amp.toFixed(3), peak: pk.toFixed(3), ok: pass });
  }
  // edge check: fb 0.8 should NOT self-oscillate
  const v = defaults(); soloBand(v, 4); v[bi(4, 'fb')] = 0.8;
  const { L } = render(v, 5, null);
  const quiet = rms(L.subarray(4 * FS)) < 1e-3;
  console.log('\n4. Per-band fb = 1, silence in (5 s)');
  console.table(rows);
  console.log(`   fb = 0.80 on band 5: last-second RMS ${db(rms(L.subarray(4 * FS)))} dBFS (should not self-oscillate)`);
  check('4 fb=1 self-osc at centre, bounded', ok && quiet, `fb 0.8 silent: ${quiet}`);
}

/* 5. fbAll on, amount 1 */
{
  const v = defaults(); v[G.fbAllOn] = 1; v[G.fbAll] = 1; v[G.fbAllTone] = 20000;
  const burst = 0.2 * FS;
  const { L, R, proc } = render(v, 5.2, (n) => (n < burst ? [rnd() * 0.5, rnd() * 0.5] : [0, 0]));
  const pk = Math.max(peak(L), peak(R));
  const tail = rms(L, 4.2 * FS);
  const hot = proc.port.sent.some((m) => m.type === 'meters' && m.hot);
  check('5 fbAll=1 noise burst + 5 s silence', allFinite(L, R) && pk <= 1.05, `peak ${pk.toFixed(3)}, tail RMS ${db(tail)} dBFS (self-osc), hot flag seen=${hot}`);
  // amount sweep: where does it start to self-oscillate?
  const sweep = [];
  for (const a of [0.6, 0.7, 0.8, 0.9, 1.0]) {
    const w = defaults(); w[G.fbAllOn] = 1; w[G.fbAll] = a; w[G.fbAllTone] = 20000;
    const r = render(w, 4, (n) => (n < burst ? [rnd() * 0.5, rnd() * 0.5] : [0, 0]));
    sweep.push({ amount: a, 'tail RMS dB (3-4 s)': db(rms(r.L, 3 * FS)) });
  }
  const tails = sweep.map((r) => parseFloat(r['tail RMS dB (3-4 s)']));
  check('5b fbAll edge between 0.8 and 1.0', tails[0] < -60 && tails[2] < -60 && tails[4] > -30, sweep.map((r) => `${r.amount}:${r['tail RMS dB (3-4 s)']}`).join(' '));
  console.log('\n5. Feedback All amount sweep (tone 20k, faders 0 dB)');
  console.table(sweep);
}

/* 6. worst case */
{
  const v = defaults();
  v[G.inputGain] = 24; v[G.fbAllOn] = 1; v[G.fbAll] = 1; v[G.fbAllTone] = 20000; v[G.resOffset] = 1; v[G.analog] = 1; v[G.outputGain] = 12;
  for (let b = 0; b < NB; b++) { v[bi(b, 'gain')] = 12; v[bi(b, 'res')] = 1; v[bi(b, 'fb')] = 1; }
  const { L, R } = render(v, 10, (n) => [rnd(), rnd()]);
  const pk = Math.max(peak(L), peak(R));
  check('6 everything maxed, 10 s', allFinite(L, R) && pk <= 1.05, `peak ${pk.toFixed(4)}, RMS ${db(rms(L))} dBFS`);
}

/* 7. messages + misc: ready, meters, bypass, mono input, reset */
{
  const v = defaults(); v[G.bypass] = 1;
  const { L, R, proc } = render(v, 0.5, (n) => [Math.sin(n * 0.01) * 0.5, Math.sin(n * 0.01) * 0.5]);
  let err = 0; for (let n = 0; n < L.length; n++) err = Math.max(err, Math.abs(L[n] - Math.sin(n * 0.01) * 0.5), Math.abs(R[n] - Math.sin(n * 0.01) * 0.5));
  const ready = proc.port.sent[0]?.type === 'ready';
  const meters = proc.port.sent.filter((m) => m.type === 'meters').length;
  check('7 ready / meters / bypass', ready && meters >= 14 && meters <= 16 && err < 1e-6, `ready=${ready}, ${meters} meter frames in 0.5 s, bypass max err ${err.toExponential(1)}`);
}

/* 7b. zipper / click check: abrupt param + toggle changes on a 100 Hz sine */
{
  const v = defaults(); v[G.mix] = 0.5;
  const sine = (n) => { const x = 0.5 * Math.sin((2 * Math.PI * 100 * n) / FS); return [x, x]; };
  const changes = { [Math.round(0.3 * FS / BLOCK) * BLOCK]: (w) => { w[G.outputGain] = -24; w[G.bypass] = 1; },
                    [Math.round(0.6 * FS / BLOCK) * BLOCK]: (w) => { w[G.outputGain] = 12; w[G.bypass] = 0; w[G.fbAllOn] = 1; w[bi(2, 'gain')] = 6; },
                    [Math.round(0.9 * FS / BLOCK) * BLOCK]: (w) => { w[G.mix] = 0; w[bi(2, 'gain')] = -60; w[G.spread] = 1; } };
  const w = v.slice();
  const { L } = render(v, 1.2, sine, (proc, pos) => { if (changes[pos]) { changes[pos](w); proc.port.onmessage({ data: { type: 'params', values: w.slice() } }); } });
  // a click shows up as a first difference during the 30 ms transition that is much larger than
  // in the settled signal before and after the change
  const maxDiff = (a, b) => { let m = 0; for (let n = Math.max(1, a); n < Math.min(L.length, b); n++) m = Math.max(m, Math.abs(L[n] - L[n - 1])); return m; };
  const rows = [];
  let ok = true;
  for (const pos of Object.keys(changes).map(Number)) {
    const trans = maxDiff(pos, pos + 0.03 * FS);
    const settled = Math.max(maxDiff(pos - 0.1 * FS, pos), maxDiff(pos + 0.15 * FS, pos + 0.25 * FS));
    const pass = trans <= settled * 1.5 + 0.005;
    ok &&= pass;
    rows.push({ at: (pos / FS).toFixed(2) + ' s', 'transition max|Δx|': trans.toFixed(4), 'settled max|Δx|': settled.toFixed(4), ok: pass });
  }
  console.log('\n7b. Param / toggle jumps on a 100 Hz sine (outputGain, bypass, fbAllOn, fader, mix, spread)');
  console.table(rows);
  check('7b no clicks on param/toggle jumps', ok, '3 change points');
}

/* 8. performance: time spent inside process() only (input pre-generated) */
{
  const v = defaults(); v[G.fbAllOn] = 1; v[G.spread] = 0.5;
  for (let b = 0; b < NB; b++) v[bi(b, 'fb')] = 0.5;
  const { proc } = loadProcessor();
  proc.port.onmessage({ data: { type: 'params', values: v } });
  const blocks = Math.ceil((10 * FS) / BLOCK);
  const iL = new Float32Array(BLOCK * 64), iR = new Float32Array(BLOCK * 64);
  for (let i = 0; i < iL.length; i++) { iL[i] = rnd() * 0.3; iR[i] = rnd() * 0.3; }
  const outs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  const ins = [];
  for (let k = 0; k < 64; k++) ins.push([[iL.subarray(k * BLOCK, (k + 1) * BLOCK), iR.subarray(k * BLOCK, (k + 1) * BLOCK)]]);
  for (let k = 0; k < 400; k++) proc.process(ins[k & 63], outs); // warm-up
  // best of 3: shared test machines are noisy. 15x leaves ample headroom for the extra modules.
  let ms = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    for (let k = 0; k < blocks; k++) proc.process(ins[k & 63], outs);
    ms = Math.min(ms, performance.now() - t0);
  }
  const x = 10000 / ms;
  check('8 performance (10 s stereo)', x > 15, `${ms.toFixed(0)} ms in process() → ${x.toFixed(1)}x realtime (best of 3)`);
}

console.log('\nSummary');
console.table(results);
const failed = results.filter((r) => r.result !== 'PASS').length;
process.exit(failed ? 1 : 0);
