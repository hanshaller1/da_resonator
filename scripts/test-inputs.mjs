// Offline tests for the audio input list (src/core/inputs.ts): Elektron names, label cleanup,
// hot-plug arrivals, the automatic choice and what is remembered.
// Run: node scripts/test-inputs.mjs
import { check, importTs, results } from './testkit.mjs';

const { InputDevices, isElektron, cleanLabel } = importTs('src/core/inputs.ts');

/* ---------- names ---------- */
for (const n of ['Elektron Digitakt', 'Digitakt II', 'Elektron Digitone (1935:000e)', 'Syntakt', 'Analog Rytm MKII', 'Analog Four MKII', 'Analog Heat +FX', 'Model:Cycles', 'Model:Samples', 'Analog Keys'])
  check(`Elektron: ${n}`, isElektron(n));
for (const n of ['MacBook Pro Microphone', 'Scarlett 2i2 USB', 'Analog input 1', 'Elektronika'])
  check(`not Elektron: ${n}`, !isElektron(n));
check('label: USB id removed', cleanLabel('Elektron Digitakt (1935:000c)') === 'Elektron Digitakt');
check('label: default alias removed', cleanLabel('Default - Scarlett 2i2 USB') === 'Scarlett 2i2 USB');
check('label: built-in kept', cleanLabel('MacBook Pro Microphone (Built-in)') === 'MacBook Pro Microphone (Built-in)');

/* ---------- a fake mediaDevices + storage ---------- */
function fakeMedia(devs, allowed = true) {
  const m = {
    devs,
    allowed,
    listeners: [],
    async enumerateDevices() {
      return m.devs.map((d) => (m.allowed ? { kind: 'audioinput', ...d } : { kind: 'audioinput', deviceId: '', label: '' }));
    },
    addEventListener(t, cb) {
      if (t === 'devicechange') m.listeners.push(cb);
    },
    fire() {
      m.listeners.forEach((f) => f());
    },
  };
  return m;
}
function memStorage(init = {}) {
  const d = { ...init };
  return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => (d[k] = v) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const BUILTIN = { deviceId: 'b', label: 'MacBook Pro Microphone (Built-in)' };
const DT = { deviceId: 'dt', label: 'Elektron Digitakt (1935:000c)' };
const SC = { deviceId: 'sc', label: 'Scarlett 2i2 USB' };

/* ---------- list, aliases, access ---------- */
{
  const m = fakeMedia([{ deviceId: 'default', label: 'Default - MacBook Pro Microphone (Built-in)' }, { deviceId: 'communications', label: 'Communications - X' }, BUILTIN, DT]);
  const inp = new InputDevices(m, memStorage(), async () => {});
  await inp.refresh();
  check('list: aliases dropped', inp.devices.map((d) => d.id).join() === 'b,dt', inp.devices.map((d) => d.id).join());
  check('list: names cleaned, Elektron flagged', inp.devices[1].label === 'Elektron Digitakt' && inp.devices[1].elektron && !inp.devices[0].elektron);
  check('list: allowed', inp.allowed);
  check('resolve: Chrome "default" id found by name', inp.resolve('default', 'MacBook Pro Microphone (Built-in)')?.id === 'b');
}
{
  const m = fakeMedia([BUILTIN, DT], false);
  const inp = new InputDevices(m, memStorage(), async () => {});
  await inp.refresh();
  check('no access: empty list, not allowed', inp.devices.length === 0 && !inp.allowed);
  let arrived = null;
  inp.onArrive((d) => (arrived = d));
  m.allowed = true;
  m.fire();
  await tick();
  await tick();
  check('access granted: names appear but nothing counts as plugged in', inp.devices.length === 2 && arrived === null);
}

/* ---------- hot-plug ---------- */
{
  const m = fakeMedia([BUILTIN]);
  const inp = new InputDevices(m, memStorage(), async () => {});
  await inp.refresh();
  const seen = [];
  inp.onArrive((d) => seen.push(d.map((x) => x.id).join()));
  m.devs = [BUILTIN, DT];
  m.fire();
  m.fire(); // a burst of devicechange events reports the arrival once
  await inp.refresh();
  check('plug: arrival reported once', seen.join('|') === 'dt', seen.join('|'));
  m.devs = [BUILTIN];
  m.fire();
  await inp.refresh();
  m.devs = [BUILTIN, DT];
  m.fire();
  await inp.refresh();
  check('replug: reported again', seen.join('|') === 'dt|dt', seen.join('|'));
}

/* ---------- automatic choice ---------- */
{
  const inp = new InputDevices(fakeMedia([BUILTIN, DT, SC]), memStorage(), async () => {});
  await inp.refresh();
  check('auto: Elektron first', inp.autoChoice() === 'dt');
  inp.setAutoElektron(false);
  check('auto off, nothing remembered: system default', inp.autoChoice() === '');
  inp.opened('sc', 'Scarlett 2i2 USB', 2);
  check('auto off: remembered device', inp.autoChoice() === 'sc');
}
{
  const inp = new InputDevices(fakeMedia([BUILTIN]), memStorage({ 'resonator.input': JSON.stringify({ deviceId: 'sc', label: 'Scarlett 2i2 USB', active: true }) }), async () => {});
  await inp.refresh();
  check('remembered device missing: null (wait for it, no other device)', inp.autoChoice() === null);
}
{
  const inp = new InputDevices(fakeMedia([BUILTIN, { deviceId: 'new-id', label: 'Scarlett 2i2 USB' }]), memStorage({ 'resonator.input': JSON.stringify({ deviceId: 'sc', label: 'Scarlett 2i2 USB', autoElektron: false }) }), async () => {});
  await inp.refresh();
  check('remembered device with a new id: found by name', inp.autoChoice() === 'new-id');
}

/* ---------- remembered between visits ---------- */
{
  const store = memStorage();
  const a = new InputDevices(fakeMedia([DT]), store, async () => {});
  a.setChannels('left');
  a.setAutoElektron(false);
  a.opened('dt', 'Elektron Digitakt', 2);
  const b = new InputDevices(fakeMedia([DT]), store, async () => {});
  check('stored: device, channels, AUTO, active', b.deviceId === 'dt' && b.label === 'Elektron Digitakt' && b.channels === 'left' && b.autoElektron === false && b.active);
  b.closed();
  const c = new InputDevices(fakeMedia([DT]), store, async () => {});
  check('stored: closed is not active, device kept', !c.active && c.deviceId === 'dt' && c.status === 'off');
  const bad = new InputDevices(fakeMedia([]), memStorage({ 'resonator.input': '{"channels":"surround","autoElektron":"yes"' }), async () => {});
  check('stored: broken entry gives defaults', bad.channels === 'stereo' && bad.autoElektron === true && !bad.active);
}
{
  const inp = new InputDevices(undefined, undefined, async () => {});
  await inp.refresh();
  check('no mediaDevices: not supported, empty', !inp.supported && inp.devices.length === 0);
}

console.table(results);
