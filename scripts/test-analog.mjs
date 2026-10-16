// Offline tests for the ANALOG drive (2026-10-16): up to 0.5 as before, above it the distortion grows
// with the knob at about the same level, no clicks while turning, silence stays silent.
// Run: node scripts/test-analog.mjs
import { BLOCK, FS, check, importTs, loadProcessor, results, run } from './testkit.mjs';

const P = importTs('src/shared/params.ts');
const idx = (id) => P.paramIndex(id);
const F0 = 220;
const sine = (amp) => (n) => amp * Math.sin((2 * Math.PI * F0 * n) / FS);
const goertzel = (x, f) => {
  let re = 0, im = 0;
  for (let n = 0; n < x.length; n++) {
    const w = (2 * Math.PI * f * n) / FS;
    re += x[n] * Math.cos(w);
    im -= x[n] * Math.sin(w);
  }
  return (Math.hypot(re, im) * 2) / x.length;
};
function render(an, input, seconds = 0.6, onBlock) {
  const v = P.defaultValues();
  v[idx('analog')] = an;
  v[idx('mix')] = 1;
  const proc = loadProcessor();
  proc.port.onmessage({ data: { type: 'params', values: v } });
  return { v, out: run(proc, Math.round((seconds * FS) / BLOCK), input, onBlock && ((k) => onBlock(proc, k, v))) };
}
/** THD (%) and RMS (dBFS) of the last 40 periods */
function measure(an, amp = 0.3) {
  const { out } = render(an, sine(amp));
  const N = Math.round(FS / F0) * 40;
  const x = out.L.slice(out.L.length - N);
  const h1 = goertzel(x, F0);
  let hs = 0;
  for (let k = 2; k <= 15; k++) hs += goertzel(x, F0 * k) ** 2;
  let rms = 0;
  for (const s of x) rms += s * s;
  return { thd: (100 * Math.sqrt(hs)) / h1, rms: 10 * Math.log10(rms / x.length) };
}

/* ---------- 1. distortion grows with the knob ---------- */
const steps = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((an) => ({ an, ...measure(an) }));
const at = (an) => steps.find((s) => s.an === an);
check('1a up to 0.5 clean as before (THD < 1 %)', at(0).thd < 1 && at(0.5).thd < 1, `0: ${at(0).thd.toFixed(2)} %, 0.5: ${at(0.5).thd.toFixed(2)} %`);
const upper = steps.filter((s) => s.an >= 0.5);
check('1b above 0.5 the distortion rises with every step', upper.every((s, i) => i === 0 || s.thd > upper[i - 1].thd * 1.1), upper.map((s) => `${s.an}: ${s.thd.toFixed(1)} %`).join(', '));
check('1c full: heavy distortion (THD > 30 %)', at(1).thd > 30, `${at(1).thd.toFixed(1)} %`);
check('1d level stays within 6 dB of the clean sound', upper.every((s) => Math.abs(s.rms - at(0.5).rms) < 6), upper.map((s) => `${s.an}: ${(s.rms - at(0.5).rms).toFixed(1)} dB`).join(', '));

/* ---------- 2. silence stays silent (the off-centre clipper adds no offset) ---------- */
{
  const { out } = render(1, () => 0, 0.5);
  const peak = out.L.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  check('2 full drive on silence: no offset, no noise burst', peak < 1e-3, `peak ${peak.toExponential(1)}`);
}

/* ---------- 3. turning the knob: no clicks ---------- */
{
  const turn = Math.round((0.3 * FS) / BLOCK);
  const back = Math.round((0.7 * FS) / BLOCK);
  const { out } = render(0.5, sine(0.3), 1.1, (proc, k, v) => {
    if (k === turn - 1 || k === back - 1) {
      const w = v.slice();
      w[idx('analog')] = k === turn - 1 ? 1 : 0.5;
      proc.port.onmessage({ data: { type: 'params', values: w } });
    }
  });
  const x = out.L;
  const maxDiff = (a, b) => {
    let m = 0;
    for (let n = Math.max(1, a); n < b; n++) m = Math.max(m, Math.abs(x[n] - x[n - 1]));
    return m;
  };
  const settled = Math.max(maxDiff(turn * BLOCK - 0.1 * FS, turn * BLOCK), maxDiff(turn * BLOCK + 0.2 * FS, back * BLOCK));
  const trans = Math.max(maxDiff(turn * BLOCK, turn * BLOCK + 0.1 * FS), maxDiff(back * BLOCK, back * BLOCK + 0.1 * FS));
  check('3 0.5 → 1 → 0.5 in one step: no click', trans <= settled * 1.1 && x.every(Number.isFinite), `turning ${trans.toFixed(4)}, settled ${settled.toFixed(4)}`);
}

console.table(results);
