// Runs every offline test script (scripts/*test*.mjs) and prints one summary line per script.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => /^(dsp-test|mod-test|test-.+)\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const pass = (out.match(/'PASS'/g) ?? []).length;
  const fail = (out.match(/'FAIL'/g) ?? []).length;
  const ok = r.status === 0 && fail === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(24)} ${pass} passed${fail ? `, ${fail} failed` : ''}`);
  if (!ok) console.log(out.split('\n').filter((l) => l.includes('FAIL') || /Error/.test(l)).slice(0, 8).join('\n'));
}
process.exitCode = failed ? 1 : 0;
