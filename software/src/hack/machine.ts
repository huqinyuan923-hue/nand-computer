/**
 * Behavioral Hack ISA interpreter — the validation oracle for the whole track.
 *
 * Cycle semantics (matches the standard Hack CPU, 1 instruction = 1 clock cycle):
 *  - The instruction fetched at cycle t executes during cycle t; its register/memory
 *    effects are complete when cycle t ends.
 *  - The keyboard register holds the keycode of the last input-script entry whose
 *    cycle <= t (monotone); the program sees that value when reading 0x6000 at cycle t.
 *  - A C-instruction evaluates comp from the OLD A/D/M values; dest writes and the PC
 *    update land at the end of the cycle. A jump loads the OLD A register value into
 *    the PC (the A register receives the comp result on the same clock edge).
 *  - Memory map per SPEC: RAM 0x0000-0x3FFF, Screen 0x4000-0x5FFF, Keyboard 0x6000
 *    (read-only). Out-of-map reads return 0, writes are ignored.
 *  - PC is 15-bit; fetching beyond the program halts the machine.
 */

import { screenSha256 } from "./sha256";

export const RAM_END = 0x4000; // exclusive: RAM words 0x0000..0x3FFF
export const SCREEN_START = 0x4000;
export const SCREEN_END = 0x6000; // exclusive
export const KBD_ADDR = 0x6000;
export const MEM_WORDS = 0x6001; // 0x0000..0x6000

export interface KeyEntry {
  cycle: number;
  key: number; // 0 = key up
}

export interface Checkpoint {
  cycle: number;
  a: number;
  d: number;
  pc: number;
  sp: number;
  screenSha256: string;
}

export interface WatchEvent {
  cycle: number;
  addr: number;
  value: number;
}

export interface RunOptions {
  /** run until this cycle is complete (inclusive); default: until halt */
  until?: number;
  /** safety cap on executed cycles; default 1e9 */
  maxCycles?: number;
  /** keyboard script (non-decreasing cycles) */
  input?: KeyEntry[];
  /** snapshot after completing each of these cycles (dedup + sorted automatically) */
  checkpoints?: number[];
  /** log value changes of these RAM addresses */
  watch?: number[];
}

export interface RunResult {
  checkpoints: Checkpoint[];
  watchEvents: WatchEvent[];
  cyclesExecuted: number;
  halted: boolean;
  haltReason: "end-of-program" | "max-cycles" | "until" | "none";
  finalA: number;
  finalD: number;
  finalPc: number;
}

/** Raw 16-bit memory: one Uint16Array covering 0x0000..0x6000. */
export class HackMachine {
  ram = new Uint16Array(MEM_WORDS);
  a = 0;
  d = 0;
  pc = 0;
  cycle = 0;
  halted = false;
  program: Uint16Array;
  private input: KeyEntry[];
  private inputIdx = 0;
  private currentKey = 0;
  private watch: Set<number>;
  private lastWatchValues: Map<number, number>;
  onWatch: WatchEvent[] = [];

  constructor(program: Uint16Array, opts: { input?: KeyEntry[]; watch?: number[] } = {}) {
    this.program = program;
    this.input = opts.input ?? [];
    this.watch = new Set(opts.watch ?? []);
    this.lastWatchValues = new Map();
    for (const addr of this.watch) this.lastWatchValues.set(addr, 0);
    this.ram[KBD_ADDR] = 0;
  }

  /** Read with SPEC memory map semantics. */
  readMem(addr: number): number {
    if (addr < 0 || addr > 0xffff) return 0;
    if (addr <= 0x6000) return this.ram[addr];
    return 0;
  }

  /** Write with SPEC memory map semantics (keyboard read-only, out-of-map ignored). */
  writeMem(addr: number, value: number): void {
    if (addr < 0 || addr > 0xffff) return;
    if (addr === KBD_ADDR) return; // keyboard register is program read-only
    if (addr <= 0x6000) this.ram[addr] = value & 0xffff;
  }

  /** Advance the keyboard register to the value dictated by the script at cycle t. */
  private updateKey(t: number): void {
    while (this.inputIdx < this.input.length && this.input[this.inputIdx].cycle <= t) {
      this.currentKey = this.input[this.inputIdx].key;
      this.inputIdx++;
    }
    this.ram[KBD_ADDR] = this.currentKey & 0xffff;
  }

  /** Execute exactly one instruction (one clock cycle). Returns false when halted. */
  step(): boolean {
    if (this.halted) return false;
    const t = this.cycle;
    this.updateKey(t);
    const pc = this.pc;
    if (pc >= this.program.length) {
      this.halted = true;
      return false;
    }
    const instr = this.program[pc];
    if ((instr & 0x8000) === 0) {
      // A-instruction: A = 15-bit value
      this.a = instr & 0x7fff;
      this.pc = (pc + 1) & 0x7fff;
    } else {
      // C-instruction: 111a cccccc ddd jjj
      const aBit = (instr >> 12) & 1;
      const comp = (instr >> 6) & 0x3f;
      const dest = (instr >> 3) & 0x7;
      const jump = instr & 0x7;
      const aVal = this.a;
      const mVal = aBit ? this.readMem(aVal) : aVal;
      const d = this.d;
      let out: number;
      switch (comp) {
        case 0b101010: out = 0; break; // 0
        case 0b111111: out = 1; break; // 1
        case 0b111010: out = 0xffff; break; // -1
        case 0b001100: out = d; break; // D
        case 0b110000: out = mVal; break; // A / M
        case 0b001101: out = ~d & 0xffff; break; // !D
        case 0b110001: out = ~mVal & 0xffff; break; // !A / !M
        case 0b001111: out = -d & 0xffff; break; // -D
        case 0b110011: out = -mVal & 0xffff; break; // -A / -M
        case 0b011111: out = (d + 1) & 0xffff; break; // D+1
        case 0b110111: out = (mVal + 1) & 0xffff; break; // A+1 / M+1
        case 0b001110: out = (d - 1) & 0xffff; break; // D-1
        case 0b110010: out = (mVal - 1) & 0xffff; break; // A-1 / M-1
        case 0b000010: out = (d + mVal) & 0xffff; break; // D+A / D+M
        case 0b010011: out = (d - mVal) & 0xffff; break; // D-A / D-M
        case 0b000111: out = (mVal - d) & 0xffff; break; // A-D / M-D
        case 0b000000: out = d & mVal; break; // D&A / D&M
        case 0b010101: out = d | mVal; break; // D|A / D|M
        default:
          // undefined comp encoding: treat as 0 (matches &-of-nothing behavior)
          out = 0;
          break;
      }
      // dest writes (M write uses OLD A as address)
      if (dest & 0b100) this.a = out;
      if (dest & 0b010) this.d = out;
      if (dest & 0b001) this.writeMem(aVal, out);
      // jump loads the OLD A value (A register latches comp on the same edge)
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
    // watch reporting: value visible after the cycle completed
    if (this.watch.size > 0) {
      for (const addr of this.watch) {
        const v = this.ram[addr];
        if (this.lastWatchValues.get(addr) !== v) {
          this.lastWatchValues.set(addr, v);
          this.onWatch.push({ cycle: t, addr, value: v });
        }
      }
    }
    return true;
  }

  screenSha256(): string {
    return screenSha256(this.ram.subarray(SCREEN_START, SCREEN_END));
  }

  snapshot(): Checkpoint {
    return {
      cycle: this.cycle,
      a: this.a,
      d: this.d,
      pc: this.pc,
      sp: this.ram[0],
      screenSha256: this.screenSha256(),
    };
  }

  /** Render the screen as ASCII ('#'/'.'): 64x32 grid of 8x8-pixel blocks. */
  screenAscii(): string {
    let out = "";
    for (let by = 0; by < 32; by++) {
      for (let bx = 0; bx < 64; bx++) {
        let any = false;
        outer:
        for (let py = 0; py < 8; py++) {
          const word = this.ram[SCREEN_START + (by * 8 + py) * 32 + (bx >> 1)];
          const v = (bx & 1) === 0 ? (word >>> 8) & 0xff : word & 0xff;
          if (v !== 0) {
            any = true;
            break outer;
          }
        }
        out += any ? "#" : ".";
      }
      out += "\n";
    }
    return out;
  }

  /**
   * Run per RunOptions. Checkpoint semantics: the snapshot for cycle c is taken
   * AFTER the instruction fetched at cycle c has fully completed. The run stops
   * when: until/maxCycles reached (cycle N inclusive), the last checkpoint fired,
   * or the PC runs off the program.
   */
  run(opts: RunOptions = {}): RunResult {
    const maxCycles = opts.maxCycles ?? 1_000_000_000;
    const until = opts.until ?? Number.MAX_SAFE_INTEGER;
    // full keyboard script must be available even if run() is called repeatedly
    if (opts.input && opts.input !== this.input) {
      this.input = opts.input;
      this.inputIdx = 0;
    }
    const cpCycles = [...new Set(opts.checkpoints ?? [])].sort((x, y) => x - y);
    const checkpoints: Checkpoint[] = [];
    const lastCp = cpCycles.length > 0 ? cpCycles[cpCycles.length - 1] : Number.MAX_SAFE_INTEGER;
    const stopCycle = Math.min(until, lastCp, maxCycles);
    let haltReason: RunResult["haltReason"] =
      stopCycle >= maxCycles ? "max-cycles" : "until";

    let cpIdx = 0;
    const fire = (cycle: number): void => {
      const snap = this.snapshot();
      snap.cycle = cycle;
      checkpoints.push(snap);
    };
    // checkpoints for cycles already completed by earlier runs
    while (cpIdx < cpCycles.length && cpCycles[cpIdx] < this.cycle) {
      fire(cpCycles[cpIdx]);
      cpIdx++;
    }

    while (this.cycle <= stopCycle) {
      if (!this.step()) {
        haltReason = "end-of-program";
        break;
      }
      // instructions at cycles 0..this.cycle-1 have completed; fire due checkpoints
      while (cpIdx < cpCycles.length && cpCycles[cpIdx] < this.cycle) {
        fire(cpCycles[cpIdx]);
        cpIdx++;
      }
    }

    return {
      checkpoints,
      watchEvents: this.onWatch,
      cyclesExecuted: this.cycle,
      halted: this.halted,
      haltReason: this.halted ? "end-of-program" : haltReason,
      finalA: this.a,
      finalD: this.d,
      finalPc: this.pc,
    };
  }
}

/** Parse a keyboard input script: lines "cycle keycode" (decimal, non-decreasing). */
export function parseInputScript(text: string): KeyEntry[] {
  const entries: KeyEntry[] = [];
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
