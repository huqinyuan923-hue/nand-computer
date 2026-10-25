// 运算芯片（M3）：HalfAdder / FullAdder / Add16 / Inc16 / Hack ALU。
// 全部由 Nand 原语组合；加法器用 9 门全加器（和、进位共享中间项）。

import type { Circuit, Wire, Bus } from '../core/circuit.ts';
import { mux16, not16, and16, zeros16, and1, not1, or1, xor1 } from './prims.ts';

/** 半加器：sum = a XOR b，carry = a AND b */
export function halfadder(c: Circuit, a: Wire, b: Wire): { sum: Wire; carry: Wire } {
  const n1 = c.nand(a, b);
  const sum = c.nand(c.nand(a, n1), c.nand(b, n1)); // 4 门 XOR
  const carry = and1(c, a, b);
  return { sum, carry };
}

/** 9 门全加器：carry = (a&b) | ((a^b)&c_in)，sum = a^b^c_in */
export function fulladder(c: Circuit, a: Wire, b: Wire, cin: Wire): { sum: Wire; carry: Wire } {
  const n1 = c.nand(a, b);
  const n2 = c.nand(a, n1);
  const n3 = c.nand(b, n1);
  const axb = c.nand(n2, n3); // a XOR b
  const n4 = c.nand(axb, cin);
  const n5 = c.nand(axb, n4);
  const n6 = c.nand(cin, n4);
  const sum = c.nand(n5, n6);
  const carry = c.nand(n1, n4);
  return { sum, carry };
}

/** 16 位行波进位加法器：out = (a + b) mod 2^16（进位出丢弃） */
export function add16(c: Circuit, a: Bus, b: Bus): Bus {
  const out: Bus = [];
  let { sum, carry } = halfadder(c, a[0], b[0]);
  out.push(sum);
  for (let i = 1; i < 16; i++) {
    const fa = fulladder(c, a[i], b[i], carry);
    out.push(fa.sum);
    carry = fa.carry;
  }
  return out;
}

/** 16 位自增：out = (in + 1) mod 2^16。bit0 直接取反，之后逐位 XOR/AND 传播进位。 */
export function inc16(c: Circuit, inb: Bus): Bus {
  const out: Bus = [not1(c, inb[0])];
  let carry = inb[0];
  for (let i = 1; i < 16; i++) {
    out.push(xor1(c, inb[i], carry));
    carry = and1(c, inb[i], carry);
  }
  return out;
}

export interface AluOut { out: Bus; zr: Wire; ng: Wire }

/**
 * Hack ALU（标准规范）：
 *  zx,nx 作用于 x；zy,ny 作用于 y；f=1 加法 / f=0 与；no=1 输出取反。
 *  zr=1 当 out==0；ng=out[15]。
 */
export function alu(
  c: Circuit, x: Bus, y: Bus,
  zx: Wire, nx: Wire, zy: Wire, ny: Wire, f: Wire, no: Wire,
): AluOut {
  const zero = zeros16(c);
  const x1 = mux16(c, x, zero, zx);
  const x2 = mux16(c, x1, not16(c, x1), nx);
  const y1 = mux16(c, y, zero, zy);
  const y2 = mux16(c, y1, not16(c, y1), ny);
  const andOut = and16(c, x2, y2);
  const addOut = add16(c, x2, y2);
  const fOut = mux16(c, andOut, addOut, f);
  const out = mux16(c, fOut, not16(c, fOut), no);
  const zr = not1(c, or1(c, or8wayL(c, out.slice(0, 8)), or8wayL(c, out.slice(8, 16))));
  return { out, zr, ng: out[15] };
}

// 局部引入避免循环依赖：or8way 在 prims 里，直接内联小工具
function or8wayL(c: Circuit, b: Bus): Wire {
  let v = b[0];
  for (let i = 1; i < b.length; i++) v = or1(c, v, b[i]);
  return v;
}
