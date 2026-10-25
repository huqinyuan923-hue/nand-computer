// 运算芯片构建器（M3）：HalfAdder / FullAdder / Add16 / Inc16 / ALU。

import { chip } from './registry.ts';
import type { Compiled } from '../core/circuit.ts';
import { halfadder, fulladder, add16, inc16, alu } from './arith.ts';

export function buildHalfAdder(): Compiled {
  return chip('HalfAdder', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    const r = halfadder(c, a[0], b[0]);
    c.bind('sum', [r.sum]);
    c.bind('carry', [r.carry]);
  });
}

export function buildFullAdder(): Compiled {
  return chip('FullAdder', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    const cin = c.inBus('c');
    const r = fulladder(c, a[0], b[0], cin[0]);
    c.bind('sum', [r.sum]);
    c.bind('carry', [r.carry]);
  });
}

export function buildAdd16(): Compiled {
  return chip('Add16', (c) => {
    const a = c.inBus('a', 16);
    const b = c.inBus('b', 16);
    c.bind('out', add16(c, a, b));
  });
}

export function buildInc16(): Compiled {
  return chip('Inc16', (c) => {
    const inn = c.inBus('in', 16);
    c.bind('out', inc16(c, inn));
  });
}

export function buildAlu(): Compiled {
  return chip('ALU', (c) => {
    const x = c.inBus('x', 16);
    const y = c.inBus('y', 16);
    const zx = c.inBus('zx');
    const nx = c.inBus('nx');
    const zy = c.inBus('zy');
    const ny = c.inBus('ny');
    const f = c.inBus('f');
    const no = c.inBus('no');
    const r = alu(c, x, y, zx[0], nx[0], zy[0], ny[0], f[0], no[0]);
    c.bind('out', r.out);
    c.bind('zr', [r.zr]);
    c.bind('ng', [r.ng]);
  });
}
