// 生成内置 demo（键盘条）的 .hack 二进制：npm run gen:demo
// 程序：屏幕首行 32 个字实时显示 KBD 键值；循环顶检查避免越行写入。

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aInst, cInst, toBin16 } from '../src/dev/asm.ts';

const here = dirname(fileURLToPath(import.meta.url));

// 地址布局：
//   0-3   初始化 ptr=16384
//   4-22  主循环（顶检查 ptr==16416 → 重启段；D=kbd → A=ptr → RAM[ptr]=kbd → ptr++）
//   23-29 填充
//   30-35 重启段（ptr=16384 → 回主循环）
const prog: number[] = [];
const emit = (...insts: number[]) => prog.push(...insts);

emit(aInst(16384), cInst('A', 'D'), aInst(0), cInst('D', 'M')); // 0-3
emit(aInst(0), cInst('M', 'D'), aInst(16416), cInst('D-A', 'D'), aInst(30), cInst('D', '', 'JEQ')); // 4-9
emit(aInst(24576), cInst('M', 'D')); // 10-11: D = KBD
emit(aInst(0), cInst('M', 'A')); // 12-13: A = ptr（D 保持）
emit(cInst('D', 'M')); // 14: RAM[ptr] = kbd
emit(aInst(0), cInst('M', 'D'), aInst(1), cInst('D+A', 'D'), aInst(0), cInst('D', 'M')); // 15-20: ptr++
emit(aInst(4), cInst('0', '', 'JMP')); // 21-22
emit(aInst(0), aInst(0), aInst(0), aInst(0), aInst(0), aInst(0), aInst(0)); // 23-29 填充
emit(aInst(16384), cInst('A', 'D'), aInst(0), cInst('D', 'M'), aInst(4), cInst('0', '', 'JMP')); // 30-35

if (prog.length !== 36) throw new Error(`demo 程序长度异常: ${prog.length}`);

const text = prog.map(toBin16).join('\n') + '\n';
writeFileSync(join(here, '..', 'web', 'demo-kbdbar.hack'), text);
console.log(text);
