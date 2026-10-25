// 时序与门级存储芯片构建器（M4）。

import { chip } from './registry.ts';
import type { Compiled } from '../core/circuit.ts';
import { register16, pc16, bitInto } from './sequential.ts';
import { ram8, ram64 } from './memory-gates.ts';

export function buildBit(): Compiled {
  return chip('Bit', (c) => {
    const inn = c.inBus('in');
    const load = c.inBus('load');
    const q = c.fresh();
    bitInto(c, q, inn[0], load[0]);
    c.bind('out', [q]);
  });
}

export function buildRegister(): Compiled {
  return chip('Register', (c) => {
    const inn = c.inBus('in', 16);
    const load = c.inBus('load');
    c.bind('out', register16(c, inn, load[0]));
  });
}

/** ARegister / DRegister：与 Register 同接口（CPU 内语义不同，芯片级等价） */
export function buildARegister(): Compiled {
  return chip('ARegister', (c) => {
    const inn = c.inBus('in', 16);
    const load = c.inBus('load');
    c.bind('out', register16(c, inn, load[0]));
  });
}

export function buildDRegister(): Compiled {
  return chip('DRegister', (c) => {
    const inn = c.inBus('in', 16);
    const load = c.inBus('load');
    c.bind('out', register16(c, inn, load[0]));
  });
}

export function buildPC(): Compiled {
  return chip('PC', (c) => {
    const inn = c.inBus('in', 16);
    const load = c.inBus('load');
    const inc = c.inBus('inc');
    const reset = c.inBus('reset');
    const q = pc16(c, inn, load[0], inc[0], reset[0]);
    c.bind('out', q.slice(0, 15));
  });
}

export function buildRam8(): Compiled {
  return chip('RAM8', (c) => {
    const address = c.inBus('address', 3);
    const inn = c.inBus('in', 16);
    const load = c.inBus('load');
    c.bind('out', ram8(c, address, inn, load[0]));
  });
}

export function buildRam64(): Compiled {
  return chip('RAM64', (c) => {
    const address = c.inBus('address', 6);
    const inn = c.inBus('in', 16);
    const load = c.inBus('load');
    c.bind('out', ram64(c, address, inn, load[0]));
  });
}
