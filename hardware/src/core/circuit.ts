// 门级仿真核心：Nand 与 DFF 是唯一原语，所有芯片由 TS 组合构成，
// 编译成扁平门网表后求值。求值双后端：拓扑序解释执行 + JIT 编译函数。
//
// 位序约定：Bus[i] 是第 i 位（LSB 在前）。

export type Wire = number;
export type Bus = Wire[];

export interface NandGate { a: Wire; b: Wire; out: Wire }
export interface DffGate { d: Wire; q: Wire }

/**
 * 电路构建器。调用顺序即门发射顺序（通常已依赖有序），
 * compile() 里用 Kahn 拓扑排序兜底并做连通性校验。
 */
export class Circuit {
  readonly name: string;
  readonly gates: NandGate[] = [];
  readonly dffs: DffGate[] = [];
  readonly inputs = new Map<string, Bus>();
  readonly outputs = new Map<string, Bus>();
  private count = 0;
  /** 已分配线数 */
  get wireCount(): number { return this.count; }
  /** 恒 0 线：无驱动，求值时保持 0 */
  readonly zero: Wire;

  constructor(name: string) {
    this.name = name;
    this.zero = this.fresh();
  }

  fresh(): Wire { return this.count++; }

  inBus(name: string, width = 1): Bus {
    if (this.inputs.has(name)) throw new Error(`${this.name}: 输入引脚重复 ${name}`);
    const bus: Bus = [];
    for (let i = 0; i < width; i++) bus.push(this.fresh());
    this.inputs.set(name, bus);
    return bus;
  }

  bind(name: string, bus: Bus): void {
    if (this.outputs.has(name)) throw new Error(`${this.name}: 输出引脚重复 ${name}`);
    this.outputs.set(name, [...bus]);
  }

  nand(a: Wire, b: Wire): Wire {
    const out = this.fresh();
    this.gates.push({ a, b, out });
    return out;
  }

  /** 把已有 wire 绑定为 DFF 输出 q（时钟沿采样 d）。用于寄存器反馈结构。 */
  dffInto(q: Wire, d: Wire): void {
    this.dffs.push({ d, q });
  }

  dff(d: Wire): Wire {
    const q = this.fresh();
    this.dffInto(q, d);
    return q;
  }

  const1(): Wire { return this.nand(this.zero, this.zero); }
}

export interface Compiled {
  name: string;
  nWires: number;
  inputs: Map<string, Bus>;
  outputs: Map<string, Bus>;
  /** 拓扑序扁平化后的 NAND 网表 */
  gA: Int32Array;
  gB: Int32Array;
  gOut: Int32Array;
  dffD: Int32Array;
  dffQ: Int32Array;
  jitFn: ((w: Uint8Array) => void) | null;
}

function makeJit(gA: Int32Array, gB: Int32Array, gOut: Int32Array): ((w: Uint8Array) => void) | null {
  if (gA.length === 0) return () => {};
  const parts = new Array<string>(gA.length);
  for (let i = 0; i < gA.length; i++) {
    parts[i] = `w[${gOut[i]}]=(~(w[${gA[i]}]&w[${gB[i]}]))&1;`;
  }
  try {
    return new Function('w', parts.join('')) as (w: Uint8Array) => void;
  } catch {
    return null;
  }
}

export function compile(c: Circuit): Compiled {
  const n = c.wireCount;
  const writer = new Int32Array(n).fill(-1); // wire -> 写它的门下标；-1 = 输入/DFF 输出/恒 0/未驱动

  c.gates.forEach((g, i) => {
    if (writer[g.out] !== -1) throw new Error(`${c.name}: 线 ${g.out} 被多重驱动`);
    writer[g.out] = i;
  });

  const inputWires = new Set<number>();
  for (const bus of c.inputs.values()) for (const w of bus) inputWires.add(w);
  const dffQs = new Set<number>();
  for (const d of c.dffs) {
    if (writer[d.q] !== -1) throw new Error(`${c.name}: DFF 输出线 ${d.q} 被门驱动`);
    dffQs.add(d.q);
  }

  const driven = (w: Wire): boolean =>
    writer[w] !== -1 || inputWires.has(w) || dffQs.has(w) || w === c.zero;

  for (const g of c.gates) {
    if (!driven(g.a) || !driven(g.b)) throw new Error(`${c.name}: 门输入线未驱动 (${g.a},${g.b})`);
  }
  for (const d of c.dffs) {
    if (!driven(d.d)) throw new Error(`${c.name}: DFF 输入线未驱动 ${d.d}`);
  }
  for (const bus of c.outputs.values()) {
    for (const w of bus) {
      if (!driven(w)) throw new Error(`${c.name}: 输出引脚线未驱动 ${w}`);
    }
  }

  // Kahn 拓扑排序：门到门经共享线连边；输入/DFF 输出/恒 0 线视为源。
  const consumers: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(c.gates.length);
  c.gates.forEach((g, i) => {
    for (const w of [g.a, g.b]) {
      const wr = writer[w];
      if (wr >= 0) { consumers[w].push(i); indeg[i]++; } // consumers 以“被消费的线号”为键
    }
  });
  const queue: number[] = [];
  for (let i = 0; i < indeg.length; i++) if (indeg[i] === 0) queue.push(i);
  const order: number[] = [];
  while (queue.length > 0) {
    const g = queue.pop()!;
    order.push(g);
    for (const t of consumers[c.gates[g].out]) {
      if (--indeg[t] === 0) queue.push(t);
    }
  }
  if (order.length !== c.gates.length) {
    throw new Error(`${c.name}: 组合逻辑存在环`);
  }

  const ng = order.length;
  const gA = new Int32Array(ng);
  const gB = new Int32Array(ng);
  const gOut = new Int32Array(ng);
  for (let i = 0; i < ng; i++) {
    const g = c.gates[order[i]];
    gA[i] = g.a; gB[i] = g.b; gOut[i] = g.out;
  }
  const dffD = new Int32Array(c.dffs.length);
  const dffQ = new Int32Array(c.dffs.length);
  c.dffs.forEach((d, i) => { dffD[i] = d.d; dffQ[i] = d.q; });

  return {
    name: c.name,
    nWires: n,
    inputs: c.inputs,
    outputs: c.outputs,
    gA, gB, gOut, dffD, dffQ,
    jitFn: makeJit(gA, gB, gOut),
  };
}

/**
 * 已编译芯片实例。时钟模型（与 docs/GOLDEN.md 一致）：
 *  - setInput 后 eval()：组合逻辑在线网当前状态下稳定（对应 tock）。
 *  - tick()：所有 DFF 同时锁存各自求值后的输入（对应 tick）。
 *  - step() = eval() + tick()，一个完整时钟周期。
 */
export class Chip {
  readonly comp: Compiled;
  readonly w: Uint8Array;
  private latchBuf: Uint8Array;
  useJit = true;
  evalCount = 0;

  constructor(comp: Compiled) {
    this.comp = comp;
    this.w = new Uint8Array(comp.nWires);
    this.latchBuf = new Uint8Array(comp.dffQ.length);
  }

  get name(): string { return this.comp.name; }

  setInput(name: string, value: number): void {
    const bus = this.comp.inputs.get(name);
    if (!bus) throw new Error(`${this.comp.name}: 未知输入引脚 ${name}`);
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bus.length) {
      throw new Error(`${this.comp.name}: 输入 ${name}=${value} 超出 ${bus.length} 位范围`);
    }
    for (let i = 0; i < bus.length; i++) this.w[bus[i]] = (value >>> i) & 1;
  }

  readBus(bus: Bus): number {
    let v = 0;
    for (let i = 0; i < bus.length; i++) v |= this.w[bus[i]] << i;
    return v >>> 0;
  }

  getOutput(name: string): number {
    const bus = this.comp.outputs.get(name);
    if (!bus) throw new Error(`${this.comp.name}: 未知输出引脚 ${name}`);
    return this.readBus(bus);
  }

  busWidth(kind: 'inputs' | 'outputs', name: string): number {
    const bus = this.comp[kind].get(name);
    return bus ? bus.length : -1;
  }

  /** 直接写某根线的值。仅用于状态迁移（浏览器模式切换导入 A/D/PC），黄金测试不用。 */
  pokeWire(w: Wire, v: 0 | 1): void { this.w[w] = v; }

  outputBus(name: string): Bus {
    const bus = this.comp.outputs.get(name);
    if (!bus) throw new Error(`${this.comp.name}: 未知输出引脚 ${name}`);
    return bus;
  }

  eval(): void {
    this.evalCount++;
    if (this.useJit && this.comp.jitFn) {
      this.comp.jitFn(this.w);
      return;
    }
    const { gA, gB, gOut } = this.comp;
    const w = this.w;
    for (let i = 0; i < gA.length; i++) {
      w[gOut[i]] = (~(w[gA[i]] & w[gB[i]])) & 1;
    }
  }

  tick(): void {
    const { dffD, dffQ } = this.comp;
    const w = this.w;
    const buf = this.latchBuf;
    for (let i = 0; i < dffD.length; i++) buf[i] = w[dffD[i]];
    for (let i = 0; i < dffQ.length; i++) w[dffQ[i]] = buf[i];
  }

  step(): void {
    this.eval();
    this.tick();
  }

  resetState(): void { this.w.fill(0); }
}
