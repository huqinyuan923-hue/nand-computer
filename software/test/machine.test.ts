import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assemble } from "../src/hack/asm";
import { HackMachine, parseInputScript } from "../src/hack/machine";
import { sha256Hex } from "../src/hack/sha256";

function assembleOrThrow(src: string): Uint16Array {
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  return r.words;
}

function signed(w: number): number {
  return w > 0x7fff ? w - 0x10000 : w;
}

test("sha256Hex matches node:crypto reference", () => {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new TextEncoder().encode("abc"),
    new TextEncoder().encode("The quick brown fox jumps over the lazy dog"),
    new Uint8Array(55).fill(0xab),
    new Uint8Array(64).fill(0x5a),
    crypto.getRandomValues(new Uint8Array(1000)),
  ];
  for (const data of cases) {
    const ref = createHash("sha256").update(data).digest("hex");
    assert.equal(sha256Hex(data), ref);
  }
});

test("sum.asm executes: R1 = 1+2+...+R0", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const src = fs.readFileSync(path.resolve(__dirname, "../../golden/asm/sum.asm"), "utf8");
  for (const n of [0, 1, 5, 100]) {
    const m = new HackMachine(assembleOrThrow(src));
    m.ram[0] = n; // R0
    m.run({ until: 5000 });
    assert.equal(signed(m.ram[1]), (n * (n + 1)) / 2, `R0=${n}`);
  }
});

test("every comp decodes to plain arithmetic (A=7, M=RAM[7]=5, D=3)", () => {
  // (asm line, expected value with D=3, A=7, M=5), signed 16-bit
  const cases: Array<[string, number]> = [
    ["D=0", 0], ["D=1", 1], ["D=-1", -1],
    ["D=D", 3], ["D=A", 7], ["D=!D", ~3], ["D=!A", ~7], ["D=-D", -3], ["D=-A", -7],
    ["D=D+1", 4], ["D=A+1", 8], ["D=D-1", 2], ["D=A-1", 6],
    ["D=D+A", 10], ["D=D-A", -4], ["D=A-D", 4], ["D=D&A", 3 & 7], ["D=D|A", 3 | 7],
    ["D=M", 5], ["D=!M", ~5], ["D=-M", -5], ["D=M+1", 6], ["D=M-1", 4],
    ["D=D+M", 8], ["D=D-M", -2], ["D=M-D", 2], ["D=D&M", 3 & 5], ["D=D|M", 3 | 5],
  ];
  const lines: string[] = [
    "@5", "D=A", "@7", "M=D", // RAM[7] = 5
    "@13", "D=-A", "@100", "M=D", // RAM[100] = -13 (unused warmup keeps A/D dirty on purpose)
  ];
  const outs: number[] = [];
  cases.forEach(([, v]) => { void v; });
  cases.forEach((c, i) => {
    const out = 200 + i;
    outs.push(out);
    lines.push("@3", "D=A", "@7", c[0], `@${out}`, "M=D");
  });
  const m = new HackMachine(assembleOrThrow(lines.join("\n")));
  m.run({ until: 100000 });
  cases.forEach(([line, expected], i) => {
    assert.equal(m.ram[outs[i]], expected & 0xffff, `comp case ${line}`);
  });
});

test("keyboard script injects at exact cycles", () => {
  const prog = assembleOrThrow([
    "(LOOP)", "@KBD", "D=M", "@0", "M=D", "@LOOP", "0;JMP",
  ].join("\n"));
  const input = parseInputScript("10 65\n20 0\n30 37\n");
  // RAM[0] is written at cycles 3,9,15,21,27,33... with the key sampled 2 cycles earlier
  const cases: Array<[number, number]> = [[16, 65], [22, 65], [28, 0], [34, 37]];
  for (const [cp, expected] of cases) {
    const m = new HackMachine(prog, { input });
    m.run({ until: cp });
    assert.equal(signed(m.ram[0]), expected, `cycle ${cp}`);
  }
  const mEnd = new HackMachine(prog, { input });
  mEnd.run({ until: 100 });
  assert.equal(mEnd.ram[0x6000], 37); // keyboard register = last entry with cycle <= t
});

test("jump uses the OLD A register when dest A and jump combine", () => {
  const words = assembleOrThrow([
    "@4", // 0: A=4
    "0;JMP", // 1: pc <- 4
    "@7", // 2: A=7 (landing zone)
    "M=1", // 3: RAM[7]=1 (marker)
    "@2", // 4: A=2
    "D=1", // 5: D=1
    "A=D-1;JMP", // 6: dest A (A<-0) AND jump -> must land at OLD A = 2
  ].join("\n"));
  const m = new HackMachine(words);
  m.run({ until: 20 });
  assert.equal(m.ram[7], 1, "jump landed at old A (2)");
  const m2 = new HackMachine(words);
  m2.run({ until: 4 }); // exactly after the A=D-1;JMP instruction at cycle 4
  assert.equal(m2.pc, 2, "pc = old A");
  assert.equal(m2.a, 0, "A latched the comp result D-1=0");
});

test("memory map: out-of-map reads 0/writes ignored; keyboard is read-only", () => {
  const prog = assembleOrThrow([
    "@24577", "D=1", "M=D", "D=M", "@20", "M=D", // RAM[20] = read(0x6001) = 0 (write was ignored)
    "@KBD", "M=D", "@KBD", "D=M", "@21", "M=D", // RAM[21] = KBD (write to keyboard ignored)
  ].join("\n"));
  const input = parseInputScript("0 65\n");
  const m = new HackMachine(prog, { input });
  m.run({ until: 100 });
  assert.equal(m.ram[20], 0);
  assert.equal(m.ram[21], 65);
});

test("halt at end of program; checkpoints dedup and sort", () => {
  const prog = assembleOrThrow(["@1", "D=A", "@2", "M=D"].join("\n"));
  const m = new HackMachine(prog);
  const r = m.run({}); // no checkpoints, no until -> run to natural halt
  assert.equal(r.halted, true);
  assert.equal(r.haltReason, "end-of-program");
  assert.equal(r.cyclesExecuted, 4);
  assert.equal(m.ram[2], 1);
  const m2 = new HackMachine(prog);
  const r2 = m2.run({ checkpoints: [3, 1, 3, 2] }); // dedup+sort; stops after last cp
  assert.deepEqual(r2.checkpoints.map((c) => c.cycle), [1, 2, 3]);
  assert.equal(r2.halted, false);
  assert.equal(r2.cyclesExecuted, 4); // cycles 0..3 executed to complete cp=3
});

test("checkpoints already in the past are rejected instead of fabricated", () => {
  const prog = assembleOrThrow(["@1", "D=A", "@2", "M=D", "@0", "0;JMP"].join("\n"));
  const m = new HackMachine(prog);
  m.run({ until: 4 });
  assert.equal(m.cycle, 5);
  assert.throws(() => m.run({ checkpoints: [4, 10] }), /already passed/);
  assert.equal(m.cycle, 5, "rejected run must not advance the machine");
  const r = m.run({ checkpoints: [5] }); // current boundary is still valid
  assert.deepEqual(r.checkpoints.map((c) => c.cycle), [5]);
  assert.equal(r.checkpoints[0].a, m.a);
});

test("maxCycles caps executed instructions (no off-by-one)", () => {
  const prog = assembleOrThrow(["@1", "D=A", "@2", "M=D", "(H)", "@H", "0;JMP"].join("\n"));
  const m = new HackMachine(prog);
  const r = m.run({ maxCycles: 1 });
  assert.equal(r.cyclesExecuted, 1);
  assert.equal(m.pc, 1);
  assert.equal(r.haltReason, "max-cycles");
  const m0 = new HackMachine(prog);
  const r0 = m0.run({ maxCycles: 0 });
  assert.equal(r0.cyclesExecuted, 0);
  assert.equal(m0.pc, 0);
  assert.equal(r0.haltReason, "max-cycles");
});

test("captureRam snapshots the machine at each checkpoint", () => {
  const prog = assembleOrThrow(["@1", "D=A", "@2", "M=D", "@3", "M=D", "(H)", "@H", "0;JMP"].join("\n"));
  const m = new HackMachine(prog);
  const r = m.run({ checkpoints: [0, 3, 5], captureRam: true });
  assert.deepEqual(r.checkpoints.map((c) => c.cycle), [0, 3, 5]);
  assert.equal(r.checkpoints[0].ram?.[2], 0, "before RAM[2] was written");
  assert.equal(r.checkpoints[1].ram?.[2], 1, "RAM[2]=1 after cycle 3");
  assert.equal(r.checkpoints[2].ram?.[3], 1, "RAM[3]=1 after cycle 5");
  assert.equal(m.ram[3], 1);
  const noRam = new HackMachine(prog).run({ checkpoints: [1] });
  assert.equal(noRam.checkpoints[0].ram, undefined);
});

test("screen hash matches SPEC definition (node:crypto reference)", () => {
  const prog = assembleOrThrow([
    "@4660", "D=A", "@16384", "M=D", // RAM[0x4000] = 0x1234
    "@1", "D=-A", "@16385", "M=D", // RAM[0x4001] = 0xFFFF
    "@255", "D=A", "@16386", "M=D", // RAM[0x4002] = 0x00FF
    "(IDLE)", "@IDLE", "0;JMP",
  ].join("\n"));
  const m = new HackMachine(prog);
  const r = m.run({ checkpoints: [12] });
  const expected = Buffer.alloc(16384);
  expected[0] = 0x12; expected[1] = 0x34;
  expected[2] = 0xff; expected[3] = 0xff;
  expected[4] = 0x00; expected[5] = 0xff;
  const ref = createHash("sha256").update(expected).digest("hex");
  assert.equal(r.checkpoints[0].screenSha256, ref);
  assert.equal(m.screenSha256(), ref);
});

test("watch reports value changes with completing cycle", () => {
  const prog = assembleOrThrow(["@5", "M=M+1", "@0", "0;JMP"].join("\n"));
  const m = new HackMachine(prog, { watch: [5] });
  m.run({ until: 10 });
  assert.deepEqual(
    m.onWatch.map((e) => [e.cycle, e.value]),
    [[1, 1], [5, 2], [9, 3]], // loop is 4 cycles: writes at 1,5,9,13...
  );
});

test("all 7 jump mnemonics take/not-take correctly (signed)", () => {
  // Verifies encoding JGT=001, JEQ=010, JGE=011, JLT=100, JNE=101, JLE=110, JMP=111
  // against positive/zero/negative comp results. taken -> RAM[100]=-1, not-taken -> 1.
  const cases: Array<[string, boolean]> = [
    ["D=1;JGT", true], ["D=0;JGT", false], ["D=-1;JGT", false],
    ["D=0;JEQ", true], ["D=1;JEQ", false], ["D=-1;JEQ", false],
    ["D=1;JGE", true], ["D=0;JGE", true], ["D=-1;JGE", false],
    ["D=-1;JLT", true], ["D=0;JLT", false], ["D=1;JLT", false],
    ["D=1;JNE", true], ["D=-1;JNE", true], ["D=0;JNE", false],
    ["D=1;JLE", false], ["D=0;JLE", true], ["D=-1;JLE", true],
    ["D=0;JMP", true], ["D=1;JMP", true], ["D=-1;JMP", true],
  ];
  for (const [instr, taken] of cases) {
    const prog = assembleOrThrow([
      "@100", "M=0",
      "@8", // A = address of the taken block
      instr,
      "@100", "M=1", // not-taken path
      "@10", "0;JMP",
      "@100", "M=-1", // 8: taken path
      "@10", "0;JMP", // 10: end
    ].join("\n"));
    const m = new HackMachine(prog);
    m.run({ until: 50 });
    assert.equal(
      m.ram[100] === 0xffff, taken,
      `${instr}: expected taken=${taken}, got RAM[100]=${m.ram[100]}`,
    );
  }
});

test("parseInputScript validates format and monotonicity", () => {
  assert.deepEqual(parseInputScript("5 65\n10 0\n"), [{ cycle: 5, key: 65 }, { cycle: 10, key: 0 }]);
  assert.deepEqual(parseInputScript("// comment\n7 37\n"), [{ cycle: 7, key: 37 }]);
  assert.throws(() => parseInputScript("10 0\n5 65\n"));
  assert.throws(() => parseInputScript("10 65 extra\n"));
});

test("screenAscii marks 8x8 blocks", () => {
  const m = new HackMachine(assembleOrThrow(["@16384", "M=-1", "(H)", "@H", "0;JMP"].join("\n")));
  m.run({ until: 5 });
  const ascii = m.screenAscii();
  assert.equal(ascii.split("\n").length, 33);
  assert.equal(ascii[0], "#"); // block 0 = high byte of word 0 = 0xFF
  assert.equal(ascii[1], "#"); // block 1 = low byte of word 0 = 0xFF
  assert.equal(ascii[2], "."); // block 2 = word 1 = 0
});
