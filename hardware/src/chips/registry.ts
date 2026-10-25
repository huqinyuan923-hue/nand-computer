// 芯片注册表：黄金测试通过 chip 名查到这里构建芯片实例。
// 每个里程碑扩展；所有构建器都从 Nand/DFF 原语组合而来。

import { Circuit, compile } from '../core/circuit.ts';
import type { Compiled } from '../core/circuit.ts';

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
};
