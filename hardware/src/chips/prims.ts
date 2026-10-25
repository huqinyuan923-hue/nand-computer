// 门级组合器：全部由 Nand 原语构成（src/core/circuit.ts 的 Circuit.nand）。
// 1 位原语 + 16 位/多路变体。期望门数均已手工核算（见 docs/GOLDEN.md 同级说明）。

import type { Circuit, Wire, Bus } from '../core/circuit.ts';

// ---- 1 位原语 ----

export const not1 = (c: Circuit, a: Wire): Wire => c.nand(a, a);

export function and1(c: Circuit, a: Wire, b: Wire): Wire {
  const n = c.nand(a, b);
  return c.nand(n, n); // 2 门
}

export function or1(c: Circuit, a: Wire, b: Wire): Wire {
  return c.nand(c.nand(a, a), c.nand(b, b)); // 3 门
}

export function xor1(c: Circuit, a: Wire, b: Wire): Wire {
  const n1 = c.nand(a, b);
  return c.nand(c.nand(a, n1), c.nand(b, n1)); // 4 门
}

/** Mux: sel=0 选 a，sel=1 选 b（标准 Hack 语义） */
export function mux1(c: Circuit, a: Wire, b: Wire, s: Wire): Wire {
  const ns = c.nand(s, s);
  return c.nand(c.nand(a, ns), c.nand(b, s)); // 5 门
}

/** DMux: sel=0 → [in,0]，sel=1 → [0,in] */
export function dmux1(c: Circuit, inn: Wire, s: Wire): [Wire, Wire] {
  const ns = not1(c, s);
  return [and1(c, inn, ns), and1(c, inn, s)]; // 5 门
}

// ---- 16 位 / 多路 ----

export function zeros16(c: Circuit): Bus { return Array<Wire>(16).fill(c.zero); }
export function ones16(c: Circuit): Bus { const o = c.const1(); return Array<Wire>(16).fill(o); }

export const not16 = (c: Circuit, b: Bus): Bus => b.map((w) => not1(c, w));
export const and16 = (c: Circuit, a: Bus, b: Bus): Bus => a.map((w, i) => and1(c, w, b[i]));
export const or16 = (c: Circuit, a: Bus, b: Bus): Bus => a.map((w, i) => or1(c, w, b[i]));
export const xor16 = (c: Circuit, a: Bus, b: Bus): Bus => a.map((w, i) => xor1(c, w, b[i]));

export const mux16 = (c: Circuit, a: Bus, b: Bus, s: Wire): Bus =>
  a.map((w, i) => mux1(c, w, b[i], s));

export function or8way(c: Circuit, b: Bus): Wire {
  let v = b[0];
  for (let i = 1; i < 8; i++) v = or1(c, v, b[i]);
  return v; // 7 门
}

export function or16way(c: Circuit, b: Bus): Wire {
  return or1(c, or8way(c, b.slice(0, 8)), or8way(c, b.slice(8, 16)));
}

/** sel[0] 在 a/b 之间选，sel[1] 在两组之间选 */
export function mux4way16(c: Circuit, a: Bus, b: Bus, cc: Bus, d: Bus, sel: Bus): Bus {
  const ab = mux16(c, a, b, sel[0]);
  const cd = mux16(c, cc, d, sel[0]);
  return mux16(c, ab, cd, sel[1]);
}

/** ins[0..7]，sel[0] 低位组内选，sel[2] 组间选 */
export function mux8way16(c: Circuit, ins: Bus[], sel: Bus): Bus {
  const lo = mux4way16(c, ins[0], ins[1], ins[2], ins[3], [sel[0], sel[1]]);
  const hi = mux4way16(c, ins[4], ins[5], ins[6], ins[7], [sel[0], sel[1]]);
  return mux16(c, lo, hi, sel[2]);
}

export function dmux4way(c: Circuit, inn: Wire, sel: Bus): [Wire, Wire, Wire, Wire] {
  const [ab, cd] = dmux1(c, inn, sel[1]);
  const [a, b] = dmux1(c, ab, sel[0]);
  const [cc, d] = dmux1(c, cd, sel[0]);
  return [a, b, cc, d];
}

export function dmux8way(c: Circuit, inn: Wire, sel: Bus): Wire[] {
  const [lo, hi] = dmux1(c, inn, sel[2]);
  return [...dmux4way(c, lo, [sel[0], sel[1]]), ...dmux4way(c, hi, [sel[0], sel[1]])];
}
