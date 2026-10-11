// Shared helpers for the offline test scripts: bundle TS with esbuild, load the worklet in a vm.
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FS = 48000;
export const BLOCK = 128;

/** bundle a TS module and return its exports (shared code only: no DOM) */
export function importTs(rel) {
  const code = buildSync({ entryPoints: [path.join(root, rel)], bundle: true, write: false, format: 'cjs', platform: 'neutral', target: 'es2020' }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const workletCode = () =>
  buildSync({ entryPoints: [path.join(root, 'src/dsp/resonator.worklet.ts')], bundle: true, write: false, format: 'iife', platform: 'neutral', target: 'es2020' }).outputFiles[0].text;

let cached = null;
/** fresh processor instance; proc.port.sent collects posted messages */
export function loadProcessor() {
  cached ??= workletCode();
  const registry = {};
  const ctx = { sampleRate: FS, currentTime: 0, console, registerProcessor: (name, cls) => (registry[name] = cls) };
  vm.createContext(ctx);
  vm.runInContext(`class AudioWorkletProcessor { constructor() { const sent = []; this.port = { sent, onmessage: null, postMessage(m) { sent.push(m); } }; } }`, ctx);
  vm.runInContext(
    `(function (Math, Number, Float32Array, Float64Array, Uint8Array, Object, Array, Map, Set, Error) {\n${cached}\n})(Math, Number, Float32Array, Float64Array, Uint8Array, Object, Array, Map, Set, Error);`,
    ctx,
  );
  const names = Object.keys(registry);
  return new registry[names[0]]({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
}

/** run `blocks` blocks; input(n) -> sample (mono, both channels) or 0 */
export function run(proc, blocks, input = () => 0, onBlock) {
  const L = new Float32Array(blocks * BLOCK), R = new Float32Array(blocks * BLOCK);
  const iL = new Float32Array(BLOCK), iR = new Float32Array(BLOCK);
  const oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
  for (let k = 0; k < blocks; k++) {
    for (let s = 0; s < BLOCK; s++) iL[s] = iR[s] = input(k * BLOCK + s);
    proc.process([[iL, iR]], [[oL, oR]]);
    L.set(oL, k * BLOCK);
    R.set(oR, k * BLOCK);
    onBlock?.(k);
  }
  return { L, R };
}

export const results = [];
export function check(name, ok, detail = '') {
  results.push({ test: name, result: ok ? 'PASS' : 'FAIL', detail });
  if (!ok) process.exitCode = 1;
}
