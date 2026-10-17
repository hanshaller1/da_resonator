/**
 * Theme generator for the AUTO theme: one seed → one complete, harmonious colour set.
 *
 * Every colour is built in OKLCH (perceptual lightness, chroma, hue), so lightness steps look
 * even whatever the hue. The surfaces keep the fixed lightness ladder of the hand-made themes and
 * only get a faint tint; the three signal colours (accent, feedback, modulation) sit on a colour
 * wheel scheme (triadic, split complementary, square, analogous + complement) and share one
 * lightness and chroma, so they read as one family. Contrast is checked and fixed at the end.
 * No DOM here: theme.ts writes the result onto <html>.
 */

export type ThemeMode = 'light' | 'dark';

export interface GeneratedTheme {
  seed: number;
  mode: ThemeMode;
  /** short description, e.g. "triadic · teal" */
  name: string;
  /** CSS custom property → value (only the colour tokens of tokens.css) */
  vars: Record<string, string>;
}

type RGB = [number, number, number];

/** small seeded PRNG (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- OKLCH → sRGB ---------- */

function oklabToLinear(L: number, a: number, b: number): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (c: RGB) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH to linear sRGB; chroma is reduced until the colour fits the sRGB gamut */
function oklch(L: number, C: number, h: number): RGB {
  const rad = (h * Math.PI) / 180;
  const at = (c: number) => oklabToLinear(L, c * Math.cos(rad), c * Math.sin(rad));
  let rgb = at(C);
  if (inGamut(rgb)) return rgb;
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  rgb = at(lo);
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as RGB;
}

const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const to255 = (lin: RGB) => lin.map((v) => Math.round(Math.min(1, Math.max(0, gamma(v))) * 255)) as RGB;
const hex = (lin: RGB) => '#' + to255(lin).map((v) => v.toString(16).padStart(2, '0')).join('');
const rgba = (lin: RGB, a: number) => `rgb(${to255(lin).join(' ')} / ${a})`;

/** WCAG relative luminance of a linear sRGB colour */
export function luminance(lin: RGB): number {
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio of two linear sRGB colours */
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** '#rrggbb' → linear sRGB (for tests and contrast checks on generated values) */
export function hexToLinear(s: string): RGB {
  const n = parseInt(s.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

const wrap = (h: number) => ((h % 360) + 360) % 360;
const hueDist = (a: number, b: number) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 360 - d);
};

const HUE_NAMES: [number, string][] = [
  [20, 'rose'], [45, 'coral'], [70, 'amber'], [100, 'gold'], [125, 'lime'], [150, 'green'],
  [175, 'jade'], [200, 'teal'], [225, 'cyan'], [250, 'azure'], [275, 'blue'], [300, 'violet'],
  [325, 'purple'], [350, 'magenta'], [380, 'rose'],
];
const hueName = (h: number) => HUE_NAMES.find(([lim]) => wrap(h) < lim)![1];

/** the colour wheel schemes: offsets of feedback and modulation from the accent hue */
const SCHEMES: { name: string; fb: number; mod: number }[] = [
  { name: 'triadic', fb: 120, mod: 240 },
  { name: 'split', fb: 150, mod: 210 },
  { name: 'square', fb: 90, mod: 180 },
  { name: 'analog', fb: 45, mod: 180 },
  { name: 'tetrad', fb: 60, mod: 180 },
];

/** a fresh random seed */
export function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** build the theme of `seed` (the same seed always gives the same theme) */
export function generateTheme(seed: number): GeneratedTheme {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const range = (a: number, b: number) => a + (b - a) * r();

  const mode: ThemeMode = r() < 0.7 ? 'dark' : 'light';
  const dark = mode === 'dark';

  /* signal hues */
  const scheme = pick(SCHEMES);
  const dir = r() < 0.5 ? 1 : -1;
  const hA = range(0, 360);
  const hF = wrap(hA + dir * scheme.fb);
  const hM = wrap(hA + dir * scheme.mod);
  // the "running / healthy" green, pushed away from the signal hues when they are close
  const okCandidates = [150, 165, 135, 180, 120, 195];
  const hOk = okCandidates.reduce((best, h) =>
    Math.min(hueDist(h, hA), hueDist(h, hF)) > Math.min(hueDist(best, hA), hueDist(best, hF)) ? h : best,
  );

  /* surfaces: faint tint, either the accent's hue, its complement or a free hue */
  const hS = pick([hA, wrap(hA + 180), range(0, 360)]);
  const cS = range(0.006, dark ? 0.03 : 0.022);
  const lift = range(-0.025, 0.03); // whole ladder slightly darker / lighter
  const surf = (L: number, cMul = 1) => oklch(Math.min(1, Math.max(0, L + lift)), cS * cMul, hS);
  const ink = (L: number) => oklch(L, Math.min(0.02, cS * 0.6), hS);

  /* signal colours: one lightness and chroma for the family */
  const sigL = dark ? range(0.74, 0.84) : range(0.58, 0.66);
  const sigC = range(0.13, 0.19);
  const sig = (h: number, dL = 0) => oklch(sigL + dL, sigC, h);

  const s = dark
    ? {
        bg: surf(0.135), chassis: surf(0.17), panel: surf(0.195), panel2: surf(0.215), raised: surf(0.275),
        raisedHi: surf(0.315), well: surf(0.15), meterOff: surf(0.205), knobTrack: surf(0.265),
        knobCap: surf(0.28), knobEdge: surf(0.335), capTop: surf(0.43), capBottom: surf(0.285),
      }
    : {
        bg: surf(0.875), chassis: surf(0.92), panel: surf(0.955, 0.7), panel2: surf(0.935, 0.8),
        raised: surf(0.995, 0.3), raisedHi: surf(1, 0.2), well: surf(0.9), meterOff: surf(0.875),
        knobTrack: surf(0.875), knobCap: surf(0.985, 0.4), knobEdge: surf(0.84), capTop: surf(1, 0.2),
        capBottom: surf(0.9),
      };
  const text = dark ? [ink(0.94), ink(0.76), ink(0.58), ink(0.44)] : [ink(0.2), ink(0.44), ink(0.6), ink(0.75)];
  const pointer = dark ? ink(0.96) : ink(0.24);

  let accent = sig(hA);
  let fb = sig(hF, dark ? -0.04 : -0.02);
  let mod = sig(hM, dark ? 0.02 : -0.02);
  const ok = oklch(dark ? 0.8 : 0.6, 0.16, hOk);

  // signal colours must stand out from the panel (≥ 3:1, with room for rounding); nudge lightness until they do
  const fix = (c: RGB, h: number, L: number) => {
    let l = L;
    while (contrast(c, s.panel) < 3.2 && l > 0.3 && l < 0.97) {
      l += dark ? 0.02 : -0.02;
      c = oklch(l, sigC, h);
    }
    return c;
  };
  accent = fix(accent, hA, sigL);
  fb = fix(fb, hF, sigL);
  mod = fix(mod, hM, sigL);

  // text on accent: dark ink or white, whichever reads better
  const inkDark = oklch(0.17, 0.03, hA);
  const inkLight = oklch(1, 0, 0);
  const accentInk = contrast(accent, inkDark) >= contrast(accent, inkLight) ? inkDark : inkLight;

  const vars: Record<string, string> = {
    '--c-bg': hex(s.bg),
    '--c-chassis': hex(s.chassis),
    '--c-panel': hex(s.panel),
    '--c-panel-2': hex(s.panel2),
    '--c-raised': hex(s.raised),
    '--c-raised-hi': hex(s.raisedHi),
    '--c-well': hex(s.well),
    '--c-scrim': rgba(dark ? surf(0.1) : surf(0.9), dark ? 0.72 : 0.78),
    '--c-text': hex(text[0]),
    '--c-text-2': hex(text[1]),
    '--c-text-3': hex(text[2]),
    '--c-text-4': hex(text[3]),
    '--c-accent': hex(accent),
    '--c-accent-ink': hex(accentInk),
    '--c-accent-soft': rgba(accent, dark ? 0.16 : 0.14),
    '--c-accent-glow': rgba(accent, dark ? 0.45 : 0.35),
    '--c-fb': hex(fb),
    '--c-fb-soft': rgba(fb, dark ? 0.16 : 0.12),
    '--c-fb-glow': rgba(fb, dark ? 0.55 : 0.4),
    '--c-mod': hex(mod),
    '--c-mod-soft': rgba(mod, dark ? 0.18 : 0.15),
    '--c-ok': hex(ok),
    '--c-meter-lo': hex(ok),
    '--c-meter-mid': hex(accent),
    '--c-meter-hi': hex(fb),
    '--c-meter-off': hex(s.meterOff),
    '--c-knob-track': hex(s.knobTrack),
    '--c-knob-cap': hex(s.knobCap),
    '--c-knob-cap-edge': hex(s.knobEdge),
    '--c-knob-pointer': hex(pointer),
    '--c-cap-top': hex(s.capTop),
    '--c-cap-bottom': hex(s.capBottom),
    '--c-cap-line': hex(pointer),
    '--c-spec-in': rgba(text[1], 0.16),
    '--c-spec-out': rgba(accent, dark ? 0.2 : 0.18),
  };
  return { seed, mode, name: `${scheme.name} · ${hueName(hA)}`, vars };
}
