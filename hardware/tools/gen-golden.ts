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

const rng = mulberry32(20261025);

function write(name: string, obj: unknown): void {
  writeFileSync(join(outDir, name), JSON.stringify(obj, null, 1) + '\n');
  console.log('golden written:', name);
}

const bit = (v: number, i: number): number => (v >>> i) & 1;

// 16 位边界值集合 + 固定种子随机值
export const EDGE16 = [0, 1, 0xffff, 0x8000, 0x7fff, 0xaaaa, 0x5555, 0x00ff, 0xff00, 0x0f0f];
export function sample16(n: number): number[] {
  const out = EDGE16.slice();
  for (let i = 0; i < n; i++) out.push(Math.floor(rng() * 65536));
  return out;
}

// ---------------------------------------------------------------- M1: Nand

const nandCases = [];
for (const a of [0, 1]) {
  for (const b of [0, 1]) {
    nandCases.push({ in: { a, b }, out: { out: a && b ? 0 : 1 } });
  }
}
write('nand.json', { chip: 'Nand', kind: 'comb', cases: nandCases });

// ---------------------------------------------------------------- M2: 基础门

// 1 位门：穷举真值表（文件名小写，chip 用注册表键名）
function truth2(file: string, chipName: string, f: (a: number, b: number) => number): void {
  const cases = [];
  for (const a of [0, 1]) {
    for (const b of [0, 1]) {
      cases.push({ in: { a, b }, out: { out: f(a, b) } });
    }
  }
  write(`${file}.json`, { chip: chipName, kind: 'comb', cases });
}

// 一元门：输入引脚名为 in
function truth1(file: string, chipName: string, f: (a: number) => number): void {
  const cases = [];
  for (const a of [0, 1]) {
    cases.push({ in: { in: a }, out: { out: f(a) } });
  }
  write(`${file}.json`, { chip: chipName, kind: 'comb', cases });
}

truth1('not', 'Not', (a) => (a ? 0 : 1));
truth2('and', 'And', (a, b) => (a && b ? 1 : 0));
truth2('or', 'Or', (a, b) => (a || b ? 1 : 0));
truth2('xor', 'Xor', (a, b) => (a !== b ? 1 : 0));

const muxCases = [];
for (const a of [0, 1]) {
  for (const b of [0, 1]) {
    for (const sel of [0, 1]) {
      muxCases.push({ in: { a, b, sel }, out: { out: sel ? b : a } });
    }
  }
}
write('mux.json', { chip: 'Mux', kind: 'comb', cases: muxCases });

const dmuxCases = [];
for (const inn of [0, 1]) {
  for (const sel of [0, 1]) {
    dmuxCases.push({
      in: { in: inn, sel },
      out: { a: sel ? 0 : inn, b: sel ? inn : 0 },
    });
  }
}
write('dmux.json', { chip: 'DMux', kind: 'comb', cases: dmuxCases });

// Or8Way：穷举 256
{
  const cases = [];
  for (let v = 0; v < 256; v++) {
    const expected = (v > 0) ? 1 : 0;
    cases.push({ in: { in: v }, out: { out: expected } });
  }
  write('or8way.json', { chip: 'Or8Way', kind: 'comb', cases });
}

// 16 位一元/二元：边界集合 + 固定种子随机
{
  const vals = sample16(8);
  write('not16.json', {
    chip: 'Not16', kind: 'comb',
    cases: vals.map((v) => ({ in: { in: v }, out: { out: (~v) & 0xffff } })),
  });
  const pairCases = (f: (x: number, y: number) => number) => {
    const cs = [];
    for (const x of vals) for (const y of vals) cs.push({ in: { a: x, b: y }, out: { out: f(x, y) } });
    return cs;
  };
  write('and16.json', { chip: 'And16', kind: 'comb', cases: pairCases((x, y) => x & y) });
  write('or16.json', { chip: 'Or16', kind: 'comb', cases: pairCases((x, y) => x | y) });
  write('xor16.json', { chip: 'Xor16', kind: 'comb', cases: pairCases((x, y) => x ^ y) });

  const mux16Cases = [];
  for (const x of vals) {
    for (const y of vals) {
      for (const sel of [0, 1]) {
        mux16Cases.push({ in: { a: x, b: y, sel }, out: { out: sel ? y : x } });
      }
    }
  }
  write('mux16.json', { chip: 'Mux16', kind: 'comb', cases: mux16Cases });
}

// Mux4Way16：4 个输入各取 4 值 × sel 穷举
{
  const pick = [0, 1, 0xffff, 0x5a5a];
  const cases = [];
  for (const a of pick) for (const b of pick) for (const cc of pick) for (const d of pick) {
    for (let sel = 0; sel < 4; sel++) {
      const expected = [a, b, cc, d][sel];
      cases.push({
        in: { a, b, c: cc, d, sel },
        out: { out: expected },
      });
    }
  }
  write('mux4way16.json', { chip: 'Mux4Way16', kind: 'comb', cases });
}

// Mux8Way16：sel 穷举 × 随机输入采样
{
  const cases = [];
  for (let sel = 0; sel < 8; sel++) {
    for (let k = 0; k < 24; k++) {
      const ins = Array.from({ length: 8 }, () => Math.floor(rng() * 65536));
      cases.push({
        in: { a: ins[0], b: ins[1], c: ins[2], d: ins[3], e: ins[4], f: ins[5], g: ins[6], h: ins[7], sel },
        out: { out: ins[sel] },
      });
    }
  }
  write('mux8way16.json', { chip: 'Mux8Way16', kind: 'comb', cases });
}

// DMux4Way / DMux8Way：in 穷举 × sel 穷举
{
  const cases4 = [];
  for (const inn of [0, 1]) {
    for (let sel = 0; sel < 4; sel++) {
      cases4.push({
        in: { in: inn, sel },
        out: {
          a: sel === 0 ? inn : 0, b: sel === 1 ? inn : 0,
          c: sel === 2 ? inn : 0, d: sel === 3 ? inn : 0,
        },
      });
    }
  }
  write('dmux4way.json', { chip: 'DMux4Way', kind: 'comb', cases: cases4 });

  const cases8 = [];
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (const inn of [0, 1]) {
    for (let sel = 0; sel < 8; sel++) {
      const out: Record<string, number> = {};
      keys.forEach((k, i) => { out[k] = sel === i ? inn : 0; });
      cases8.push({ in: { in: inn, sel }, out });
    }
  }
  write('dmux8way.json', { chip: 'DMux8Way', kind: 'comb', cases: cases8 });
}

console.log('done.');
