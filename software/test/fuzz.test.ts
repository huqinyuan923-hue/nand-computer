/**
 * Seeded randomized differential checks (1000 cases).
 *
 * 1. 500 random Hack programs: step() (reference) vs run() (fast local loop) vs
 *    the browser HackCore, with scripted keyboard input, watch addresses and
 *    checkpoints compared against the stepped oracle.
 * 2. 400 random VM expressions: translated + assembled + executed, result
 *    compared with a plain JS 16-bit oracle.
 * 3. 100 random assembler inputs with forward/backward labels and predefined
 *    symbols, compared with an independent spec encoder.
 *
 * All randomness comes from a fixed mulberry32 seed, so failures reproduce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../src/hack/asm";
import { HackMachine, type KeyEntry } from "../src/hack/machine";
import { HackCore } from "../src/browser/engine";
import { parseVm } from "../src/vm/parse";
import { translateVm } from "../src/vm/translate";

const KBD = 0x6000;
const s16 = (v: number): number => (v > 0x7fff ? v - 0x10000 : v);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(r: () => number, n: number): number {
  return Math.floor(r() * n);
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[randInt(r, arr.length)];
}

interface Regs {
  a: number;
  d: number;
  pc: number;
  cycle: number;
  halted: boolean;
}

function regs(m: { a: number; d: number; pc: number; cycle: number; halted: boolean }): Regs {
  return { a: m.a, d: m.d, pc: m.pc, cycle: m.cycle, halted: m.halted };
}

function ramBuffer(ram: Uint16Array): Buffer {
  return Buffer.from(ram.buffer, ram.byteOffset, ram.byteLength);
}

function firstRamDiff(a: Uint16Array, b: Uint16Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function assertSameRegs(actual: Regs, expected: Regs, label: string): void {
  assert.deepEqual(actual, expected, `${label}: registers`);
}

function assertSameRam(actual: Uint16Array, expected: Uint16Array, label: string): void {
  if (Buffer.compare(ramBuffer(actual), ramBuffer(expected)) === 0) return;
  const at = firstRamDiff(actual, expected);
  assert.fail(`${label}: RAM differs at ${at}: got ${actual[at]} want ${expected[at]}`);
}

const COMP_CODES: readonly number[] = [
  0b101010, 0b111111, 0b111010, 0b001100, 0b110000, 0b001101, 0b110001,
  0b001111, 0b110011, 0b011111, 0b110111, 0b001110, 0b110010, 0b000010,
  0b010011, 0b000111, 0b000000, 0b010101,
];

/** Random but mostly executable program: small A values hit RAM/registers. */
function randomProgram(r: () => number): Uint16Array {
  const len = 4 + randInt(r, 27);
  const words = new Uint16Array(len);
  const small = (): number => {
    const roll = r();
    if (roll < 0.55) return randInt(r, 48);
    if (roll < 0.7) return pick(r, [KBD, KBD + 1, 0x3fff, 0x4000, 0x5fff, 0x7fff, len - 1]);
    return randInt(r, 0x8000);
  };
  for (let i = 0; i < len; i++) {
    if (r() < 0.38) {
      words[i] = small(); // A-instruction
    } else {
      const comp = r() < 0.9 ? pick(r, COMP_CODES) : randInt(r, 64);
      const dest = randInt(r, 8);
      const jump = randInt(r, 8);
      words[i] = 0xe000 | (randInt(r, 2) << 12) | (comp << 6) | (dest << 3) | jump;
    }
  }
  return words;
}

interface OracleSnap {
  a: number;
  d: number;
  pc: number;
  sp: number;
  sha: string;
}

test("fuzz 500: random ISA programs agree across step(), run() and HackCore", () => {
  const r = mulberry32(0x5eed0001);
  const keyPool = [0, 37, 38, 39, 40, 65, 0xffff];
  for (let caseIdx = 0; caseIdx < 500; caseIdx++) {
    const rom = randomProgram(r);
    const n = 20 + randInt(r, 2980);
    const input: KeyEntry[] = [];
    for (let cyc = randInt(r, 10); cyc < n; cyc += 1 + randInt(r, 200)) {
      input.push({ cycle: cyc, key: pick(r, keyPool) });
    }
    const watch = [...new Set([randInt(r, 48), KBD, 0x4000 + randInt(r, 8192)])];
    const cpSet = new Set<number>();
    const cpCount = 1 + randInt(r, 4);
    for (let i = 0; i < cpCount; i++) cpSet.add(randInt(r, n + 1));
    const cpList = [...cpSet].sort((x, y) => x - y);

    // Stepped oracle: one instruction per step, no fast-path code.
    const oracle = new HackMachine(rom, { input, watch });
    const snaps = new Map<number, OracleSnap>();
    for (let s = 0; s < n + 1; s++) {
      if (oracle.halted) break;
      oracle.step();
      const done = oracle.cycle - 1;
      if (cpSet.has(done) && !snaps.has(done)) {
        snaps.set(done, {
          a: oracle.a, d: oracle.d, pc: oracle.pc, sp: oracle.ram[0],
          sha: oracle.screenSha256(),
        });
      }
    }

    const fast = new HackMachine(rom, { input, watch });
    const res = fast.run({ until: n, checkpoints: cpList });
    // run() stops at the last checkpoint; resume to the same horizon as the oracle.
    if (!fast.halted && fast.cycle <= n) fast.run({ until: n });
    const tag = `case ${caseIdx} (len=${rom.length}, n=${n})`;
    assertSameRegs(regs(fast), regs(oracle), tag);
    assertSameRam(fast.ram, oracle.ram, tag);
    assert.deepEqual(fast.onWatch, oracle.onWatch, `${tag}: watch events`);
    assert.equal(res.checkpoints.length, snaps.size, `${tag}: checkpoint count`);

    for (const cp of res.checkpoints) {
      const want = snaps.get(cp.cycle);
      assert.ok(want !== undefined, `${tag}: unexpected checkpoint ${cp.cycle}`);
      assert.equal(cp.a, want.a, `${tag}: cp ${cp.cycle} A`);
      assert.equal(cp.d, want.d, `${tag}: cp ${cp.cycle} D`);
      assert.equal(cp.pc, want.pc, `${tag}: cp ${cp.cycle} PC`);
      assert.equal(cp.sp, want.sp, `${tag}: cp ${cp.cycle} SP`);
      assert.equal(cp.screenSha256, want.sha, `${tag}: cp ${cp.cycle} screen`);
    }

    const core = new HackCore(rom);
    core.loadScript(input.map((e) => ({ cycle: e.cycle, key: e.key })));
    core.run(n + 1);
    assertSameRegs(regs(core), regs(oracle), `${tag}: HackCore`);
    assertSameRam(core.ram, oracle.ram, `${tag}: HackCore`);
  }
});

interface Expr {
  lines: string[];
  value: number;
}

function randomVmExpr(r: () => number, depth: number): Expr {
  if (depth === 0 || r() < 0.25) {
    const k = randInt(r, 0x8000);
    return { lines: [`push constant ${k}`], value: k };
  }
  const kind = randInt(r, 9);
  if (kind < 2) {
    const e = randomVmExpr(r, depth - 1);
    return kind === 0
      ? { lines: [...e.lines, "neg"], value: -e.value & 0xffff }
      : { lines: [...e.lines, "not"], value: ~e.value & 0xffff };
  }
  const a = randomVmExpr(r, depth - 1);
  const b = randomVmExpr(r, depth - 1);
  let value: number;
  let op: string;
  // gt/lt follow the reference translator (and nand2tetris): signed test on the
  // wrapped 16-bit x-y. This differs from mathematical x>y only when the
  // subtraction itself overflows (opposite signs, |x-y| >= 32768); the ROM
  // budget rules out the overflow-safe inline expansion. See translate.ts.
  const diff = (a.value - b.value) & 0xffff;
  switch (kind) {
    case 2: op = "add"; value = (a.value + b.value) & 0xffff; break;
    case 3: op = "sub"; value = diff; break;
    case 4: op = "and"; value = a.value & b.value; break;
    case 5: op = "or"; value = a.value | b.value; break;
    case 6: op = "eq"; value = a.value === b.value ? 0xffff : 0; break;
    case 7: op = "gt"; value = s16(diff) > 0 ? 0xffff : 0; break;
    default: op = "lt"; value = s16(diff) < 0 ? 0xffff : 0; break;
  }
  return { lines: [...a.lines, ...b.lines, op], value };
}

test("fuzz 400: translated VM expressions match a JS 16-bit oracle", () => {
  const r = mulberry32(0x5eed0002);
  for (let caseIdx = 0; caseIdx < 400; caseIdx++) {
    const expr = randomVmExpr(r, 1 + randInt(r, 4));
    const parsed = parseVm(expr.lines.join("\n"));
    assert.deepEqual(parsed.errors, [], `case ${caseIdx}: parse`);
    const body = translateVm(parsed.commands, { module: "Fuzz" });
    const text = "@256\nD=A\n@SP\nM=D\n" + body + "(VMHALT)\n@VMHALT\n0;JMP\n";
    const built = assemble(text);
    assert.deepEqual(built.errors, [], `case ${caseIdx}: assemble`);
    const haltAddr = built.symbols.VMHALT;
    const m = new HackMachine(built.words);
    let steps = 0;
    while (!m.halted && m.pc !== haltAddr && steps < 200000) {
      m.step();
      steps++;
    }
    assert.ok(!m.halted, `case ${caseIdx}: halted unexpectedly`);
    assert.equal(m.pc, haltAddr, `case ${caseIdx}: did not reach VMHALT`);
    assert.equal(m.ram[0], 257, `case ${caseIdx}: SP`);
    assert.equal(
      m.ram[256], expr.value,
      `case ${caseIdx}: ${expr.lines.join("; ")}`,
    );
  }
});

interface CompEntry {
  text: string;
  aBit: number;
  code: number;
}

const COMP_TABLE: readonly CompEntry[] = [
  { text: "0", aBit: 0, code: 0b101010 },
  { text: "1", aBit: 0, code: 0b111111 },
  { text: "-1", aBit: 0, code: 0b111010 },
  { text: "D", aBit: 0, code: 0b001100 },
  { text: "A", aBit: 0, code: 0b110000 },
  { text: "!D", aBit: 0, code: 0b001101 },
  { text: "!A", aBit: 0, code: 0b110001 },
  { text: "-D", aBit: 0, code: 0b001111 },
  { text: "-A", aBit: 0, code: 0b110011 },
  { text: "D+1", aBit: 0, code: 0b011111 },
  { text: "A+1", aBit: 0, code: 0b110111 },
  { text: "D-1", aBit: 0, code: 0b001110 },
  { text: "A-1", aBit: 0, code: 0b110010 },
  { text: "D+A", aBit: 0, code: 0b000010 },
  { text: "D-A", aBit: 0, code: 0b010011 },
  { text: "A-D", aBit: 0, code: 0b000111 },
  { text: "D&A", aBit: 0, code: 0b000000 },
  { text: "D|A", aBit: 0, code: 0b010101 },
  { text: "M", aBit: 1, code: 0b110000 },
  { text: "!M", aBit: 1, code: 0b110001 },
  { text: "-M", aBit: 1, code: 0b110011 },
  { text: "M+1", aBit: 1, code: 0b110111 },
  { text: "M-1", aBit: 1, code: 0b110010 },
  { text: "D+M", aBit: 1, code: 0b000010 },
  { text: "D-M", aBit: 1, code: 0b010011 },
  { text: "M-D", aBit: 1, code: 0b000111 },
  { text: "D&M", aBit: 1, code: 0b000000 },
  { text: "D|M", aBit: 1, code: 0b010101 },
];

const DEST_TABLE: readonly { text: string; bits: number }[] = [
  { text: "", bits: 0 }, { text: "M", bits: 1 }, { text: "D", bits: 2 },
  { text: "MD", bits: 3 }, { text: "A", bits: 4 }, { text: "AM", bits: 5 },
  { text: "AD", bits: 6 }, { text: "AMD", bits: 7 },
];

const JUMP_TABLE: readonly { text: string; bits: number }[] = [
  { text: "", bits: 0 }, { text: "JGT", bits: 1 }, { text: "JEQ", bits: 2 },
  { text: "JGE", bits: 3 }, { text: "JLT", bits: 4 }, { text: "JNE", bits: 5 },
  { text: "JLE", bits: 6 }, { text: "JMP", bits: 7 },
];

const PREDEFINED: Record<string, number> = {
  R0: 0, R1: 1, R3: 3, R7: 7, R15: 15, SP: 0, LCL: 1, ARG: 2, THIS: 3, THAT: 4,
  SCREEN: 0x4000, KBD: 0x6000,
};

test("fuzz 100: assembler matches an independent encoder (labels, symbols)", () => {
  const r = mulberry32(0x5eed0003);
  for (let caseIdx = 0; caseIdx < 100; caseIdx++) {
    const nInstr = 5 + randInt(r, 11);
    const nLabels = 1 + randInt(r, Math.min(5, nInstr));
    const labelAt = new Map<number, string[]>(); // instruction index -> labels defined there
    for (let i = 0; i < nLabels; i++) {
      const at = randInt(r, nInstr);
      const list = labelAt.get(at) ?? [];
      list.push(`L${i}`);
      labelAt.set(at, list);
    }
    const labelAddr = new Map<string, number>();
    for (const [at, names] of labelAt) for (const name of names) labelAddr.set(name, at);

    const lines: string[] = [];
    const expected: number[] = [];
    for (let i = 0; i < nInstr; i++) {
      for (const name of labelAt.get(i) ?? []) lines.push(`(${name})`);
      const kind = randInt(r, 5);
      if (kind === 0) {
        const value = randInt(r, 0x8000);
        lines.push(`@${value}`);
        expected.push(value);
      } else if (kind === 1) {
        const name = pick(r, [...labelAddr.keys()]);
        lines.push(`@${name}`);
        expected.push(labelAddr.get(name) as number);
      } else if (kind === 2) {
        const name = pick(r, Object.keys(PREDEFINED));
        lines.push(`@${name}`);
        expected.push(PREDEFINED[name]);
      } else {
        const comp = pick(r, COMP_TABLE);
        const dest = pick(r, DEST_TABLE);
        const jump = pick(r, JUMP_TABLE);
        if (dest.bits === 0 && jump.bits === 0) {
          lines.push(`@${i}`);
          expected.push(i);
          continue;
        }
        const d = dest.text;
        const j = jump.text;
        if (d === "") {
          lines.push(`${comp.text}${j === "" ? "" : ";" + j}`);
        } else {
          lines.push(`${d}=${comp.text}${j === "" ? "" : ";" + j}`);
        }
        expected.push(0xe000 | (comp.aBit << 12) | (comp.code << 6) | (dest.bits << 3) | jump.bits);
      }
    }
    const result = assemble(lines.join("\n"));
    assert.deepEqual(result.errors, [], `case ${caseIdx}:\n${lines.join("\n")}`);
    assert.deepEqual([...result.words], expected, `case ${caseIdx}:\n${lines.join("\n")}`);
    for (const [name, addr] of labelAddr) {
      assert.equal(result.symbols[name], addr, `case ${caseIdx}: label ${name}`);
    }
  }
});
