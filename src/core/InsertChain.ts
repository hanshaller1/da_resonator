/**
 * A slot in the signal path where processing modules can be inserted later
 * (pre/post filters, dynamic EQ, saturation …) without touching the engine.
 * Modules are plain AudioNodes (or anything exposing input/output nodes).
 */
export interface InsertModule {
  readonly id: string;
  readonly input: AudioNode;
  readonly output: AudioNode;
  dispose?(): void;
}

export class InsertChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private modules: InsertModule[] = [];

  constructor(ctx: BaseAudioContext) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.rewire();
  }

  add(m: InsertModule, index = this.modules.length): void {
    this.modules.splice(index, 0, m);
    this.rewire();
  }
  remove(id: string): void {
    const m = this.modules.find((x) => x.id === id);
    if (!m) return;
    this.modules = this.modules.filter((x) => x !== m);
    m.output.disconnect();
    m.dispose?.();
    this.rewire();
  }
  list(): readonly InsertModule[] {
    return this.modules;
  }

  private rewire(): void {
    this.input.disconnect();
    for (const m of this.modules) m.output.disconnect();
    let prev: AudioNode = this.input;
    for (const m of this.modules) {
      prev.connect(m.input);
      prev = m.output;
    }
    prev.connect(this.output);
  }
}
