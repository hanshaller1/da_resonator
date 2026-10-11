import { AudioEngine } from './core/AudioEngine';
import { mountApp } from './ui/app';

const engine = new AudioEngine();
mountApp(document.getElementById('app')!, engine);

// handy for debugging / future scripting from the console
(window as unknown as { resonator: AudioEngine }).resonator = engine;
