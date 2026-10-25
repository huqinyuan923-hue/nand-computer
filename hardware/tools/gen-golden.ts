// 黄金向量生成器（确定性，见 docs/GOLDEN.md）。
// 期望值全部用独立的 JS 布尔/算术表达式计算，与门级实现无关。
// 运行：npm run gen:golden

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'golden');
mkdirSync(outDir, { recursive: true });

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function write(name: string, obj: unknown): void {
  writeFileSync(join(outDir, name), JSON.stringify(obj, null, 1) + '\n');
  console.log('golden written:', name);
}

// ---------------------------------------------------------------- M1: Nand

// 穷举真值表；期望 = 独立布尔表达式
const nandCases = [];
for (const a of [0, 1]) {
  for (const b of [0, 1]) {
    nandCases.push({ in: { a, b }, out: { out: a && b ? 0 : 1 } });
  }
}
write('nand.json', { chip: 'Nand', kind: 'comb', cases: nandCases });

console.log('done.');
