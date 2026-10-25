// 时序芯片（M4）：Bit / Register / ARegister / DRegister / PC。
// 寄存器用「先分配 q 线、后绑定 DFF」的占位模式以支持反馈结构。

import type { Circuit, Wire, Bus } from '../core/circuit.ts';
import { mux1, and1, not1, mux16, zeros16 } from './prims.ts';
import { inc16 } from './arith.ts';

export function allocBus(c: Circuit, n: number): Bus {
  const bus: Bus = [];
  for (let i = 0; i < n; i++) bus.push(c.fresh());
  return bus;
}

/** 1 位寄存器：时钟沿 load=1 时 q←d，否则保持。 */
export function bitInto(c: Circuit, q: Wire, d: Wire, load: Wire): void {
  c.dffInto(q, mux1(c, q, d, load)); // 5 门 + 1 DFF
}

/** 16 位寄存器（d 与 q 等宽） */
export function regInto(c: Circuit, q: Bus, d: Bus, load: Wire): void {
  for (let i = 0; i < q.length; i++) bitInto(c, q[i], d[i], load);
}

export function register16(c: Circuit, d: Bus, load: Wire): Bus {
  const q = allocBus(c, 16);
  regInto(c, q, d, load);
  return q;
}

/**
 * 16 位程序计数器：优先级 reset > load > inc，都无效时保持。
 * out 暴露低 15 位（15 位程序地址，模 32768 计数）。
 */
export function pc16(c: Circuit, d: Bus, load: Wire, inc: Wire, reset: Wire): Bus {
  const q = allocBus(c, 16);
  const eInc = and1(c, inc, not1(c, load)); // load 优先于 inc
  const v1 = mux16(c, q, inc16(c, q), eInc);
  const v2 = mux16(c, v1, d, load);
  const v3 = mux16(c, v2, zeros16(c), reset); // reset 最高优先
  for (let i = 0; i < 16; i++) c.dffInto(q[i], v3[i]);
  return q;
}
