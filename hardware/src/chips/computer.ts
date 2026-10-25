// Computer（M5）：门级 CPU + 行为级 Memory + ROM（程序数组）。
// 每周期：以状态线（A/PC 寄存器输出）取指与读内存 → 组合求值 →
// 记录沿前可观测值 → 时钟沿锁存 → 按 writeM 写内存。

import { Chip } from '../core/circuit.ts';
import { buildCpu } from './cpu.ts';
import { Memory } from './memory.ts';

export interface CycleRecord {
  cycle: number;
  pc: number;
  a: number;
  d: number;
  addressM: number;
  /** C 指令周期的 ALU 输出；A 指令周期无定义（原样返回门级结果，比较时忽略） */
  outM: number;
  writeM: number;
}

export class Computer {
  readonly cpu: Chip;
  readonly mem = new Memory();
  readonly rom = new Uint16Array(0x8000);
  cycles = 0;

  constructor() {
    this.cpu = new Chip(buildCpu());
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
    this.cpu.resetState();
    this.mem.clear();
    this.cycles = 0;
  }

  /** 跑一个完整时钟周期。reset=1 时该沿 PC 归 0（指令照常执行）。 */
  step(reset: 0 | 1 = 0): CycleRecord {
    const cpu = this.cpu;
    const addressM = cpu.getOutput('addressM'); // A 寄存器状态线
    const pc = cpu.getOutput('pc'); // PC 状态线
    cpu.setInput('instruction', this.rom[pc]);
    cpu.setInput('inM', this.mem.read(addressM));
    cpu.setInput('reset', reset);
    cpu.eval();
    const rec: CycleRecord = {
      cycle: this.cycles,
      pc,
      a: cpu.getOutput('aReg'),
      d: cpu.getOutput('dReg'),
      addressM,
      outM: cpu.getOutput('outM'),
      writeM: cpu.getOutput('writeM'),
    };
    cpu.tick();
    if (rec.writeM) this.mem.write(rec.addressM, rec.outM);
    this.cycles++;
    return rec;
  }

  /** 状态迁移（浏览器模式切换用）：导入 A/D/PC 寄存器值 */
  importState(a: number, d: number, pc: number): void {
    const aBus = this.cpu.outputBus('aReg');
    const dBus = this.cpu.outputBus('dReg');
    const pcBus = this.cpu.outputBus('pc');
    for (let i = 0; i < 16; i++) this.cpu.pokeWire(aBus[i], ((a >>> i) & 1) as 0 | 1);
    for (let i = 0; i < 16; i++) this.cpu.pokeWire(dBus[i], ((d >>> i) & 1) as 0 | 1);
    for (let i = 0; i < 15; i++) this.cpu.pokeWire(pcBus[i], ((pc >>> i) & 1) as 0 | 1);
  }
}
