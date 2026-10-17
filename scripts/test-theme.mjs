// Offline tests for the AUTO theme generator (src/ui/themeGen.ts): same seed → same theme, every
// colour token set and valid, readable text and signal colours on many random seeds.
// Run: node scripts/test-theme.mjs
import { check, importTs, results } from './testkit.mjs';

const G = importTs('src/ui/themeGen.ts');
const N = 500;
const themes = Array.from({ length: N }, (_, i) => G.generateTheme((i * 2654435761) >>> 0));
const lin = (t, k) => G.hexToLinear(t.vars[k]);
const minOver = (f) => Math.min(...themes.map(f));

/* ---------- 1. deterministic ---------- */
{
  const a = G.generateTheme(12345);
  const b = G.generateTheme(12345);
  const c = G.generateTheme(12346);
  check('1 same seed same theme, other seed other theme', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a.vars) !== JSON.stringify(c.vars));
}

/* ---------- 2. all tokens valid ---------- */
{
  const keys = Object.keys(themes[0].vars);
  const ok = themes.every(
    (t) => Object.keys(t.vars).length === keys.length && Object.values(t.vars).every((v) => /^#[0-9a-f]{6}$|^rgb\(\d+ \d+ \d+ \/ [\d.]+\)$/.test(v)),
  );
  check('2 every colour token set and valid', ok, `${keys.length} tokens`);
}

/* ---------- 3. readable text ---------- */
{
  const t1 = minOver((t) => G.contrast(lin(t, '--c-text'), lin(t, '--c-panel')));
  const t2 = minOver((t) => G.contrast(lin(t, '--c-text-2'), lin(t, '--c-panel')));
  const t1r = minOver((t) => G.contrast(lin(t, '--c-text'), lin(t, '--c-raised')));
  check('3 text ≥ 7:1, text-2 ≥ 4.5:1 on the panel, text ≥ 4.5:1 on buttons', t1 >= 7 && t2 >= 4.5 && t1r >= 4.5, `${t1.toFixed(1)} / ${t2.toFixed(1)} / ${t1r.toFixed(1)}`);
}

/* ---------- 4. signal colours stand out ---------- */
{
  const sig = minOver((t) => Math.min(...['--c-accent', '--c-fb', '--c-mod'].map((k) => G.contrast(lin(t, k), lin(t, '--c-panel')))));
  const ink = minOver((t) => G.contrast(lin(t, '--c-accent-ink'), lin(t, '--c-accent')));
  check('4 accent / fb / mod ≥ 3:1 on the panel, text on accent ≥ 3:1', sig >= 3 && ink >= 3, `${sig.toFixed(2)} / ${ink.toFixed(2)}`);
}

/* ---------- 5. variety ---------- */
{
  const accents = new Set(themes.map((t) => t.vars['--c-accent']));
  const light = themes.filter((t) => t.mode === 'light').length;
  const names = new Set(themes.map((t) => t.name.split(' · ')[0]));
  check('5 many different themes, both modes, every scheme', accents.size > N * 0.9 && light > N * 0.35 && light < N * 0.65 && names.size === 5, `${accents.size} accents, ${light} light`);
}

/* ---------- 6. range: dark / light stay on their side, any covers all brightness ---------- */
{
  const d = Array.from({ length: 200 }, (_, i) => G.generateTheme(i * 7919, 'dark'));
  const l = Array.from({ length: 200 }, (_, i) => G.generateTheme(i * 7919, 'light'));
  const Y = (t) => G.luminance(G.hexToLinear(t.vars['--c-panel']));
  const sides = d.every((t) => t.mode === 'dark' && Y(t) < 0.12) && l.every((t) => t.mode === 'light' && Y(t) > 0.45);
  const steps = new Set(themes.map((t) => t.name.split(' · ')[2]));
  const ys = themes.map(Y);
  check(
    '6 DARK→dark, LIGHT→light, any brightness spans dark…light',
    sides && steps.size === 4 && Math.min(...ys) < 0.01 && Math.max(...ys) > 0.85,
    `panel Y ${Math.min(...ys).toFixed(3)}…${Math.max(...ys).toFixed(2)}, ${[...steps].join('/')}`,
  );
}

console.log("\nTheme generator tests");
console.table(results);
