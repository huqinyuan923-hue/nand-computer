import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../src/hack/asm";
import { HackMachine } from "../src/hack/machine";
import { parseVm } from "../src/vm/parse";
import { translateVm } from "../src/vm/translate";

const TRUE = 0xffff;
const FALSE = 0;

/** Build prelude + translated VM + halt; run to completion; return the machine. */
function runVm(vmSrc: string, opts: { module?: string; prelude?: string; bootstrap?: boolean } = {}): HackMachine {
  const { commands, errors } = parseVm(vmSrc);
  assert.deepEqual(errors, []);
  const body = translateVm(commands, { module: opts.module ?? "Test", bootstrap: opts.bootstrap });
  const prelude = opts.bootstrap ? "" : (opts.prelude ?? "@256\nD=A\n@SP\nM=D") + "\n";
  const prog = prelude + body + "(VMHALT)\n@VMHALT\n0;JMP\n";
  const r = assemble(prog);
  assert.deepEqual(r.errors, [], prog);
  const m = new HackMachine(r.words);
  m.run({ until: 5_000_000 });
  return m;
}

function stackTop(m: HackMachine): number {
  return m.ram[m.ram[0] - 1];
}

test("push/pop all memory segments", () => {
  const prelude = [
    "@256", "D=A", "@SP", "M=D",
    "@300", "D=A", "@LCL", "M=D",
    "@400", "D=A", "@ARG", "M=D",
    "@500", "D=A", "@THIS", "M=D",
    "@600", "D=A", "@THAT", "M=D",
    "@111", "D=A", "@300", "M=D", // local 0
    "@222", "D=A", "@400", "M=D", // argument 0
    "@333", "D=A", "@500", "M=D", // this 0
    "@444", "D=A", "@600", "M=D", // that 0
    "@55", "D=A", "@5", "M=D", // temp 0
  ].join("\n");
  const m = runVm([
    "push local 0", "push argument 0", "push this 0", "push that 0", "push temp 0",
    "push constant 77",
    "pop static 0", "pop static 1", "pop static 2", "pop static 3", "pop static 4", "pop static 5",
    // stack was [111,222,333,444,55,77]; pops take from top:
    // static0=77, static1=55, static2=444, static3=333, static4=222, static5=111
    "push static 2", "push static 5", "add", // 444 + 111 = 555
  ].join("\n"), { prelude });
  assert.equal(stackTop(m), 555);
  assert.equal(m.ram[0], 257); // one result on stack (256 base)
});

test("arithmetic and logic battery", () => {
  const cases: Array<[string, number]> = [
    ["push constant 7\npush constant 5\nadd", 12],
    ["push constant 7\npush constant 5\nsub", 2],
    ["push constant 7\npush constant 5\nand", 5 & 7],
    ["push constant 7\npush constant 5\nor", 5 | 7],
    ["push constant 7\nneg", (-7) & 0xffff],
    ["push constant 0\nneg", 0],
    ["push constant 7\nnot", ~7 & 0xffff],
    ["push constant 7\npush constant 5\neq", FALSE],
    ["push constant 5\npush constant 5\neq", TRUE],
    ["push constant 7\npush constant 5\ngt", TRUE],
    ["push constant 3\npush constant 5\ngt", FALSE],
    ["push constant 3\npush constant 5\nlt", TRUE],
    ["push constant 5\npush constant 3\nlt", FALSE],
    ["push constant 5\npush constant 3\nsub\nneg", (-2) & 0xffff],
  ];
  for (const [src, expected] of cases) {
    const m = runVm(src);
    assert.equal(stackTop(m), expected, src.replace(/\n/g, "; "));
    assert.equal(m.ram[0], 257, "exactly one result on stack");
  }
});

test("negative comparisons use signed semantics", () => {
  const m = runVm("push constant 3\nneg\npush constant 5\nlt");
  assert.equal(stackTop(m), TRUE, "(-3) < 5");
  const m2 = runVm("push constant 5\npush constant 3\nneg\nlt");
  assert.equal(stackTop(m2), FALSE, "5 < (-3)");
});

test("program flow: sum 1..10 via loop", () => {
  const m = runVm([
    "push constant 0", "pop local 0", // i
    "push constant 0", "pop local 1", // sum
    "label LOOP",
    "push local 0", "push constant 11", "eq", "if-goto DONE",
    "push local 0", "push local 1", "add", "pop local 1",
    "push local 0", "push constant 1", "add", "pop local 0",
    "goto LOOP",
    "label DONE",
    "push local 1",
  ].join("\n"), { prelude: "@256\nD=A\n@SP\nM=D\n@1000\nD=A\n@LCL\nM=D\n" });
  assert.equal(stackTop(m), 55);
});

test("pointer segment reads and writes THIS/THAT", () => {
  const m = runVm([
    "push pointer 0", // [THIS=400]
    "push pointer 0", // [400, 400]
    "pop pointer 1", // [400], THAT <- 400
    "push pointer 1", // [400, 400]
    "add", // [800]
  ].join("\n"), { prelude: "@256\nD=A\n@SP\nM=D\n@400\nD=A\n@THIS\nM=D\n@500\nD=A\n@THAT\nM=D" });
  assert.equal(stackTop(m), 800);
  assert.equal(m.ram[4], 400); // THAT now holds 400
});

test("function/call/return: recursion + nested frames + statics", () => {
  const vm = [
    // Helper.mul(a,b) = a*b by repeated addition (b >= 0); 2 declared locals
    "function Helper.mul 2",
    "label MUL_LOOP",
    "push local 1", "push argument 1", "eq", "if-goto MUL_DONE",
    "push local 0", "push argument 0", "add", "pop local 0",
    "push local 1", "push constant 1", "add", "pop local 1",
    "goto MUL_LOOP",
    "label MUL_DONE",
    "push local 0",
    "return",
    // Main.fact(n) = n<=1 ? n : n * fact(n-1)
    "function Main.fact 0",
    "push argument 0", "push constant 1", "gt", "if-goto FR",
    "push argument 0", "return",
    "label FR",
    "push argument 0",
    "push argument 0", "push constant 1", "sub",
    "call Main.fact 1",
    "call Helper.mul 2",
    "return",
    // Sys.init
    "function Sys.init 0",
    "push constant 5",
    "call Main.fact 1",
    "pop static 0",
    "label STOP",
    "goto STOP",
  ].join("\n");
  const m = runVm(vm, { module: "Prog", bootstrap: true });
  assert.equal(m.ram[16], 120, "5! = 120 (Prog.0 = first static, RAM 16)");
  assert.ok(m.ram[0] < 2048, "stack usage sane");
});

test("bootstrap emits SP=256 + full call frame for Sys.init", () => {
  const { commands } = parseVm("function Sys.init 0\nlabel STOP\ngoto STOP");
  const asm = translateVm(commands, { module: "Prog", bootstrap: true });
  const r = assemble(asm);
  assert.deepEqual(r.errors, []);
  const m = new HackMachine(r.words);
  m.run({ until: 100 });
  // frame: retaddr + LCL/ARG/THIS/THAT = 5 words; init parks in STOP loop
  assert.equal(m.ram[0], 261);
  assert.equal(m.ram[1], 261); // LCL = SP at call time
});

test("multi-module statics do not collide", () => {
  const asmA = translateVm(parseVm("push constant 11\npop static 0").commands, { module: "A" });
  const asmB = translateVm(parseVm("push constant 22\npop static 0").commands, { module: "B" });
  const prog = "@256\nD=A\n@SP\nM=D\n" + asmA + asmB + "(END)\n@END\n0;JMP";
  const r = assemble(prog);
  assert.deepEqual(r.errors, []);
  const m = new HackMachine(r.words);
  m.run({ until: 200 });
  assert.equal(m.ram[16], 11); // A.0
  assert.equal(m.ram[17], 22); // B.0
});

test("VM parser rejects bad commands", () => {
  assert.ok(parseVm("push foo 3").errors.length > 0);
  assert.ok(parseVm("pop constant 0").errors.length > 0);
  assert.ok(parseVm("push temp 9").errors.length > 0);
  assert.ok(parseVm("push pointer 2").errors.length > 0);
  assert.ok(parseVm("bogus").errors.length > 0);
  assert.ok(parseVm("call f x").errors.length > 0);
  assert.deepEqual(parseVm("push static 3 // ok").errors, []);
});
