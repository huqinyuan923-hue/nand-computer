// 基准程序与性能测量（M6 预算：Node 下门级 CPU ≥ 10 万 Hack 周期/秒）。
// 程序：计数器递减循环，每轮含内存读/写、ALU 加减、条件跳转——真实负载混合。

import { performance } from 'node:perf_hooks';
import { Computer } from '../chips/computer.ts';
import { aInst, cInst } from './asm.ts';

export function buildBenchRom(): number[] {
  // RAM[0]=counter（测试前置为 0xFFFF），RAM[2]=acc
  return [
    aInst(0), cInst('M', 'D'), // D = counter
    aInst(2), cInst('D+M', 'M'), // acc += D
    aInst(0), cInst('M-1', 'M'), // counter--
    aInst(0), cInst('M', 'D'), // D = counter
    aInst(3), cInst('D-A', 'D'), // D = counter - 3
    aInst(0), cInst('D', '', 'JNE'), // !=3 则循环（跳到 A=0）
    aInst(12), cInst('0', '', 'JMP'), // 停机自跳
  ];
}

export interface BenchResult {
  backend: 'jit' | 'interp';
  cycles: number;
  ms: number;
  cyclesPerSec: number;
}

export function runBench(targetCycles: number, backend: 'jit' | 'interp'): BenchResult {
  const comp = new Computer();
  comp.cpu.useJit = backend === 'jit';
  comp.loadRom(buildBenchRom());
  comp.mem.ram[0] = 0xffff; // 计数器初值：约 65k 轮 × 12 指令 ≈ 78 万周期
  const t0 = performance.now();
  let cycles = 0;
  while (cycles < targetCycles) {
    comp.step(0);
    cycles++;
    // 防御：程序停机后（counter<=3）跳出，避免空转影响测量
    if (cycles % 4096 === 0 && comp.mem.ram[0] <= 3 && cycles > 1000) break;
  }
  const ms = performance.now() - t0;
  return { backend, cycles, ms, cyclesPerSec: Math.round((cycles / ms) * 1000) };
}
