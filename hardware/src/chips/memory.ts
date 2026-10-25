// 行为级 Memory（M5，官方课程同款豁免）：RAM16K + Screen 8K + Keyboard。
// 地址语义按 SPEC：RAM 0x0000–0x3FFF；Screen 0x4000–0x5FFF；KBD 0x6000。
// 越界读得 0，写忽略（含对 KBD 的写）。

export const RAM_END = 0x4000;
export const SCREEN_BASE = 0x4000;
export const SCREEN_WORDS = 0x2000;
export const KBD_ADDR = 0x6000;

export class Memory {
  readonly ram = new Uint16Array(RAM_END);
  readonly screen = new Uint16Array(SCREEN_WORDS);
  kbd = 0;

  read(addr: number): number {
    addr &= 0x7fff;
    if (addr < RAM_END) return this.ram[addr];
    if (addr < SCREEN_BASE + SCREEN_WORDS) return this.screen[addr - SCREEN_BASE];
    if (addr === KBD_ADDR) return this.kbd;
    return 0;
  }

  write(addr: number, v: number): void {
    addr &= 0x7fff;
    v &= 0xffff;
    if (addr < RAM_END) this.ram[addr] = v;
    else if (addr < SCREEN_BASE + SCREEN_WORDS) this.screen[addr - SCREEN_BASE] = v;
    // KBD（0x6000）与越界地址：写忽略
  }

  clear(): void {
    this.ram.fill(0);
    this.screen.fill(0);
    this.kbd = 0;
  }
}
