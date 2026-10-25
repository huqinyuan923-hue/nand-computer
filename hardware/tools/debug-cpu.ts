// 调试：逐周期打印 add 程序的门级 vs oracle 记录。

import { Computer } from '../src/chips/computer.ts';
import { HackOracle } from '../src/oracle/hack.ts';
import { aInst, cInst, toBin16 } from '../src/dev/asm.ts';

const rom = [
  aInst(5), cInst('A', 'D'),
  aInst(3), cInst('D+A', 'D'),
  aInst(16), cInst('D', 'M'),
];
console.log('rom:', rom.map(toBin16));

const gate = new Computer();
const ref = new HackOracle();
gate.loadRom(rom);
ref.loadRom(rom);

for (let n = 0; n < 7; n++) {
  const reset = n === 0 ? 1 : 0;
  const g = gate.step(reset as 0 | 1);
  const o = ref.step(reset as 0 | 1);
  console.log(
    `n=${n} reset=${reset} gate={pc:${g.pc} a:${g.a} d:${g.d} addrM:${g.addressM} outM:${g.outM} wM:${g.writeM}}`,
    `oracle={pc:${o.pc} a:${o.a} d:${o.d} addrM:${o.addressM} outM:${o.outM} wM:${o.writeM}}`,
  );
}
console.log('RAM[16] gate =', gate.mem.ram[16], ' oracle =', ref.mem.ram[16]);
