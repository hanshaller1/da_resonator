/**
 * Building blocks for parameter definitions. Every module (resonator, filters, LFOs …)
 * owns one file in this folder that returns its `ParamDef`s; `../params.ts` assembles
 * them in a fixed order so every parameter gets a stable index (fixed slots, no runtime
 * registration). Keep these files free of DOM / Web Audio references: the AudioWorklet
 * imports them too.
 */

export type ParamCurve = 'lin' | 'exp' | 'fader' | 'toggle' | 'discrete';
export type ParamUnit = '' | 'dB' | 'Hz' | '%' | 'ms' | 'BPM' | ':1' | 'oct' | 'dB/oct';

/**
 * Which kind of module a parameter belongs to. The modulation rules
 * (shared/mod/rules.ts) decide per class which sources may modulate it.
 */
export type ModClass = 'resonator' | 'dyn' | 'filter' | 'lfo' | 'cmod' | 'ef' | 'macro' | 'route' | 'clock' | 'scan';

export interface ParamDef {
  /** full id, `module.key` (resonator globals and band params keep their historic ids) */
  id: string;
  label: string;
  short: string;
  min: number;
  max: number;
  def: number;
  unit: ParamUnit;
  curve: ParamCurve;
  /** false = never modulated (toggles, macros) */
  modulatable: boolean;
  /** labels for curve 'discrete' (value = option index, min 0, max options.length - 1) */
  options?: readonly string[];
}

export function cont(
  id: string,
  label: string,
  short: string,
  min: number,
  max: number,
  def: number,
  unit: ParamUnit = '',
  curve: 'lin' | 'exp' | 'fader' = 'lin',
): ParamDef {
  return { id, label, short, min, max, def, unit, curve, modulatable: true };
}

export function toggle(id: string, label: string, short: string, def = 0): ParamDef {
  return { id, label, short, min: 0, max: 1, def, unit: '', curve: 'toggle', modulatable: false };
}

export function discrete(id: string, label: string, short: string, options: readonly string[], def = 0): ParamDef {
  return { id, label, short, min: 0, max: options.length - 1, def, unit: '', curve: 'discrete', modulatable: true, options };
}

export function intRange(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(String(i));
  return out;
}

/* ---------- tempo divisions (shared by LFO sync and clock mod) ---------- */

export const DIVISIONS = [
  { label: '1/64', beats: 1 / 16 },
  { label: '1/32T', beats: 1 / 12 },
  { label: '1/32', beats: 1 / 8 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/16', beats: 1 / 4 },
  { label: '1/16D', beats: 3 / 8 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/8', beats: 1 / 2 },
  { label: '1/8D', beats: 3 / 4 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/4', beats: 1 },
  { label: '1/4D', beats: 3 / 2 },
  { label: '1/2', beats: 2 },
  { label: '1 Bar', beats: 4 },
  { label: '2 Bars', beats: 8 },
  { label: '4 Bars', beats: 16 },
  { label: '8 Bars', beats: 32 },
] as const;
export const DIVISION_LABELS = DIVISIONS.map((d) => d.label);
/** index of 1/4 in DIVISIONS */
export const DIV_QUARTER = 10;
