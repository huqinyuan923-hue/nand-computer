// 行为级 Hack ISA 解释器（oracle）：约百行，独立于门级实现。
// 用途 1) 指令级黄金对照；2) 浏览器行为级快进模式。
// 时钟语义与 docs/GOLDEN.md computer-trace 完全一致。

import { Memory } from '../chips/memory.ts';

export interface OracleRecord {
  cycle: number;
  pc: number;
  a: number;
  d: number;
  addressM: number;
  /** C 指令周期为 ALU 输出；A 指令周期无定义 → null */
  outM: number | null;
  writeM: number;
}

export class HackOracle {
  a = 0;
  d = 0;
  pc = 0;
  readonly mem: Memory;
  readonly rom = new Uint16Array(0x8000);
  cycles = 0;

  constructor(mem?: Memory) {
    this.mem = mem ?? new Memory();
  }

  loadRom(words: ArrayLike<number>): void {
    this.rom.fill(0);
    for (let i = 0; i < Math.min(words.length, this.rom.length); i++) {
      this.rom[i] = words[i] & 0xffff;
    }
  }

  setKeyboard(v: number): void {
    this.mem.kbd = v & 0xffff;
  }

  resetState(): void {
    this.a = 0;
    this.d = 0;
    this.pc = 0;
    this.mem.clear();
    this.cycles = 0;
  }

  importState(a: number, d: number, pc: number): void {
    this.a = a;
    this.d = d;
    this.pc = pc;
  }

  /** 跑一个完整时钟周期；reset=1 时该沿 PC 归 0（指令照常执行）。 */
  step(reset: 0 | 1 = 0): OracleRecord {
    const pcOld = this.pc;
    const aOld = this.a;
    const dOld = this.d;
    const inst = this.rom[pcOld];
    const addressM = aOld & 0x7fff;
    const inM = this.mem.read(addressM);

    let outM: number | null = null;
    let writeM = 0;

    if (inst & 0x8000) {
      // C 指令：111a cccccc ddd jjj
      const aBit = (inst >>> 12) & 1;
      let x = dOld;
      let y = aBit ? inM : aOld;
      if ((inst >>> 11) & 1) x = 0;
      if ((inst >>> 10) & 1) x = (~x) & 0xffff;
      if ((inst >>> 9) & 1) y = 0;
      if ((inst >>> 8) & 1) y = (~y) & 0xffff;
      let out = (inst >>> 7) & 1 ? (x + y) & 0xffff : (x & y);
      if ((inst >>> 6) & 1) out = (~out) & 0xffff;
      const zr = out === 0 ? 1 : 0;
      const ng = out >>> 15;
      const d1 = (inst >>> 5) & 1; // dest.A（ddd 字段最高位 → bit5）
      const d2 = (inst >>> 4) & 1; // dest.D
      const d3 = (inst >>> 3) & 1; // dest.M（字段最低位 → bit3）
      writeM = d3;
      if (d1) this.a = out;
      if (d2) this.d = out;
      const jlt = (inst >>> 2) & 1;
      const jeq = (inst >>> 1) & 1;
      const jgt = inst & 1;
      const doJmp = (jlt === 1 && ng === 1) || (jeq === 1 && zr === 1) || (jgt === 1 && ng === 0 && zr === 0);
      this.pc = doJmp ? (aOld & 0x7fff) : (pcOld + 1) & 0x7fff; // 跳转用沿前 A
      if (writeM) this.mem.write(addressM, out);
      outM = out;
    } else {
      // A 指令：A ← 15 位立即数
      this.a = inst & 0x7fff;
      this.pc = (pcOld + 1) & 0x7fff;
    }
    if (reset === 1) this.pc = 0;

    return { cycle: this.cycles++, pc: pcOld, a: aOld, d: dOld, addressM, outM, writeM };
  }
}
