/**
 * Dev preview: mounts the UI on the mock engine.
 * Query flags: ?run=1 auto-starts + plays; ?demo=1 sets a characterful patch;
 * ?theme=light|dark pins the theme.
 */
import { mountApp } from './app';
import { createMockEngine } from './mockEngine';

const q = new URLSearchParams(location.search);
const theme = q.get('theme');
if (theme === 'light' || theme === 'dark') {
  try {
    localStorage.setItem('resonator.theme', theme);
  } catch {
    /* ignore */
  }
}

const engine = createMockEngine({ demoModulation: q.get('mod') !== '0' });

if (q.get('demo') === '1') {
  const gains = [-6, 2, 4, -3, 0, 6, -12, 3, -2, -60];
  const res = [0.2, 0.45, 0.7, 0.35, 0.55, 0.85, 0.3, 0.6, 0.4, 0.25];
  const fb = [0, 0, 0.15, 0, 0, 0.92, 0, 0.3, 0, 0];
  gains.forEach((g, i) => engine.params.set(`band${i}.gain`, g));
  res.forEach((r, i) => engine.params.set(`band${i}.res`, r));
  fb.forEach((f, i) => engine.params.set(`band${i}.fb`, f));
  engine.params.set('inputGain', 6);
  engine.params.set('resOffset', 0.15);
  engine.params.set('fbAllTone', 4200);
  engine.params.set('mix', 0.85);
  engine.params.set('spread', 0.4);
}

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
mountApp(root, engine);

if (q.get('run') === '1') {
  void engine.start().then(() => engine.setPlaying(true));
}

(window as unknown as { __engine: typeof engine }).__engine = engine;
