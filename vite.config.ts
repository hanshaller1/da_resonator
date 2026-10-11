import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { workletPlugin } from './vite-plugin-worklet';

// `npm run build` -> regular multi-file build in dist/
// `npm run build:single` -> everything inlined into dist-single/index.html
export default defineConfig(({ mode }) => ({
  plugins: [workletPlugin(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
  },
}));
