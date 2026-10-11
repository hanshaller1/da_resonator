/**
 * Built-in test material, synthesised on the fly into looping stereo buffers.
 * Chosen to show off a resonant filterbank: sparse clicks (pure excitation),
 * pink noise (shows the band shape), a drum loop and a chord pad.
 */

type F32 = Float32Array<ArrayBuffer>;
type Gen = (sr: number) => [F32, F32];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

const BPM = 112;
const beat = 60 / BPM;

const pulses: Gen = (sr) => {
  const len = Math.round(beat * 8 * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  const r = rng(7);
  // 16th-note grid, euclidean-ish pattern with accents
  const pattern = [1, 0, 0, 0.5, 0, 0, 0.8, 0, 0, 0.4, 0, 0, 0.7, 0, 0.3, 0];
  for (let step = 0; step < 32; step++) {
    const v = pattern[step % 16] * (step === 16 ? 0.9 : 1);
    if (!v) continue;
    const t = Math.round(((step * beat) / 4) * sr);
    const pan = r() * 0.4;
    // percussive 'ping': a few ms of decaying noise plus a short pulse – enough energy
    // to make resonant bands ring audibly (a single-sample click is far too quiet)
    const n = Math.round(0.006 * sr);
    for (let k = 0; k < n && t + k < len; k++) {
      const env = Math.exp((-k / sr) * 900);
      const s = 0.6 * v * (0.9 * r() * env + (k < sr * 0.0005 ? 0.6 : 0));
      L[t + k] += s * (1 - pan);
      R[t + k] += s * (1 + pan);
    }
  }
  return [L, R];
};

const pinkNoise: Gen = (sr) => {
  const len = Math.round(4 * sr);
  const out: F32[] = [];
  for (const seed of [11, 23]) {
    const r = rng(seed);
    const x = new Float32Array(len);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = r();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.08;
      b6 = w * 0.115926;
    }
    // crossfade loop seam
    const f = Math.round(0.05 * sr);
    for (let i = 0; i < f; i++) {
      const a = i / f;
      x[i] = x[i] * a + x[len - f + i] * (1 - a);
    }
    out.push(x.subarray(0, len - f).slice());
  }
  return [out[0], out[1]];
};

const drums: Gen = (sr) => {
  const len = Math.round(beat * 8 * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  const r = rng(99);
  const add = (t0: number, dur: number, f: (t: number) => number, pan = 0) => {
    const s0 = Math.round(t0 * sr), n = Math.round(dur * sr);
    for (let i = 0; i < n && s0 + i < len; i++) {
      const v = f(i / sr);
      L[s0 + i] += v * (1 - pan);
      R[s0 + i] += v * (1 + pan);
    }
  };
  const kick = (t: number) => {
    const ph = 2 * Math.PI * (45 * t + (120 / 18) * (1 - Math.exp(-18 * t)));
    return Math.sin(ph) * Math.exp(-6 * t) * 0.9;
  };
  const snare = (t: number) => (r() * 0.5 * Math.exp(-18 * t) + Math.sin(2 * Math.PI * 190 * t) * 0.35 * Math.exp(-25 * t));
  const hat = (t: number) => r() * 0.18 * Math.exp(-60 * t);
  const sixteenth = beat / 4;
  for (let bar = 0; bar < 2; bar++) {
    const o = bar * beat * 4;
    [0, 2.5].forEach((b) => add(o + b * beat, 0.5, kick));
    if (bar === 1) add(o + 3.25 * beat, 0.4, kick);
    [1, 3].forEach((b) => add(o + b * beat, 0.3, snare, 0.05));
    for (let s = 0; s < 16; s++) add(o + s * sixteenth, 0.08, (t) => hat(t) * (s % 4 === 2 ? 1 : 0.55), -0.3);
  }
  return [L, R];
};

const chords: Gen = (sr) => {
  const len = Math.round(beat * 16 * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  const prog = [
    [45, 57, 60, 64, 67], // Am7
    [41, 53, 57, 60, 64], // Fmaj7
    [48, 55, 60, 64, 71], // Cmaj7
    [43, 55, 59, 62, 69], // G6/9-ish
  ];
  const segLen = len / prog.length;
  const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  for (let c = 0; c < prog.length; c++) {
    const s0 = Math.round(c * segLen), n = Math.round(segLen);
    prog[c].forEach((note, vi) => {
      for (const [det, ch] of [[-0.12, L], [0.12, R]] as const) {
        const f = midi(note) * Math.pow(2, det / 12 / 4);
        let ph = vi * 0.13;
        for (let i = 0; i < n; i++) {
          ph += f / sr; ph -= Math.floor(ph);
          const saw = 2 * ph - 1;
          const env = Math.min(1, i / (0.08 * sr)) * Math.min(1, (n - i) / (0.15 * sr));
          ch[s0 + i] += saw * env * 0.06;
        }
      }
    });
  }
  // gentle one-pole lowpass so it isn't harsh
  for (const ch of [L, R]) {
    let y = 0;
    for (let i = 0; i < len; i++) ch[i] = y += 0.25 * (ch[i] - y);
  }
  return [L, R];
};

export const TEST_SIGNALS = { pulses, noise: pinkNoise, drums, chords } as const;
export type TestSignalKind = keyof typeof TEST_SIGNALS;

export function renderTestSignal(ctx: BaseAudioContext, kind: TestSignalKind): AudioBuffer {
  const [l, r] = TEST_SIGNALS[kind](ctx.sampleRate);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.copyToChannel(l, 0);
  buf.copyToChannel(r, 1);
  return buf;
}
