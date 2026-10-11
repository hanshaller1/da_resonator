// Offline tests for the preset system: snapshot round trips, v1 migration, import validation,
// the store (memory / localStorage / failing backends) and the session (dirty, A/B, stepping).
// Run: node scripts/test-presets.mjs
import { check, importTs, results } from './testkit.mjs';

const IO = importTs('src/presets/io.ts');
const ST = importTs('src/presets/store.ts');
// store tests use only the Init factory preset, independent of the shipped factory list
const INIT_ONLY = importTs('src/presets/factory.ts').factoryPresets([{ name: 'Init', category: 'Basic' }]);
const SE = importTs('src/presets/session.ts');
const { ParamStore } = importTs('src/core/ParamStore.ts');
const { ModController } = importTs('src/core/ModController.ts');
const { StateHub } = importTs('src/core/state.ts');

const tick = () => new Promise((r) => setTimeout(r, 0));
const micro = () => Promise.resolve();
const J = (x) => JSON.stringify(x);

/** the engine's state plumbing without audio: ParamStore + ModController + StateHub */
function makeEngine() {
  const params = new ParamStore();
  const mod = new ModController(params, () => {});
  const hub = new StateHub(params, mod);
  const macroNames = { names: ['Macro 1', 'Macro 2'] };
  hub.register('macros', { getState: () => ({ names: [...macroNames.names] }), setState: (s) => (macroNames.names = s?.names ? [...s.names] : ['Macro 1', 'Macro 2']) });
  return { params, mod, macroNames, getState: () => hub.get(), setState: (s) => hub.set(s) };
}

/** a patch with routes, a route-depth route and trigger routes */
function dress(e) {
  e.params.set('band2.gain', -6.5);
  e.params.set('band7.res', 0.81);
  e.params.set('fbAllOn', 1);
  e.params.set('lfo1.on', 1);
  e.params.set('lfo1.rate', 3.3);
  e.params.set('lfo2.on', 1);
  e.params.set('cmod1.on', 1);
  e.params.set('macro1.value', 0.7);
  const r0 = e.mod.addRoute('lfo1', 'band3.res', 0.4);
  e.mod.addRoute('macro1', r0.depthParam, 0.8);
  e.mod.addRoute('cmod1', 'lfo2.shape', -0.3);
  e.mod.addTriggerRoute('cmod1.step', 'lfo1.reset');
  e.mod.addTriggerRoute('lfo2.cycle', 'cmod2.reset');
  e.macroNames.names = ['Sweep', 'Grit'];
}

const warnSpy = () => {
  const orig = console.warn;
  const calls = [];
  console.warn = (...a) => calls.push(a);
  return { calls, restore: () => (console.warn = orig) };
};

/* ---------- 1. snapshot round trip through the engine plumbing and the file format ---------- */
{
  const a = makeEngine();
  dress(a);
  const snap = a.getState();
  const text = J(snap);
  const b = makeEngine();
  b.setState(JSON.parse(text));
  const direct = J(b.getState()) === text;

  const file = IO.serializePresets([{ name: 'Round trip', category: 'Test', created: 1, snapshot: snap }]);
  const parsed = IO.parsePresetFile(file, 'x.json');
  const c = makeEngine();
  c.setState(parsed.presets[0].snapshot);
  const viaFile = J(c.getState()) === text && parsed.warnings.length === 0 && parsed.presets[0].name === 'Round trip' && parsed.presets[0].category === 'Test';
  check(
    '1 snapshot round trip (routes, trigger routes, module state)',
    direct && viaFile && snap.routes.length === 3 && snap.triggers.length === 2 && c.macroNames.names[0] === 'Sweep',
    `${snap.routes.length} routes, ${snap.triggers.length} trigger routes; direct ${direct}, via file ${viaFile}`,
  );
}

/* ---------- 2. v1 migration ---------- */
{
  const v1 = { 'band0.gain': -6, mix: 0.5, fbAllOn: 1, resOffset: 0.25, bogusParam: 3 };
  const parsed = IO.parsePresetFile(J(v1), 'old_patch.json');
  const p = parsed.presets[0];
  const e = makeEngine();
  e.setState(p.snapshot);
  const st = e.getState();
  const direct = makeEngine();
  direct.setState(v1); // the engine accepts v1 itself too
  const ok =
    p.name === 'old patch' &&
    st.params['band0.gain'] === -6 &&
    st.params.mix === 0.5 &&
    st.params.fbAllOn === 1 &&
    st.params['band1.res'] === Math.fround(e.params.spec('band1.res').def) &&
    st.routes.length === 0 &&
    parsed.warnings.some((w) => /1 unknown parameter/.test(w)) &&
    J(direct.getState().params) === J(st.params);
  check('2 v1 migration (flat param map)', ok, `name "${p.name}", warnings: ${parsed.warnings.join('; ')}`);
}

/* ---------- 3. import validation: broken input never throws, only reports ---------- */
{
  const store = new ST.PresetStore(ST.memoryBackend(), INIT_ONLY);
  const bad = ['{not json', '', '   ', 'null', '42', '"text"', '[]', '[1, null, "x"]', '{}', J({ format: 'da-resonator-presets', presets: 'nope' }), J({ format: 'da-resonator-presets', presets: [{ name: 'x', snapshot: 7 }] })];
  const outcomes = [];
  for (const t of bad) outcomes.push(await store.importText(t, 'bad.json'));
  const nonText = await store.importText(undefined);
  const allRefused = [...outcomes, nonText].every((o) => o.error && o.added.length === 0) && store.userPresets().length === 0;
  check('3 broken files refused with a message', allRefused, outcomes.map((o) => o.error).slice(0, 4).join(' | '));

  // unknown params, out-of-range and wrong-typed values
  const s1 = IO.newReport();
  const snap = IO.sanitizeSnapshot({ format: 'da-resonator', version: 2, params: { 'band0.gain': 999, 'lfo1.shape': 2.6, fbAllOn: 0.7, mix: '0.5', 'zzz.foo': 1, 'lfo9.rate': 2 } }, s1);
  const e = makeEngine();
  const shape = e.params.spec('lfo1.shape');
  const okParams =
    snap.params['band0.gain'] === 12 &&
    snap.params['lfo1.shape'] === Math.min(shape.max, 3) &&
    snap.params.fbAllOn === 1 &&
    snap.params.mix === e.params.spec('mix').def &&
    s1.unknownParams.length === 2 &&
    s1.invalidParams.length === 1 &&
    s1.clamped === 3;
  check('4 unknown params ignored, values clamped', okParams, `unknown ${s1.unknownParams.join(',')}, invalid ${s1.invalidParams.join(',')}, clamped ${s1.clamped}`);

  // looping / unknown / malformed routes are dropped; duplicate slots move and keep their depth
  const s2 = IO.newReport();
  const routed = IO.sanitizeSnapshot(
    {
      format: 'da-resonator',
      version: 2,
      params: { 'route5.depth': 0.25 },
      routes: [
        { slot: 0, source: 'lfo1', target: 'lfo2.rate' },
        { slot: 1, source: 'lfo2', target: 'lfo1.rate' }, // loop
        { slot: 2, source: 'lfo9', target: 'band0.res' }, // unknown source
        { slot: 3, source: 'lfo1', target: 'nope.param' }, // unknown target
        { slot: 4, source: 'lfo1', target: 'lfo1.rate' }, // self
        { source: 42, target: 'band0.res' }, // malformed
        { slot: 5, source: 'macro1', target: 'band1.res' },
        { slot: 5, source: 'macro2', target: 'band2.res' }, // duplicate slot
        null,
      ],
      triggers: [
        { source: 'lfo1.cycle', target: 'cmod1.reset' },
        { source: 'cmod1.step', target: 'lfo1.reset' }, // loop
        { source: 'lfo2.cycle', target: 'lfo2.reset' }, // own reset
        { source: 'nope', target: 'lfo1.reset' },
      ],
      modules: { macros: { names: ['A'] } },
    },
    s2,
  );
  const moved = routed.routes.find((r) => r.source === 'macro2');
  const okRoutes =
    routed.routes.length === 3 &&
    routed.triggers.length === 1 &&
    moved && moved.slot !== 5 && routed.params[`route${moved.slot}.depth`] === 0.25 &&
    s2.droppedRoutes.length === 9;
  // the cleaned snapshot loads without the engine dropping anything else
  const spy = warnSpy();
  const e2 = makeEngine();
  e2.setState(routed);
  spy.restore();
  const loads = spy.calls.length === 0 && e2.mod.routes().length === 3 && e2.mod.triggerRoutes().length === 1;
  check('5 looping / unknown / malformed routes dropped', okRoutes && loads, `kept ${routed.routes.length}+${routed.triggers.length}, dropped ${s2.droppedRoutes.length}: ${s2.droppedRoutes.join(', ')}`);

  // a file mixing good and bad entries imports the good ones and says what it skipped
  const good = { name: 'Good one', category: 'Pads', snapshot: makeEngine().getState() };
  const mixed = await store.importText(J({ format: 'da-resonator-presets', version: 1, presets: [good, 'garbage', { name: 'loop', snapshot: { params: {}, routes: [{ slot: 0, source: 'lfo1', target: 'lfo1.rate' }] } }] }), 'mix.json');
  check(
    '6 mixed file: good entries in, bad ones reported',
    !mixed.error && mixed.added.length === 2 && mixed.warnings.some((w) => /1 entry skipped/.test(w)) && mixed.warnings.some((w) => /1 route dropped/.test(w)),
    `added ${mixed.added.map((p) => `${p.category}/${p.name}`).join(', ')}; ${mixed.warnings.join('; ')}`,
  );
}

/* ---------- 4. store with the memory backend ---------- */
{
  const backend = ST.memoryBackend();
  const store = new ST.PresetStore(backend, INIT_ONLY);
  await store.ready;
  const snap = makeEngine().getState();
  const p1 = await store.add('Pad', 'Pads', snap);
  const p2 = await store.add('pad', 'Pads', snap);
  const p3 = await store.add('Pad', 'Drones', snap);
  const order = store.list().map((p) => `${p.factory ? 'F' : 'U'}:${p.category}/${p.name}`);
  const okAdd = p2.name === 'pad 2' && p3.name === 'Pad' && order.join(',') === 'F:Basic/Init,U:Drones/Pad,U:Pads/Pad,U:Pads/pad 2';

  const r = await store.rename(p1.id, '  Bright\u0007 lead  ', 'Leads');
  const e = makeEngine();
  e.params.set('mix', 0.25);
  const ow = await store.overwrite(p1.id, e.getState());
  let factoryRefused = false;
  try {
    await store.overwrite('factory:init', snap);
  } catch {
    factoryRefused = true;
  }
  await store.remove(p3.id);
  const okEdit = r.name === 'Bright lead' && r.category === 'Leads' && ow.snapshot.params.mix === 0.25 && ow.name === 'Bright lead' && factoryRefused && !store.get(p3.id);

  // persisted: a new store over the same backend sees the same presets
  const again = new ST.PresetStore(backend, INIT_ONLY);
  await again.ready;
  const okPersist = J(again.userPresets().map((p) => [p.id, p.name, p.category, p.snapshot.params.mix])) === J(store.userPresets().map((p) => [p.id, p.name, p.category, p.snapshot.params.mix]));

  // export all → import into an empty store
  const other = new ST.PresetStore(ST.memoryBackend(), INIT_ONLY);
  const imp = await other.importText(store.exportText(), 'all.json');
  const okExport = !imp.error && J(other.userPresets().map((p) => [p.name, p.category, p.snapshot])) === J(store.userPresets().map((p) => [p.name, p.category, p.snapshot]));
  check('7 store: add / unique names / order / rename / overwrite / delete', okAdd && okEdit, order.join(', '));
  check('8 store: persistence and export-all → import', okPersist && okExport, `${store.userPresets().length} presets survive a reload and an export/import`);
}

/* ---------- 5. storage fallbacks ---------- */
{
  // a backend whose writes fail (quota, revoked permission) is replaced by memory and nothing is lost
  const failing = { kind: 'localstorage', loadAll: async () => [], put: async () => { throw new Error('quota'); }, remove: async () => { throw new Error('quota'); } };
  const spy = warnSpy();
  const s1 = new ST.PresetStore(failing, INIT_ONLY);
  const a = await s1.add('Kept', 'User', makeEngine().getState());
  const b = await s1.add('Also kept', 'User', makeEngine().getState());
  spy.restore();
  const okWrite = s1.storage === 'memory' && !!s1.get(a.id) && !!s1.get(b.id);

  // opening fails (IndexedDB blocked in a sandbox): falls back, still usable
  const spy2 = warnSpy();
  const s2 = new ST.PresetStore(Promise.reject(new Error('SecurityError')), INIT_ONLY);
  await s2.ready;
  const c = await s2.add('Works', 'User', makeEngine().getState());
  spy2.restore();
  const okOpen = !s2.persistent && !!s2.get(c.id);

  // localStorage backend: works with a real-ish Storage, refuses a throwing one
  const mem = new Map();
  const fakeLs = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const ls = ST.localStorageBackend('t.presets', fakeLs);
  const s3 = new ST.PresetStore(ls, INIT_ONLY);
  await s3.add('In LS', 'User', makeEngine().getState());
  const s3b = new ST.PresetStore(ST.localStorageBackend('t.presets', fakeLs), INIT_ONLY);
  await s3b.ready;
  let refused = false;
  try {
    ST.localStorageBackend('t', { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} });
  } catch {
    refused = true;
  }
  // in Node there is neither IndexedDB nor localStorage: the best backend is memory
  const spy3 = { info: console.info };
  console.info = () => {};
  const best = await ST.openBestBackend();
  console.info = spy3.info;

  // damaged records in storage are skipped
  const valid = { id: 'u_ok', name: 'Fine', category: 'User', created: 5, snapshot: makeEngine().getState() };
  const damaged = [null, { id: 'x' }, { id: 'y', snapshot: 5 }, 'str', valid];
  const s4 = new ST.PresetStore({ kind: 'indexeddb', loadAll: async () => damaged, put: async () => {}, remove: async () => {} }, INIT_ONLY);
  await s4.ready;
  check(
    '9 storage fallbacks (write fails, open fails, localStorage, damaged records)',
    okWrite && okOpen && s3b.userPresets().length === 1 && s3b.storage === 'localstorage' && refused && best.kind === 'memory' && s4.userPresets().length === 1,
    `after write failure: ${s1.storage}; blocked open: ${s2.storage}; LS reload: ${s3b.userPresets().length}; best in node: ${best.kind}; damaged kept: ${s4.userPresets().length}/5`,
  );
}

/* ---------- 6. session: dirty tracking, save / load, A/B, stepping ---------- */
{
  const e = makeEngine();
  const store = new ST.PresetStore(ST.memoryBackend(), INIT_ONLY);
  await store.ready;
  const s = new SE.PresetSession(e, store);
  let events = 0;
  s.onChange(() => events++);
  await tick();
  const startClean = !s.dirty && s.name === 'Init';

  e.params.set('band0.gain', -3);
  await micro();
  const dirtied = s.dirty;
  e.params.set('band0.gain', 0);
  await micro();
  const backClean = !s.dirty;
  e.mod.addRoute('lfo1', 'band4.res', 0.3);
  await micro();
  const routeDirty = s.dirty;

  // save as, change, load back
  dress(e);
  const saved = await s.saveAs('My patch', 'Tests');
  const savedState = J(e.getState());
  const afterSave = !s.dirty && s.canSave && s.presetId === saved.id;
  e.params.set('mix', 0.1);
  e.mod.removeRoute(e.mod.routes()[0].slot);
  e.mod.removeTriggerRoute('cmod1.step', 'lfo1.reset');
  e.macroNames.names = ['changed'];
  await micro();
  const changedDirty = s.dirty;
  s.load(store.get(saved.id));
  await micro();
  const loadedBack = J(e.getState()) === savedState && !s.dirty;
  check('10 dirty tracking (params, routes) and save → change → load back', startClean && dirtied && backClean && routeDirty && afterSave && changedDirty && loadedBack, `events ${events}, restored ${loadedBack}`);

  // save overwrites; factory presets can't be overwritten
  e.params.set('band9.gain', -20);
  await micro();
  await s.save();
  const overwritten = store.get(saved.id).snapshot.params['band9.gain'] === -20 && !s.dirty;
  s.load(store.get('factory:init'));
  const factoryNoSave = !s.canSave && (await s.save()) === null;

  // A/B: B starts as a copy, holds its own edits, copy moves the live sound across
  s.load(store.get(saved.id));
  const aState = J(e.getState());
  s.switchAb('B');
  const bStartsAsCopy = s.ab === 'B' && J(e.getState()) === aState && s.abInUse;
  e.params.set('band1.gain', -9);
  await micro();
  const bState = J(e.getState());
  s.switchAb('A');
  const backToA = J(e.getState()) === aState && !s.dirty;
  s.switchAb(); // toggle → B
  const backToB = s.ab === 'B' && J(e.getState()) === bState && s.dirty;
  s.load(store.get('factory:init')); // loading in B leaves A alone
  s.switchAb('A');
  const aUntouched = J(e.getState()) === aState && s.name === 'My patch';
  s.switchAb('B');
  const bIsInit = s.name === 'Init';
  const initState = J(e.getState());
  s.copyAb(); // B (Init) → A
  s.switchAb('A');
  const copied = s.name === 'Init' && J(e.getState()) === initState && e.params.get('band1.gain') === 0;
  check('11 A/B compare (switch, own edits, load per slot, copy)', overwritten && factoryNoSave && bStartsAsCopy && backToA && backToB && aUntouched && bIsInit && copied, `A ${backToA}, B ${backToB}, A untouched by B load ${aUntouched}, copy ${copied}`);

  // stepping wraps through factory + user presets; rename / delete follow the session
  const second = await store.add('Zeta', 'Tests', e.getState());
  s.load(store.get('factory:init'));
  const n1 = s.step(1).name;
  const n2 = s.step(1).name;
  const n3 = s.step(1).name;
  const p0 = s.step(-1).name;
  await store.rename(second.id, 'Omega');
  s.load(store.get(second.id));
  await store.rename(second.id, 'Omega 2');
  const renamed = s.name === 'Omega 2';
  await store.remove(second.id);
  const deleted = s.presetId === null && s.name === 'Omega 2' && s.dirty && !s.canSave;
  check('12 prev / next wrap, rename and delete follow the session', n1 === 'My patch' && n2 === 'Zeta' && n3 === 'Init' && p0 === 'Zeta' && renamed && deleted, `${['Init', n1, n2, n3].join(' → ')}, back: ${p0}`);

  // export of the live sound re-imports to the same state
  const ex = s.exportCurrent();
  const s2 = new ST.PresetStore(ST.memoryBackend(), INIT_ONLY);
  const imp = await s2.importText(ex.text, ex.fileName);
  const e2 = makeEngine();
  e2.setState(imp.added[0].snapshot);
  check('13 export current → import → same sound', /\.resonator\.json$/.test(ex.fileName) && imp.added[0].name === 'Omega 2' && J(e2.getState()) === J(e.getState()), ex.fileName);
  s.dispose();
}

console.table(results);
