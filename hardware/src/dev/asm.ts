// 测试/工具用迷你汇编器：只服务于黄金定向程序与基准程序的手写汇编。
// 正式汇编器/编译器属于软件轨（software/），两边仅以 .hack 二进制与 SPEC 交接。
// 编码表 = 标准 Hack 规范（C 指令 111a cccccc ddd jjj）。

const COMP: Record<string, [number, number]> = {
  //      a    cccccc
  '0': [0, 0b101010], '1': [0, 0b111111], '-1': [0, 0b111010],
  D: [0, 0b001100], A: [0, 0b110000], '!D': [0, 0b001101], '!A': [0, 0b110001],
  '-D': [0, 0b001111], '-A': [0, 0b110011], 'D+1': [0, 0b011111], 'A+1': [0, 0b110111],
  'D-1': [0, 0b001110], 'A-1': [0, 0b110010], 'D+A': [0, 0b000010], 'D-A': [0, 0b010011],
  'A-D': [0, 0b000111], 'D&A': [0, 0b000000], 'D|A': [0, 0b010101],
  M: [1, 0b110000], '!M': [1, 0b110001], '-M': [1, 0b110011],
  'M+1': [1, 0b110111], 'M-1': [1, 0b110010], 'D+M': [1, 0b000010],
  'D-M': [1, 0b010011], 'M-D': [1, 0b000111], 'D&M': [1, 0b000000], 'D|M': [1, 0b010101],
};

// ddd = d1(A)d2(D)d3(M)，写入指令位 3/4/5
const DEST: Record<string, number> = {
  '': 0b000, M: 0b001, D: 0b010, MD: 0b011, A: 0b100, AM: 0b101, AD: 0b110, AMD: 0b111,
};

// jjj：JGT=001 JEQ=010 JGE=011 JLT=100 JNE=101 JLE=110 JMP=111
const JUMP: Record<string, number> = {
  '': 0b000, JGT: 0b001, JEQ: 0b010, JGE: 0b011, JLT: 0b100, JNE: 0b101, JLE: 0b110, JMP: 0b111,
};

export function aInst(v: number): number {
  if (!Number.isInteger(v) || v < 0 || v > 0x7fff) throw new Error(`@地址越界: ${v}`);
  return v;
}

export function cInst(comp: string, dest = '', jump = ''): number {
  const ca = COMP[comp];
  const d = DEST[dest];
  const j = JUMP[jump];
  if (ca === undefined || d === undefined || j === undefined) {
    throw new Error(`非法指令: comp=${comp} dest=${dest} jump=${jump}`);
  }
  return 0xe000 | (ca[0] << 12) | (ca[1] << 6) | (d << 3) | j;
}

export function toBin16(v: number): string {
  return (v & 0xffff).toString(2).padStart(16, '0');
}
