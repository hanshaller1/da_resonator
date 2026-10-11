// Turns dist-single/index.html into a body-only page for hosts that supply their own <html>/<head> shell.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../dist-single/index.html', import.meta.url), 'utf8');
const title = src.match(/<title>.*?<\/title>/s)[0];
const styles = [...src.matchAll(/<style[^>]*>.*?<\/style>/gs)].map((m) => m[0]).join('\n');
const scripts = [...src.matchAll(/<script[^>]*>.*?<\/script>/gs)].map((m) => m[0]).join('\n');
const out = `${title}\n${styles}\n<div id="app"></div>\n${scripts}\n`;
const target = process.argv[2] ?? new URL('../dist-single/artifact.html', import.meta.url);
writeFileSync(target, out);
console.log('wrote', String(target), out.length, 'bytes');
