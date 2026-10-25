import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { assemble, wordsToHack, parseHack } from "../src/hack/asm";
import { disassemble } from "../src/hack/disasm";

const GOLDEN = path.resolve(__dirname, "../../golden/asm");

test("golden pair: sum.asm -> sum.hack", () => {
  const src = fs.readFileSync(path.join(GOLDEN, "sum.asm"), "utf8");
  const expected = fs.readFileSync(path.join(GOLDEN, "sum.hack"), "utf8");
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  assert.equal(wordsToHack(r.words), expected);
});

test("golden pair: kbdcopy.asm -> kbdcopy.hack", () => {
  const src = fs.readFileSync(path.join(GOLDEN, "kbdcopy.asm"), "utf8");
  const expected = fs.readFileSync(path.join(GOLDEN, "kbdcopy.hack"), "utf8");
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  assert.equal(wordsToHack(r.words), expected);
});

test("predefined symbols", () => {
  const src = ["@R0", "@R15", "@SP", "@LCL", "@ARG", "@THIS", "@THAT", "@SCREEN", "@KBD"].join("\n");
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.words], [0, 15, 0, 1, 2, 3, 4, 0x4000, 0x6000]);
});

test("variables allocate from RAM 16 in first-use order", () => {
  const src = "@b\n@b\n@a\n@a\nM=0\n";
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.words], [16, 16, 17, 17, 0b1110101010001000]);
});

test("labels share address space with instructions; @label resolves to ROM address", () => {
  const src = "@END\nD=A\n(LOOP)\nD=D-1\n@LOOP\nD;JGT\n(END)\n@END\n0;JMP\n";
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  // addresses: 0 @END, 1 D=A, (LOOP)=2, 2 D=D-1, 3 @LOOP, 4 D;JGT, (END)=5, 5 @END, 6 0;JMP
  assert.deepEqual(
    [...r.words],
    [5, 0b1110110000010000, 0b1110001110010000, 2, 0b1110001100000001, 5, 0b1110101010000111],
  );
});

test("comments and blank lines are ignored; whitespace tolerated", () => {
  const src = "  // only a comment\n\n   @5   // trailing comment\n  D=A ; junk is invalid though\n";
  const r = assemble(src);
  // "D=A ; junk" -> comp "D=A ; junk" is invalid (jumps only follow a semicolon)
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 4);
  assert.equal(r.words.length, 1);
});

test("all comp/dest/jump spellings encode per standard Hack spec", () => {
  const src = [
    "M=0", "D=M", "MD=D-1", "AM=M-1", "AD=!M", "AMD=M+1",
    "0;JMP", "D;JGT", "D;JEQ", "D;JLT", "D;JGE", "D;JNE", "D;JLE",
    "D=D|M", "D=D&A", "D=M-D", "D=A-D", "A=-D", "D=-A", "M=!M", "D=!D", "D=D|A",
  ].join("\n");
  const r = assemble(src);
  assert.deepEqual(r.errors, []);
  // each expected value hand-computed as "111" + a + comp(6) + dest(3) + jump(3)
  // expected values cross-checked against the bit formula 0xE000 | a<<12 | comp<<6 | dest<<3 | jump
  // (comp values: 0=101010, 1=111111, -1=111010, D=001100, A/M=110000, !D=001101, !M=110001,
  //  -D=001111, -M=110011, D+1=011111, M+1=110111, D-1=001110, M-1=110010, D+M=000010,
  //  D-M=010011, M-D=000111, D&M=000000, D|M=010101; dest A=100,D=010,M=001)
  const expected = [
    "1110101010001000", // M=0     (a=0, comp 101010)
    "1111110000010000", // D=M     (a=1, comp 110000)
    "1110001110011000", // MD=D-1  (a=0, comp 001110, dest 011)
    "1111110010101000", // AM=M-1  (a=1, comp 110010, dest 101)
    "1111110001110000", // AD=!M   (a=1, comp 110001, dest 110)
    "1111110111111000", // AMD=M+1 (a=1, comp 110111, dest 111)
    "1110101010000111", // 0;JMP
    "1110001100000001", // D;JGT
    "1110001100000010", // D;JEQ
    "1110001100000100", // D;JLT (bit2)
    "1110001100000011", // D;JGE (GT|EQ)
    "1110001100000101", // D;JNE
    "1110001100000110", // D;JLE
    "1111010101010000", // D=D|M
    "1110000000010000", // D=D&A (a=0, comp 000000, dest 010)
    "1111000111010000", // D=M-D (a=1, comp 010011)
    "1110000111010000", // D=A-D (a=0, comp 000111)
    "1110001111100000", // A=-D  (a=0, comp 001111, dest 100)
    "1110110011010000", // D=-A  (a=0, comp 110011)
    "1111110001001000", // M=!M  (a=1, comp 110001, dest 001)
    "1110001101010000", // D=!D  (a=0, comp 001101)
    "1110010101010000", // D=D|A (a=0, comp 010101)
  ];
  const got = wordsToHack(r.words).trim().split("\n");
  assert.deepEqual(got, expected);
});

test("roundtrip: disassemble -> assemble yields identical words", () => {
  const files = ["sum", "kbdcopy"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(GOLDEN, `${f}.asm`), "utf8");
    const r = assemble(src);
    assert.deepEqual(r.errors, []);
    const dis = disassemble(r.words);
    const r2 = assemble(dis);
    assert.deepEqual(r2.errors, []);
    assert.deepEqual([...r2.words], [...r.words], `roundtrip failed for ${f}`);
  }
});

test("errors: invalid comp, invalid dest, duplicate label, A value out of range", () => {
  assert.ok(assemble("D=K").errors.length > 0);
  assert.ok(assemble("X=D").errors.length > 0);
  assert.ok(assemble("(A)\n(A)").errors.length > 0);
  assert.ok(assemble("@32768").errors.length > 0);
  assert.ok(assemble("(R0)").errors.length > 0); // label shadowing predefined symbol
  const r = assemble("D=K\n@32768\n0;JMP");
  assert.deepEqual(r.errors.map((e) => e.line), [1, 2]);
});

test("parseHack rejects malformed lines", () => {
  assert.throws(() => parseHack("000000000000001\n")); // 15 bits
  assert.throws(() => parseHack("hello\n"));
  assert.deepEqual([...parseHack("0100000000000000\n\n0000000000000010")], [0x4000, 2]);
});
