// 基础组合芯片构建器（M2）：每个都只由 Nand 原语组合。

import { chip } from './registry.ts';
import type { Compiled } from '../core/circuit.ts';
import type { Bus } from '../core/circuit.ts';
import {
  not1, and1, or1, xor1, mux1, dmux1,
  not16, and16, or16, xor16, mux16,
  or8way, mux4way16, mux8way16, dmux4way, dmux8way,
} from './prims.ts';

export function buildNot(): Compiled {
  return chip('Not', (c) => {
    const a = c.inBus('in');
    c.bind('out', [not1(c, a[0])]);
  });
}

export function buildAnd(): Compiled {
  return chip('And', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    c.bind('out', [and1(c, a[0], b[0])]);
  });
}

export function buildOr(): Compiled {
  return chip('Or', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    c.bind('out', [or1(c, a[0], b[0])]);
  });
}

export function buildXor(): Compiled {
  return chip('Xor', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    c.bind('out', [xor1(c, a[0], b[0])]);
  });
}

export function buildMux(): Compiled {
  return chip('Mux', (c) => {
    const a = c.inBus('a');
    const b = c.inBus('b');
    const s = c.inBus('sel');
    c.bind('out', [mux1(c, a[0], b[0], s[0])]);
  });
}

export function buildDMux(): Compiled {
  return chip('DMux', (c) => {
    const inn = c.inBus('in');
    const s = c.inBus('sel');
    const [a, b] = dmux1(c, inn[0], s[0]);
    c.bind('a', [a]);
    c.bind('b', [b]);
  });
}

export function buildOr8Way(): Compiled {
  return chip('Or8Way', (c) => {
    const inn = c.inBus('in', 8);
    c.bind('out', [or8way(c, inn)]);
  });
}

export function buildNot16(): Compiled {
  return chip('Not16', (c) => {
    const inn = c.inBus('in', 16);
    c.bind('out', not16(c, inn));
  });
}

export function buildAnd16(): Compiled {
  return chip('And16', (c) => {
    const a = c.inBus('a', 16);
    const b = c.inBus('b', 16);
    c.bind('out', and16(c, a, b));
  });
}

export function buildOr16(): Compiled {
  return chip('Or16', (c) => {
    const a = c.inBus('a', 16);
    const b = c.inBus('b', 16);
    c.bind('out', or16(c, a, b));
  });
}

export function buildXor16(): Compiled {
  return chip('Xor16', (c) => {
    const a = c.inBus('a', 16);
    const b = c.inBus('b', 16);
    c.bind('out', xor16(c, a, b));
  });
}

export function buildMux16(): Compiled {
  return chip('Mux16', (c) => {
    const a = c.inBus('a', 16);
    const b = c.inBus('b', 16);
    const s = c.inBus('sel');
    c.bind('out', mux16(c, a, b, s[0]));
  });
}

export function buildMux4Way16(): Compiled {
  return chip('Mux4Way16', (c) => {
    const a = c.inBus('a', 16);
    const b = c.inBus('b', 16);
    const cc = c.inBus('c', 16);
    const d = c.inBus('d', 16);
    const sel = c.inBus('sel', 2);
    c.bind('out', mux4way16(c, a, b, cc, d, sel));
  });
}

export function buildMux8Way16(): Compiled {
  return chip('Mux8Way16', (c) => {
    const ins: Bus[] = [
      c.inBus('a', 16), c.inBus('b', 16), c.inBus('c', 16), c.inBus('d', 16),
      c.inBus('e', 16), c.inBus('f', 16), c.inBus('g', 16), c.inBus('h', 16),
    ];
    const sel = c.inBus('sel', 3);
    c.bind('out', mux8way16(c, ins, sel));
  });
}

export function buildDMux4Way(): Compiled {
  return chip('DMux4Way', (c) => {
    const inn = c.inBus('in');
    const sel = c.inBus('sel', 2);
    const [a, b, cc, d] = dmux4way(c, inn[0], sel);
    c.bind('a', [a]);
    c.bind('b', [b]);
    c.bind('c', [cc]);
    c.bind('d', [d]);
  });
}

export function buildDMux8Way(): Compiled {
  return chip('DMux8Way', (c) => {
    const inn = c.inBus('in');
    const sel = c.inBus('sel', 3);
    const outs = dmux8way(c, inn[0], sel);
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    names.forEach((n, i) => c.bind(n, [outs[i]]));
  });
}
