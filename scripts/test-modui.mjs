// Offline tests for the modulation UI helpers (src/ui/mod/labels.ts): target lists for the
// Mod Matrix, labels, macro names in snapshots, depth ranges.
// Run: node scripts/test-modui.mjs   (the DOM parts are checked in the browser with Playwright)
import { check, importTs, results } from './testkit.mjs';

const L = importTs('src/ui/mod/labels.ts');
const R = importTs('src/shared/mod/routing.ts');
const P = importTs('src/shared/params.ts');

/* ---------- 1. target groups for the add-route form ---------- */
{
  const r = new R.ModRouting();
  const groups = L.targetGroups(r, 'lfo1');
  const names = groups.map((g) => g.label);
  const opt = (id) => groups.flatMap((g) => g.options).find((o) => o.id === id);
  const all = groups.flatMap((g) => g.options);
  const want = ['Resonator', 'Band 1', 'Band 10', 'Band Dynamics', 'Pre Filter', 'Post Filter', 'LFO 1', 'LFO 4', 'Clock Mod 2', 'Env Follower 4', 'Clock'];
  const missing = want.filter((w) => !names.includes(w));
  const noToggles = all.every((o) => P.PARAM_BY_ID[o.id].curve !== 'toggle');
  const noMacros = !all.some((o) => /^macro/.test(o.id));
  const noDepths = !names.includes('Route depths');
  check(
    '1 targets grouped by module, no toggles / macros / unused depths',
    !missing.length && noToggles && noMacros && noDepths,
    missing.length ? `missing ${missing}` : `${names.length} groups, ${all.length} targets`,
  );
  const cases = [
    ['band2.res allowed', opt('band2.res')?.reason === null],
    ['lfo1.rate: itself', /itself/.test(opt('lfo1.rate')?.reason ?? '')],
    ['lfo2.shape: stepped', /Stepped/.test(opt('lfo2.shape')?.reason ?? '')],
    ['clock.bpm: tempo', /tempo/.test(opt('clock.bpm')?.reason ?? '')],
    ['band label', opt('band2.res')?.label === 'Band 3 Resonance'],
  ];
  const bad = cases.filter(([, ok]) => !ok).map(([n]) => n);
  check('2 disabled targets carry the reason', !bad.length, bad.length ? `wrong: ${bad}` : `${cases.length} cases`);
}

/* ---------- 2. route depths and loops ---------- */
{
  const r = new R.ModRouting();
  const a = r.addRoute('lfo1', 'band2.res');
  r.addRoute('lfo1', 'lfo2.rate');
  const groups = L.targetGroups(r, 'macro1');
  const depths = groups.find((g) => g.label === 'Route depths');
  const d0 = depths?.options.find((o) => o.id === a.depthParam);
  check(
    '3 depths of existing routes are targets, labelled by route',
    depths?.options.length === 2 && d0?.label === 'Depth LFO 1 → Band 3 Resonance' && d0.reason === null,
    depths ? depths.options.map((o) => o.label).join(' | ') : 'no group',
  );
  const loop = L.targetGroups(r, 'lfo2').flatMap((g) => g.options).find((o) => o.id === 'lfo1.rate');
  const dup = L.targetGroups(r, 'lfo1').flatMap((g) => g.options).find((o) => o.id === 'band2.res');
  check('4 loops and duplicates disabled', /loop/.test(loop?.reason ?? '') && /already/.test(dup?.reason ?? ''), `${loop?.reason} | ${dup?.reason}`);
}

/* ---------- 3. names ---------- */
{
  let fired = 0;
  const off = L.onSourceNames(() => fired++);
  L.setSourceName('macro3', 'Sweep');
  const a = L.sourceLabel('macro3') === 'Sweep' && L.targetLabel('macro3.value') === 'Sweep';
  L.setSourceName('macro3', 'Sweep'); // no change, no event
  L.setSourceName('macro3', 'Macro 3'); // default name clears the override
  const b = L.sourceLabel('macro3') === 'Macro 3' && L.sourceLabel('lfo2') === 'LFO 2';
  off();
  check('5 source renames (macros)', a && b && fired === 2, `events ${fired}`);
}

/* ---------- 4. macro names in snapshots ---------- */
{
  const def = L.parseMacroNames(undefined);
  const odd = L.parseMacroNames({ names: ['A', '   ', 5, 'x'.repeat(40), ' Bass '] });
  const junk = L.parseMacroNames({ names: 'nope' });
  check(
    '6 parseMacroNames validates and falls back to defaults',
    def.length === 8 && def[7] === 'Macro 8' && odd[0] === 'A' && odd[1] === 'Macro 2' && odd[2] === 'Macro 3' && odd[3].length === L.MACRO_NAME_MAX && odd[4] === 'Bass' && junk[0] === 'Macro 1',
    JSON.stringify(odd.slice(0, 5)),
  );
}

/* ---------- 5. depth ranges / polarity ---------- */
{
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const ok =
    eq(L.depthRange(0.5, 0.3, false), [0.5, 0.8]) &&
    eq(L.depthRange(0.5, -0.3, false), [0.2, 0.5]) &&
    eq(L.depthRange(0.5, -0.3, true), [0.2, 0.8]) &&
    eq(L.depthRange(0.9, 0.5, true), [0.4, 1]);
  const vals = { 'lfo1.uni': 0, 'lfo2.uni': 1, 'cmod1.uni': 1 };
  const get = (id) => vals[id] ?? 0;
  const pol = L.sourceBipolar('lfo1', get) && !L.sourceBipolar('lfo2', get) && !L.sourceBipolar('cmod1', get) && !L.sourceBipolar('macro1', get) && !L.sourceBipolar('ef1', get);
  const fmt = L.formatDepth(0.6) === '+60 %' && L.formatDepth(-0.25) === '−25 %' && L.formatDepth(0) === '0 %';
  check('7 depth range, source polarity, depth text', ok && pol && fmt);
}

console.log('\nModulation UI tests');
console.table(results);
