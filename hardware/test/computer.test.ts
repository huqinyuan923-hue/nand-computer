// M5 冒烟：汇编器锚点编码 + 门级 Computer 定向程序 + oracle 一致性 + IO 工具。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Computer } from '../src/chips/computer.ts';
import { HackOracle } from '../src/oracle/hack.ts';
import { aInst, cInst } from '../src/dev/asm.ts';
import { parseHack, toHackText } from '../src/io/hackfile.ts';
import { parseInputScript, KeyboardDriver } from '../src/io/input.ts';
import { screenHash, setPixel, getPixel } from '../src/io/screen.ts';
import { createHash } from 'node:crypto';

test('汇编器锚点：课程规范已知编码', () => {
  assert.equal(cInst('A', 'D'), 0xec10); // D=A
  assert.equal(cInst('M', 'D'), 0xfc10); // D=M
  assert.equal(cInst('D', 'M'), 0xe308); // M=D
  assert.equal(cInst('D', '', 'JGT'), 0xe301); // D;JGT
  assert.equal(cInst('0', '', 'JMP'), 0xea87); // 0;JMP
  assert.equal(cInst('M', 'A'), 0xfc20); // A=M
  assert.equal(cInst('-1', 'M'), 0xee88); // M=-1
  assert.equal(cInst('D', '', 'JNE'), 0xe305); // D;JNE
  assert.equal(aInst(5), 0x0005);
  assert.equal(aInst(0x4000), 0x4000);
});

test('Computer 冒烟：RAM[16] = 5 + 3', () => {
  const comp = new Computer();
  comp.loadRom([
    aInst(5), cInst('A', 'D'), // D=5
    aInst(3), cInst('D+A', 'D'), // D=8
    aInst(16), cInst('D', 'M'), // RAM[16]=D
  ]);
  const r0 = comp.step(1); // reset 周期
  assert.equal(r0.pc, 0);
  assert.equal(r0.writeM, 0);
  for (let i = 0; i < 6; i++) comp.step(0);
  assert.equal(comp.mem.ram[16], 8);
  const last = comp.cycles; // 7
  assert.equal(last, 7);
});

test('Computer 冒烟：沿前可观测值时序', () => {
  const comp = new Computer();
  comp.loadRom([aInst(16), cInst('-1', 'M')]);
  comp.step(1); // @16（reset 期间）
  const r2 = comp.step(0); // @16 第二次：pc=0, a=16
  assert.equal(r2.pc, 0);
  assert.equal(r2.a, 16);
  assert.equal(r2.addressM, 16);
  const r3 = comp.step(0); // M=-1
  assert.equal(r3.pc, 1);
  assert.equal(r3.outM, 0xffff);
  assert.equal(r3.writeM, 1);
  assert.equal(comp.mem.ram[16], 0xffff); // RAM[16]（屏幕基址是 0x4000，此处仍是 RAM）
});

test('Computer 冒烟：越界读 0 / 写忽略 / KBD 只读', () => {
  const comp = new Computer();
  comp.loadRom([
    aInst(24577), cInst('1', 'M'), // 0x6001 写忽略
    cInst('M', 'D'), // D = 读 0x6001 → 0
    aInst(20), cInst('D', 'M'), // RAM[20] = 0
    aInst(5), cInst('A', 'D'), // D=5
    aInst(0x6000), cInst('D', 'M'), // 写 KBD 忽略
    aInst(21), cInst('D', 'M'), // RAM[21] = 5
    aInst(0x6000), cInst('M', 'D'), // D = KBD = 0
    aInst(22), cInst('D', 'M'), // RAM[22] = 0
  ]);
  comp.step(1);
  for (let i = 0; i < 14; i++) comp.step(0);
  assert.equal(comp.mem.ram[20], 0);
  assert.equal(comp.mem.ram[21], 5);
  assert.equal(comp.mem.ram[22], 0);
  assert.equal(comp.mem.kbd, 0);
});

test('oracle 与门级一致：add + 跳转 + KBD 程序', () => {
  const rom = [
    aInst(5), cInst('A', 'D'), aInst(3), cInst('D+A', 'D'),
    aInst(16), cInst('D', 'M'),
    aInst(0x6000), cInst('M', 'D'), // D=KBD
    aInst(0x4000), cInst('D', 'M'), // 屏幕首字 = KBD
    aInst(0), cInst('0', '', 'JMP'),
  ];
  const gate = new Computer();
  const ref = new HackOracle();
  gate.loadRom(rom);
  ref.loadRom(rom);
  gate.setKeyboard(65);
  ref.setKeyboard(65);
  for (let n = 0; n < 30; n++) {
    const g = gate.step(0);
    const o = ref.step(0);
    assert.equal(g.pc, o.pc, `cycle ${n} pc`);
    assert.equal(g.a, o.a, `cycle ${n} a`);
    assert.equal(g.d, o.d, `cycle ${n} d`);
    assert.equal(g.addressM, o.addressM, `cycle ${n} addressM`);
    assert.equal(g.writeM, o.writeM, `cycle ${n} writeM`);
    if (o.outM !== null) assert.equal(g.outM, o.outM, `cycle ${n} outM`);
  }
  assert.equal(gate.mem.screen[0], 65);
  assert.equal(ref.mem.screen[0], 65);
});

test('hackfile 往返与严格性', () => {
  const words = [0x0005, 0xec10, 0xffff, 0x8000];
  const text = toHackText(words);
  assert.deepEqual(parseHack(text), words);
  assert.throws(() => parseHack('111\n0000000000000000'));
  assert.throws(() => parseHack('000000000000000o'));
});

test('输入脚本解析与调度语义', () => {
  const events = parseInputScript('10 65\n10 66\n20 0\n# 注释\n\n');
  assert.deepEqual(events, [
    { cycle: 10, keycode: 65 },
    { cycle: 10, keycode: 66 },
    { cycle: 20, keycode: 0 },
  ]);
  assert.throws(() => parseInputScript('20 1\n10 2'));
  const drv = new KeyboardDriver(events);
  const seen: number[] = [];
  for (let c = 0; c <= 21; c++) drv.apply(c, (v) => seen[c] = v);
  assert.equal(seen[9], 0);
  assert.equal(seen[10], 66); // 同周期多行取靠后者（GOLDEN.md 语义）
  assert.equal(seen[19], 66);
  assert.equal(seen[20], 0);
  assert.equal(seen[21], 0);
});

test('屏幕哈希与像素映射', () => {
  const words = new Uint16Array(8192);
  const zero = createHash('sha256').update(Buffer.alloc(16384)).digest('hex');
  assert.equal(screenHash(words), zero);
  setPixel(words, 0, 0, true); // bit15 → 0x8000
  assert.equal(words[0], 0x8000);
  assert.equal(getPixel(words, 0, 0), 1);
  setPixel(words, 15, 0, true); // bit0
  assert.equal(words[0], 0x8001);
  setPixel(words, 16, 1, true); // y=1 行、x=16 → 字 32+1=33，bit15
  assert.equal(words[33], 0x8000);
  assert.equal(words[32], 0);
  assert.equal(getPixel(words, 511, 255), 0);
  setPixel(words, 511, 255, true);
  assert.equal(words[8191], 1);
});
