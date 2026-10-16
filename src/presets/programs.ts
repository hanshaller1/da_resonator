/**
 * Program numbers for MIDI Program Change (docs/midi-2026-10-16.md, point 7A): the factory presets
 * in their order, then the user presets in the order they were saved. Program Change n (0–127)
 * loads entry n; the preset list shows n + 1, the way most devices count programs.
 */
import type { Preset } from './io';

export const MAX_PROGRAMS = 128;

export function programList(store: { readonly factory: readonly Preset[]; userPresets(): Preset[] }): Preset[] {
  const user = store.userPresets().sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...store.factory, ...user].slice(0, MAX_PROGRAMS);
}

/** preset id → shown program number (1–128); presets past 128 have none */
export function programNumbers(store: { readonly factory: readonly Preset[]; userPresets(): Preset[] }): Map<string, number> {
  return new Map(programList(store).map((p, i) => [p.id, i + 1]));
}
