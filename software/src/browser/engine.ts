/**
 * Self-contained behavioral Hack core for the browser demo.
 *
 * Mirrors src/hack/machine.ts (the validation oracle) exactly: 1 instruction =
 * 1 clock cycle, old-A jump semantics, SPEC memory map (RAM/Screen/Keyboard,
 * keyboard read-only, out-of-map reads 0 / writes ignored). Import-free and
 * DOM-free so tsconfig.demo.json can emit a plain ES module and node:test can
 * cross-check it against the oracle on the golden Tetris run.
 */

export const SCREEN_START = 0x4000;
export const SCREEN_END = 0x6000;
export const KBD_ADDR = 0x6000;
export const MEM_WORDS = 0x6001;

export interface ScriptEntry {
  cycle: number;
  key: number; // 0 = key up
}

export class HackCore {
  readonly ram = new Uint16Array(MEM_WORDS);
  readonly rom: Uint16Array;
  a = 0;
  d = 0;
  pc = 0;
  cycle = 0;
  halted = false;
  private script: ScriptEntry[] = [];
  private scriptIdx = 0;
  private key = 0;

  constructor(rom: Uint16Array) {
    this.rom = rom;
    this.ram[KBD_ADDR] = 0;
  }

  /** Live keyboard (play mode); scripted keys win while a script is loaded. */
  setKey(key: number): void {
    this.key = key & 0xffff;
  }

  loadScript(entries: ScriptEntry[]): void {
    this.script = entries;
    this.scriptIdx = 0;
  }

  clearScript(): void {
    this.script = [];
    this.scriptIdx = 0;
  }

  readMem(addr: number): number {
    if (addr < 0 || addr > 0xffff) return 0;
    if (addr <= 0x6000) return this.ram[addr];
    return 0;
  }

  writeMem(addr: number, value: number): void {
    if (addr < 0 || addr > 0xffff) return;
    if (addr === KBD_ADDR) return; // keyboard register is program read-only
    if (addr <= 0x6000) this.ram[addr] = value & 0xffff;
  }

  private updateKey(t: number): void {
    while (this.scriptIdx < this.script.length && this.script[this.scriptIdx].cycle <= t) {
      this.key = this.script[this.scriptIdx].key;
      this.scriptIdx++;
    }
    this.ram[KBD_ADDR] = this.key & 0xffff;
  }

  /** Execute exactly one instruction (one clock cycle). Returns false when halted. */
  step(): boolean {
    if (this.halted) return false;
    const t = this.cycle;
    this.updateKey(t);
    const pc = this.pc;
    if (pc >= this.rom.length) {
      this.halted = true;
      return false;
    }
    const instr = this.rom[pc];
    if ((instr & 0x8000) === 0) {
      this.a = instr & 0x7fff;
      this.pc = (pc + 1) & 0x7fff;
    } else {
      const aBit = (instr >> 12) & 1;
      const comp = (instr >> 6) & 0x3f;
      const dest = (instr >> 3) & 0x7;
      const jump = instr & 0x7;
      const aVal = this.a;
      const mVal = aBit ? this.readMem(aVal) : aVal;
      const d = this.d;
      let out: number;
      switch (comp) {
        case 0b101010: out = 0; break;
        case 0b111111: out = 1; break;
        case 0b111010: out = 0xffff; break;
        case 0b001100: out = d; break;
        case 0b110000: out = mVal; break;
        case 0b001101: out = ~d & 0xffff; break;
        case 0b110001: out = ~mVal & 0xffff; break;
        case 0b001111: out = -d & 0xffff; break;
        case 0b110011: out = -mVal & 0xffff; break;
        case 0b011111: out = (d + 1) & 0xffff; break;
        case 0b110111: out = (mVal + 1) & 0xffff; break;
        case 0b001110: out = (d - 1) & 0xffff; break;
        case 0b110010: out = (mVal - 1) & 0xffff; break;
        case 0b000010: out = (d + mVal) & 0xffff; break;
        case 0b010011: out = (d - mVal) & 0xffff; break;
        case 0b000111: out = (mVal - d) & 0xffff; break;
        case 0b000000: out = d & mVal; break;
        case 0b010101: out = d | mVal; break;
        default: out = 0; break;
      }
      if (dest & 0b100) this.a = out;
      if (dest & 0b010) this.d = out;
      if (dest & 0b001) this.writeMem(aVal, out);
      let jumped = false;
      if (jump !== 0) {
        const sOut = out > 0x7fff ? out - 0x10000 : out;
        const take =
          (jump & 0b001 && sOut > 0) ||
          (jump & 0b010 && sOut === 0) ||
          (jump & 0b100 && sOut < 0);
        if (take) {
          this.pc = aVal & 0x7fff;
          jumped = true;
        }
      }
      if (!jumped) this.pc = (pc + 1) & 0x7fff;
    }
    this.cycle = t + 1;
    return true;
  }

  /**
   * Execute up to `cycles` instructions; stops early when the program halts.
   * Locals-based copy of step() because this is the demo's hot path.
   */
  run(cycles: number): void {
    const rom = this.rom;
    const ram = this.ram;
    const script = this.script;
    let scriptIdx = this.scriptIdx;
    let key = this.key;
    let a = this.a;
    let d = this.d;
    let pc = this.pc;
    let cycle = this.cycle;
    let halted = this.halted;
    const stopCycle = cycle + cycles;
    while (cycle < stopCycle) {
      if (halted) break;
      const t = cycle;
      while (scriptIdx < script.length && script[scriptIdx].cycle <= t) {
        key = script[scriptIdx].key;
        scriptIdx++;
      }
      ram[KBD_ADDR] = key & 0xffff;
      if (pc >= rom.length) {
        halted = true;
        break;
      }
      const instr = rom[pc];
      if ((instr & 0x8000) === 0) {
        a = instr & 0x7fff;
        pc = (pc + 1) & 0x7fff;
      } else {
        const aVal = a;
        const mVal = (instr >> 12) & 1 ? (aVal <= KBD_ADDR ? ram[aVal] : 0) : aVal;
        const dest = (instr >> 3) & 0x7;
        let out: number;
        switch ((instr >> 6) & 0x3f) {
          case 0b101010: out = 0; break;
          case 0b111111: out = 1; break;
          case 0b111010: out = 0xffff; break;
          case 0b001100: out = d; break;
          case 0b110000: out = mVal; break;
          case 0b001101: out = ~d & 0xffff; break;
          case 0b110001: out = ~mVal & 0xffff; break;
          case 0b001111: out = -d & 0xffff; break;
          case 0b110011: out = -mVal & 0xffff; break;
          case 0b011111: out = (d + 1) & 0xffff; break;
          case 0b110111: out = (mVal + 1) & 0xffff; break;
          case 0b001110: out = (d - 1) & 0xffff; break;
          case 0b110010: out = (mVal - 1) & 0xffff; break;
          case 0b000010: out = (d + mVal) & 0xffff; break;
          case 0b010011: out = (d - mVal) & 0xffff; break;
          case 0b000111: out = (mVal - d) & 0xffff; break;
          case 0b000000: out = d & mVal; break;
          case 0b010101: out = d | mVal; break;
          default: out = 0; break;
        }
        if (dest & 0b100) a = out;
        if (dest & 0b010) d = out;
        if (dest & 0b001 && aVal < KBD_ADDR) ram[aVal] = out;
        let nextPc = (pc + 1) & 0x7fff;
        const jump = instr & 0x7;
        if (jump !== 0) {
          const sOut = out > 0x7fff ? out - 0x10000 : out;
          if (
            (jump & 0b001 && sOut > 0) ||
            (jump & 0b010 && sOut === 0) ||
            (jump & 0b100 && sOut < 0)
          ) {
            nextPc = aVal & 0x7fff;
          }
        }
        pc = nextPc;
      }
      cycle = t + 1;
    }
    this.a = a;
    this.d = d;
    this.pc = pc;
    this.cycle = cycle;
    this.halted = halted;
    this.scriptIdx = scriptIdx;
    this.key = key;
  }
}

/** Parse a SPEC .hack file (one 16-bit binary word per line). */
export function parseHackText(text: string): Uint16Array {
  const words: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("//")[0].trim();
    if (line.length === 0) continue;
    if (!/^[01]{16}$/.test(line)) throw new Error(`bad .hack line: "${raw}"`);
    words.push(parseInt(line, 2));
  }
  return Uint16Array.from(words);
}

/** Parse a SPEC input script (lines "cycle keycode", cycles non-decreasing). */
export function parseScriptText(text: string): ScriptEntry[] {
  const entries: ScriptEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("//")[0].trim();
    if (line.length === 0) continue;
    const m = line.match(/^(\d+)\s+(\d+)$/);
    if (!m) throw new Error(`bad input script line: "${raw}"`);
    entries.push({ cycle: parseInt(m[1], 10), key: parseInt(m[2], 10) });
  }
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].cycle < entries[i - 1].cycle) {
      throw new Error(`input script not non-decreasing at line ${i + 1}`);
    }
  }
  return entries;
}
