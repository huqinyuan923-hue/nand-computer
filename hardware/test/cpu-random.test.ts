// 指令级随机对拍（M6）：固定种子生成随机程序，
// 门级 Computer（jit 与 interp 抽样）与行为级 oracle 逐周期 diff。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Computer } from '../src/chips/computer.ts';
import { HackOracle } from '../src/oracle/hack.ts';
import { aInst, cInst } from '../src/dev/asm.ts';
import { mulberry32 } from '../tools/gen-golden.ts';

const SEED = 20261025;
const PROGRAMS = 80;
const INTERP_EVERY = 8; // 每 8 个程序用 interp 后端再对拍一遍

const COMPS = [
  '0', '1', '-1', 'D', 'A', '!D', '!A', '-D', '-A', 'D+1', 'A+1', 'D-1', 'A-1',
  'D+A', 'D-A', 'A-D', 'D&A', 'D|M',
  'M', '!M', 'D+M', 'D-M', 'M-D', 'M+1', 'M-1',
];
const DESTS = ['', 'M', 'D', 'MD', 'A', 'AM', 'AD', 'AMD'];
const JUMPS = ['', '', '', 'JGT', 'JEQ', 'JLT', 'JNE', 'JGE', 'JLE', 'JMP'];

function genProgram(rng: () => number): number[] {
  const len = 24 + Math.floor(rng() * 40);
  const prog: number[] = [];
  for (let i = 0; i < len; i++) {
    const r = rng();
    if (r < 0.38) {
      const ar = rng();
      let addr: number;
      if (ar < 0.6) addr = Math.floor(rng() * 64); // RAM 低段
      else if (ar < 0.8) addr = 0x4000 + Math.floor(rng() * 16); // Screen
      else if (ar < 0.92) addr = 0x6000; // KBD
      else addr = 0x6001 + Math.floor(rng() * 4); // 越界
      prog.push(aInst(addr));
    } else {
      const comp = COMPS[Math.floor(rng() * COMPS.length)];
      const dest = DESTS[Math.floor(rng() * DESTS.length)];
      const jump = JUMPS[Math.floor(rng() * JUMPS.length)];
      prog.push(cInst(comp, dest, jump));
    }
  }
  return prog;
}

function diffOnce(seed: number, backend: 'jit' | 'interp'): void {
  const rng = mulberry32(seed);
  const rom = genProgram(rng);
  const cap = rom.length * 8 + 128;

  const gate = new Computer();
  const ref = new HackOracle();
  gate.loadRom(rom);
  ref.loadRom(rom);
  gate.cpu.useJit = backend === 'jit';

  // 一部分程序带键盘事件（两引擎同喂）
  const kbdEvents: { at: number; code: number }[] = [];
  if (rng() < 0.5) {
    for (let k = 0; k < 3; k++) {
      kbdEvents.push({ at: Math.floor(rng() * cap), code: 30 + Math.floor(rng() * 20) });
    }
    kbdEvents.sort((x, y) => x.at - y.at);
  }
  let ev = 0;
  let kbd = 0;

  for (let n = 0; n < cap; n++) {
    while (ev < kbdEvents.length && kbdEvents[ev].at <= n) {
      kbd = kbdEvents[ev].code;
      ev++;
    }
    gate.setKeyboard(kbd);
    ref.setKeyboard(kbd);
    const g = gate.step(0);
    const o = ref.step(0);
    assert.equal(g.pc, o.pc, `seed=${seed} backend=${backend} cycle ${n} pc`);
    assert.equal(g.a, o.a, `seed=${seed} backend=${backend} cycle ${n} a`);
    assert.equal(g.d, o.d, `seed=${seed} backend=${backend} cycle ${n} d`);
    assert.equal(g.addressM, o.addressM, `seed=${seed} backend=${backend} cycle ${n} addressM`);
    assert.equal(g.writeM, o.writeM, `seed=${seed} backend=${backend} cycle ${n} writeM`);
    if (o.outM !== null) {
      assert.equal(g.outM, o.outM, `seed=${seed} backend=${backend} cycle ${n} outM`);
    }
  }
  assert.deepEqual(gate.mem.ram, ref.mem.ram, `seed=${seed} backend=${backend} final RAM`);
  assert.deepEqual(gate.mem.screen, ref.mem.screen, `seed=${seed} backend=${backend} final screen`);
}

test(`随机对拍：${PROGRAMS} 个固定种子随机程序 门级(jit) vs oracle`, () => {
  const rng = mulberry32(SEED);
  for (let p = 0; p < PROGRAMS; p++) {
    diffOnce(Math.floor(rng() * 0xffffffff), 'jit');
  }
});

test(`随机对拍：每 ${INTERP_EVERY} 程序抽 1 个 interp 后端 vs oracle`, () => {
  const rng = mulberry32(SEED + 1);
  for (let p = 0; p < PROGRAMS / INTERP_EVERY; p++) {
    diffOnce(Math.floor(rng() * 0xffffffff), 'interp');
  }
});
