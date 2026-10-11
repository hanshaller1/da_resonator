/**
 * Fixed table of modulation sources and trigger ports (see docs/plan-modulation-und-module.md, 4.1).
 * Indices are stable: the worklet writes source values into a Float32Array in this order.
 */
import { NUM_BANDS } from '../bands';
import { NUM_CMODS, NUM_EFS, NUM_LFOS, NUM_MACROS } from '../paramdefs/modules';

export type SourceClass = 'macro' | 'lfo' | 'cmod' | 'ef' | 'dyn';

export interface ModSourceSpec {
  index: number;
  /** 'macro1', 'lfo2', 'cmod1', 'ef3', 'dyn4' (dyn = gain reduction of band 4, 1-based) */
  id: string;
  label: string;
  short: string;
  cls: SourceClass;
  /**
   * node in the modulation graph. Sources whose value only depends on audio of the previous
   * block and on no modulatable settings of their own (band dynamics GR) use a node without inputs.
   */
  node: string;
  /** module whose params belong to this source ('dyn' for the GR sources) */
  module: string;
  /** bipolar sources swing -1..1, unipolar 0..1 (LFO / clock mod can switch, see their `uni` param) */
  bipolar: boolean;
}

export const SOURCES: ModSourceSpec[] = [];
function add(s: Omit<ModSourceSpec, 'index'>) {
  SOURCES.push({ ...s, index: SOURCES.length });
}
for (let n = 1; n <= NUM_MACROS; n++) add({ id: `macro${n}`, label: `Macro ${n}`, short: `M${n}`, cls: 'macro', node: `macro${n}`, module: `macro${n}`, bipolar: false });
for (let n = 1; n <= NUM_LFOS; n++) add({ id: `lfo${n}`, label: `LFO ${n}`, short: `LFO${n}`, cls: 'lfo', node: `lfo${n}`, module: `lfo${n}`, bipolar: true });
for (let n = 1; n <= NUM_CMODS; n++) add({ id: `cmod${n}`, label: `Clock Mod ${n}`, short: `CM${n}`, cls: 'cmod', node: `cmod${n}`, module: `cmod${n}`, bipolar: false });
for (let n = 1; n <= NUM_EFS; n++) add({ id: `ef${n}`, label: `Env Follower ${n}`, short: `EF${n}`, cls: 'ef', node: `ef${n}`, module: `ef${n}`, bipolar: false });
for (let b = 1; b <= NUM_BANDS; b++) add({ id: `dyn${b}`, label: `Band ${b} Gain Reduction`, short: `GR${b}`, cls: 'dyn', node: `dynGR${b}`, module: 'dyn', bipolar: false });

export const NUM_SOURCES = SOURCES.length;
export const SOURCE_BY_ID: Record<string, ModSourceSpec> = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
export const SRC_MACRO0 = SOURCE_BY_ID.macro1.index;
export const SRC_LFO0 = SOURCE_BY_ID.lfo1.index;
export const SRC_CMOD0 = SOURCE_BY_ID.cmod1.index;
export const SRC_EF0 = SOURCE_BY_ID.ef1.index;
export const SRC_DYN0 = SOURCE_BY_ID.dyn1.index;

/* ---------- trigger ports ---------- */

export interface TriggerPortSpec {
  index: number;
  id: string;
  label: string;
  /** module (graph node) the port belongs to */
  node: string;
}

/** trigger outputs: events a module emits */
export const TRIGGER_OUTS: TriggerPortSpec[] = [];
/** trigger inputs: events a module reacts to */
export const TRIGGER_INS: TriggerPortSpec[] = [];
function out(id: string, label: string, node: string) {
  TRIGGER_OUTS.push({ index: TRIGGER_OUTS.length, id, label, node });
}
function inp(id: string, label: string, node: string) {
  TRIGGER_INS.push({ index: TRIGGER_INS.length, id, label, node });
}
out('clock.beat', 'Clock Beat', 'clock');
for (let n = 1; n <= NUM_LFOS; n++) out(`lfo${n}.cycle`, `LFO ${n} Cycle`, `lfo${n}`);
for (let n = 1; n <= NUM_CMODS; n++) out(`cmod${n}.step`, `Clock Mod ${n} Step`, `cmod${n}`);
for (let n = 1; n <= NUM_EFS; n++) out(`ef${n}.gate`, `Env Follower ${n} Gate`, `ef${n}`);
for (let n = 1; n <= NUM_LFOS; n++) inp(`lfo${n}.reset`, `LFO ${n} Reset`, `lfo${n}`);
for (let n = 1; n <= NUM_CMODS; n++) inp(`cmod${n}.reset`, `Clock Mod ${n} Reset`, `cmod${n}`);

export const NUM_TRIGGER_OUTS = TRIGGER_OUTS.length;
export const NUM_TRIGGER_INS = TRIGGER_INS.length;
export const TRIGGER_OUT_BY_ID: Record<string, TriggerPortSpec> = Object.fromEntries(TRIGGER_OUTS.map((t) => [t.id, t]));
export const TRIGGER_IN_BY_ID: Record<string, TriggerPortSpec> = Object.fromEntries(TRIGGER_INS.map((t) => [t.id, t]));
export const MAX_TRIGGER_ROUTES = 16;
