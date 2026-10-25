// Hack CPU（M5，门级）：取指/译码/执行、M 读写、跳转。
// 数据通路（与 docs/GOLDEN.md computer-trace 语义一致）：
//   A 寄存器输入 = A 指令立即数 / C 指令 outM（d1）
//   ALU.x = D 寄存器；ALU.y = a 位 ? inM : A 寄存器输出
//   PC.load = C 指令跳转命中（用沿前的 A 值装入）；PC.inc 恒 1；reset 直连
// 对外：outM / writeM / addressM（=A 寄存器低 15 位）/ pc（15 位）；
// 另暴露 aReg / dReg 作调试与状态迁移用。

import { chip } from './registry.ts';
import { not1, and1, or1, mux16 } from './prims.ts';
import { alu } from './arith.ts';
import { allocBus, regInto, pc16 } from './sequential.ts';
import type { Compiled } from '../core/circuit.ts';

export function buildCpu(): Compiled {
  return chip('CPU', (c) => {
    const inM = c.inBus('inM', 16);
    const instruction = c.inBus('instruction', 16);
    const reset = c.inBus('reset');

    const inst15 = instruction[15];
    const isA = not1(c, inst15);
    // dest 字段 ddd=d1(A)d2(D)d3(M) 位于 bit3..5：d3(M)→bit3，d2(D)→bit4，d1(A)→bit5
    const loadA = or1(c, isA, instruction[5]); // A 指令 or dest.A
    const loadD = and1(c, inst15, instruction[4]); // dest.D
    const writeM = and1(c, inst15, instruction[3]); // dest.M

    const aQ = allocBus(c, 16);
    const dQ = allocBus(c, 16);

    const y = mux16(c, aQ, inM, instruction[12]); // a 位选 M / A
    const r = alu(
      c, dQ, y,
      instruction[11], instruction[10], // zx nx
      instruction[9], instruction[8],   // zy ny
      instruction[7], instruction[6],   // f no
    );
    const outM = r.out;

    const aIn = mux16(c, outM, instruction, isA);
    regInto(c, aQ, aIn, loadA);
    regInto(c, dQ, outM, loadD);

    // 跳转：j1(jlt) j2(jeq) j3(jgt) 位于 bit2..0，仅 C 指令有效
    const jLoad = or1(
      c,
      or1(c, and1(c, instruction[2], r.ng), and1(c, instruction[1], r.zr)),
      and1(c, instruction[0], and1(c, not1(c, r.ng), not1(c, r.zr))),
    );
    const doJmp = and1(c, inst15, jLoad);
    const pcQ = pc16(c, aQ, doJmp, c.const1(), reset[0]);

    c.bind('outM', outM);
    c.bind('writeM', [writeM]);
    c.bind('addressM', aQ.slice(0, 15));
    c.bind('pc', pcQ.slice(0, 15));
    c.bind('aReg', aQ);
    c.bind('dReg', dQ);
  });
}
