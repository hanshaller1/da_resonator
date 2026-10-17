// Offline tests for the SPECTR analysis helpers: note names, peak marks, band levels and the
// feedback warning (src/ui/tabs/spectr/). The drawing is checked in the browser with Playwright.
// Run: node scripts/test-spectr.mjs
import { check, importTs, results } from './testkit.mjs';

const PK = importTs('src/ui/tabs/spectr/peaks.ts');
const BL = importTs('src/ui/tabs/spectr/bands.ts');

/* ---------- 1. note names ---------- */
{
  const got = [PK.noteName(440), PK.noteName(261.63), PK.noteName(445), PK.noteName(55)];
  check('1 note names (A4, C4, cents, A1)', got[0] === 'A4' && got[1] === 'C4' && got[2] === 'A4 +20¢' && got[3] === 'A1', got.join(' | '));
}

/* ---------- 2. peak marks: loudest distinct, prominent peaks ---------- */
{
  const n = 400;
  const vals = new Float32Array(n).fill(-80);
  const bump = (c, h, wd) => {
    for (let i = 0; i < n; i++) vals[i] = Math.max(vals[i], -80 + h * Math.exp(-(((i - c) / wd) ** 2)));
  };
  bump(50, 40, 3); // −40
  bump(150, 30, 3); // −50
  bump(154, 25, 2); // shoulder of 150, too close: not its own mark
  bump(250, 50, 3); // −30, loudest
  bump(330, 20, 3); // −60, fourth: left out
  vals[100] = -77; // too small to count
  const freqAt = (i) => 20 * Math.pow(2, i / 40);
  const p = PK.findPeaks(vals, freqAt);
  const cols = p.map((q) => Math.round(q.col));
  check('2 three loudest peaks in level order, no shoulder or ripple', cols.join() === '250,50,150', cols.join() + ' · ' + p.map((q) => q.db.toFixed(1)).join());
  const fOk = Math.abs(Math.log2(p[0].f / (20 * Math.pow(2, 250.5 / 40)))) < 0.02;
  check('2b peak frequency at the column centre', fOk, `${p[0].f.toFixed(1)} Hz`);
}

/* ---------- 3. band levels and feedback warning ---------- */
{
  const w = 1000;
  const colPx = 2;
  const cols = w / colPx;
  const inC = new Float32Array(cols).fill(-50);
  const outC = new Float32Array(cols).fill(-50);
  // band 6 (column 5): output 26 dB above the input
  for (let i = 0; i < cols; i++) if (Math.floor(((i + 0.5) * colPx * 10) / w) === 5) outC[i] = -24;
  const b = new BL.BandLevels();
  for (let k = 0; k < 40; k++) b.update(inC, outC, colPx, w, 50);
  check('3 band levels and difference', Math.abs(b.inDb[5] + 50) < 0.5 && Math.abs(b.outDb[5] + 24) < 0.5 && Math.abs(b.diff(0)) < 0.5, `in ${b.inDb[5].toFixed(1)} out ${b.outDb[5].toFixed(1)}`);
  check('3b warning on band 6 only', b.worst() === 5 && b.warn[5] === 1 && b.warn[4] === 0, `worst ${b.worst()} warn ${Array.from(b.warn, (v) => v.toFixed(1)).join(' ')}`);
  // same difference, but quiet: no warning; and the warning fades
  const q = new BL.BandLevels();
  const outQ = outC.map((v) => v - 50);
  const inQ = inC.map((v) => v - 50);
  for (let k = 0; k < 40; k++) q.update(inQ, outQ, colPx, w, 50);
  for (let k = 0; k < 20; k++) b.update(inC, inC, colPx, w, 50);
  check('3c no warning on quiet signals, warning fades', q.worst(0.01) === -1 && b.warn[5] === 0, `quiet worst ${q.worst(0.01)}, faded ${b.warn[5]}`);
}

console.log("\nSPECTR analysis tests");
console.table(results);
