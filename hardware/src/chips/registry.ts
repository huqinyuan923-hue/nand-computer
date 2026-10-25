// 芯片注册表：黄金测试通过 chip 名查到这里构建芯片实例。
// 每个里程碑扩展；所有构建器都从 Nand/DFF 原语组合而来。

import { Circuit, compile } from '../core/circuit.ts';
import type { Compiled } from '../core/circuit.ts';
import {
  buildNot, buildAnd, buildOr, buildXor, buildMux, buildDMux, buildOr8Way,
  buildNot16, buildAnd16, buildOr16, buildXor16, buildMux16,
  buildMux4Way16, buildMux8Way16, buildDMux4Way, buildDMux8Way,
} from './combinational.ts';

export function chip(name: string, fn: (c: Circuit) => void): Compiled {
  const c = new Circuit(name);
  fn(c);
  return compile(c);
}

export const REGISTRY: Record<string, () => Compiled> = {
  Nand: () => chip('Nand', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    c.bind('out', [c.nand(a[0], b[0])]);
  }),
  Not: buildNot,
  And: buildAnd,
  Or: buildOr,
  Xor: buildXor,
  Mux: buildMux,
  DMux: buildDMux,
  Or8Way: buildOr8Way,
  Not16: buildNot16,
  And16: buildAnd16,
  Or16: buildOr16,
  Xor16: buildXor16,
  Mux16: buildMux16,
  Mux4Way16: buildMux4Way16,
  Mux8Way16: buildMux8Way16,
  DMux4Way: buildDMux4Way,
  DMux8Way: buildDMux8Way,
};
