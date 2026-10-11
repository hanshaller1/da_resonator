import { build } from 'esbuild';

declare const process: { cwd(): string };
import type { Plugin } from 'vite';

/**
 * `import code from './x.worklet.ts?worklet'` -> the module bundled by esbuild
 * into one self-contained script string. At runtime it is loaded through a Blob URL,
 * which keeps the app a single portable file (no separate worklet asset).
 */
export function workletPlugin(): Plugin {
  const SUFFIX = '?worklet';
  return {
    name: 'inline-audio-worklet',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith(SUFFIX)) return null;
      const r = await this.resolve(id.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return r ? r.id + SUFFIX : null;
    },
    async load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const file = id.slice(0, -SUFFIX.length);
      const out = await build({
        entryPoints: [file],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'neutral',
        target: 'es2020',
        minify: true,
        metafile: true,
      });
      // metafile paths are relative to the cwd; relative watch files are mistaken for imports by the dev server
      for (const input of Object.keys(out.metafile!.inputs)) this.addWatchFile(process.cwd() + '/' + input);
      return `export default ${JSON.stringify(out.outputFiles[0].text)};`;
    },
  };
}
