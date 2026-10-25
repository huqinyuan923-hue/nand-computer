// 门级存储（M4）：RAM8 → RAM64（官方课程要求门级），地址译码用 DMux/Mux 树。
// RAM4K / RAM16K 属行为级豁免，见同目录 behavioral 的 Memory。

import type { Circuit, Wire, Bus } from '../core/circuit.ts';
import { dmux8way, mux8way16 } from './prims.ts';
import { register16 } from './sequential.ts';

/** 8 字 × 16 位寄存器堆：load 经 DMux8Way 分发，输出经 Mux8Way16 汇聚 */
export function ram8(c: Circuit, address: Bus, inb: Bus, load: Wire): Bus {
  const loads = dmux8way(c, load, address);
  const regs: Bus[] = [];
  for (let i = 0; i < 8; i++) regs.push(register16(c, inb, loads[i]));
  return mux8way16(c, regs, address);
}

/** 64 字 × 16 位：8 个 RAM8，高位地址选 bank */
export function ram64(c: Circuit, address: Bus, inb: Bus, load: Wire): Bus {
  const lo = [address[0], address[1], address[2]];
  const hi = [address[3], address[4], address[5]];
  const loads = dmux8way(c, load, hi);
  const banks: Bus[] = [];
  for (let i = 0; i < 8; i++) banks.push(ram8(c, lo, inb, loads[i]));
  return mux8way16(c, banks, hi);
}
