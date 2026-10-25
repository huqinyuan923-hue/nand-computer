// 黄金测试 runner：按 docs/GOLDEN.md 的格式执行 golden/*.json。
// 每个文件在 interp / jit 两种求值后端下各跑一遍（测试文件层控制后端）。

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Chip } from '../src/core/circuit.ts';
import { REGISTRY } from '../src/chips/registry.ts';
import { Computer } from '../src/chips/computer.ts';
import { KeyboardDriver } from '../src/io/input.ts';
import { screenHash } from '../src/io/screen.ts';

export type Backend = 'interp' | 'jit';

export interface GoldenCase {
  in?: Record<string, number>;
  set?: Record<string, number>;
  out?: Record<string, number | null>;
  outAfter?: Record<string, number | null>;
  tick?: boolean;
  comment?: string;
}

export interface GoldenSpec {
  chip: string;
  kind: 'comb' | 'clocked' | 'computer-trace';
  cases?: GoldenCase[];
  // computer-trace 专用字段（M6 使用）：
  rom?: string[];
  initRam?: Record<string, number>;
  keyboard?: [number, number][];
  resetCycles?: number;
  cycles?: number;
  trace?: Record<string, number | null>[];
  finalRam?: Record<string, number>;
  finalScreenHash?: string;
}

export function makeChip(name: string, backend: Backend): Chip {
  const build = REGISTRY[name];
  if (!build) throw new Error(`registry 未注册芯片: ${name}`);
  const chip = new Chip(build());
  chip.useJit = backend === 'jit';
  return chip;
}

function setInputs(chip: Chip, obj: Record<string, number> | undefined): void {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) chip.setInput(k, v);
}

function checkOutputs(chip: Chip, label: string, obj: Record<string, number | null> | undefined): void {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue; // 不关心
    const actual = chip.getOutput(k);
    assert.equal(actual, v, `${label} 输出 ${k}: 期望 ${v}, 实际 ${actual}`);
  }
}

export function runGoldenFile(path: string, backend: Backend): void {
  const spec = JSON.parse(readFileSync(path, 'utf8')) as GoldenSpec;
  const label = `${spec.chip}[${backend}]`;

  if (spec.kind === 'comb' || spec.kind === 'clocked') {
    const chip = makeChip(spec.chip, backend);
    (spec.cases ?? []).forEach((cs, i) => {
      const cl = `${label} case#${i}`;
      if (spec.kind === 'comb') {
        setInputs(chip, cs.in);
        chip.eval();
        checkOutputs(chip, cl, cs.out);
      } else {
        setInputs(chip, cs.set ?? cs.in);
        chip.eval();
        checkOutputs(chip, cl, cs.out);
        if (cs.tick !== false) {
          chip.tick();
          chip.eval();
          checkOutputs(chip, cl, cs.outAfter);
        }
      }
    });
    return;
  }
  if (spec.kind === 'computer-trace') {
    const comp = new Computer();
    comp.cpu.useJit = backend === 'jit';
    comp.loadRom((spec.rom ?? []).map((s) => parseInt(s, 2)));
    for (const [k, v] of Object.entries(spec.initRam ?? {})) {
      comp.mem.ram[Number(k) & 0x3fff] = v & 0xffff;
    }
    const drv = new KeyboardDriver((spec.keyboard ?? []).map(([cycle, keycode]) => ({ cycle, keycode })));
    const resetCycles = spec.resetCycles ?? 1;
    const total = spec.cycles ?? 0;
    for (let n = 0; n < total; n++) {
      drv.apply(n, (v) => comp.setKeyboard(v));
      const rec = comp.step(n < resetCycles ? 1 : 0);
      const t = spec.trace?.[n];
      if (!t) continue;
      for (const [k, v] of Object.entries(t)) {
        if (v === null || v === undefined) continue; // 不关心（如 A 指令周期的 outM）
        const actual = (rec as unknown as Record<string, number>)[k];
        assert.equal(actual, v, `${label} cycle ${n} ${k}`);
      }
    }
    for (const [k, v] of Object.entries(spec.finalRam ?? {})) {
      assert.equal(comp.mem.ram[Number(k)], v, `${label} finalRam[${k}]`);
    }
    if (spec.finalScreenHash !== undefined) {
      assert.equal(screenHash(comp.mem.screen), spec.finalScreenHash, `${label} finalScreenHash`);
    }
    return;
  }
  throw new Error(`未知 kind: ${spec.kind}`);
}
