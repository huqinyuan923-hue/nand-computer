import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileProgram } from "../src/cli/jackc";
import { parseVm } from "../src/vm/parse";
import { translateVm } from "../src/vm/translate";
import { assemble } from "../src/hack/asm";
import { HackMachine } from "../src/hack/machine";
import { screenSha256 } from "../src/hack/sha256";

const OS_DIR = path.resolve(__dirname, "../../os");

function osSources(): Array<{ name: string; src: string }> {
  return fs.readdirSync(OS_DIR).filter((f) => f.endsWith(".jack")).sort().map((f) => ({
    name: f,
    src: fs.readFileSync(path.join(OS_DIR, f), "utf8"),
  }));
}

/** Compile the real OS + user Main source; run to completion on hackrun. */
function runOs(mainSrc: string, opts: { input?: string; until?: number } = {}): HackMachine {
  const sources = [...osSources(), { name: "Main.jack", src: mainSrc }];
  const { vms, errors } = compileProgram(sources);
  assert.deepEqual(errors, []);
  let combined = translateVm([], { module: "Sys", bootstrap: true });
  for (const { className, vm } of vms) {
    const { commands, errors: perr } = parseVm(vm);
    assert.deepEqual(perr, [], `${className}: ${perr}`);
    combined += translateVm(commands, { module: className });
  }
  const r = assemble(combined);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  assert.ok(r.words.length < 32768, `ROM overflow: ${r.words.length} words`);
  const input = opts.input !== undefined ? opts.input : undefined;
  const m = new HackMachine(r.words, input !== undefined ? { input: parseScript(input) } : {});
  m.run({ until: opts.until ?? 50_000_000 });
  return m;
}

function parseScript(text: string) {
  // local helper to avoid importing parseInputScript under a different name
  const { parseInputScript } = require("../src/hack/machine") as typeof import("../src/hack/machine");
  return parseInputScript(text);
}

const MAIN_WRAP = (body: string, vars = ""): string => `
class Main {
    function void main() {
        ${vars}
        ${body}
        return;
    }
}
`;

// ---------- Math ----------

test("OS Math: multiply/divide battery incl. negatives and -32768", () => {
  const cases: Array<[string, number]> = [
    ["Math.multiply(0, 12345)", 0],
    ["Math.multiply(7, 6)", 42],
    ["Math.multiply(-7, 6)", (-42) & 0xffff],
    ["Math.multiply(7, -6)", (-42) & 0xffff],
    ["Math.multiply(-7, -6)", 42],
    ["Math.multiply(123, 456)", 123 * 456 & 0xffff],
    ["Math.multiply(256, 256)", 0], // wraps mod 2^16
    ["Math.multiply(NEG32K, 2)", 0], // -65536 wraps to 0
    ["Math.multiply(NEG32K, 1)", -32768 & 0xffff],
    ["Math.multiply(181, -181)", (-32761) & 0xffff],
    ["Math.divide(100, 7)", 14],
    ["Math.divide(0, 5)", 0],
    ["Math.divide(-100, 7)", (-14) & 0xffff],
    ["Math.divide(100, -7)", (-14) & 0xffff],
    ["Math.divide(-100, -7)", 14],
    ["Math.divide(NEG32K, 1)", (-32768) & 0xffff],
    ["Math.divide(NEG32K, 2)", (-16384) & 0xffff],
    ["Math.divide(NEG32K, NEG32K)", 1],
    ["Math.divide(32767, 32767)", 1],
    ["Math.divide(7, 2)", 3],
    ["Math.divide(-7, 2)", (-3) & 0xffff],
    ["Math.abs(-5)", 5],
    ["Math.abs(5)", 5],
    ["Math.min(3, -2)", -2],
    ["Math.max(3, -2)", 3],
  ];
  let body = "let NEG32K = 0 - 32767 - 1;\n";
  cases.forEach((c, i) => {
    body += `do Memory.poke(${600 + i}, ${c[0]});\n`;
  });
  const m = runOs(MAIN_WRAP(body, "var int NEG32K;"));
  cases.forEach((c, i) => {
    assert.equal(m.ram[600 + i], c[1] & 0xffff, c[0]);
  });
});

// ---------- Memory ----------

test("OS Memory: bump addresses, free-list reuse, OOM sentinel", () => {
  const m = runOs(MAIN_WRAP(`
    let a1 = Memory.alloc(10);
    let a2 = Memory.alloc(20);
    do Memory.poke(601, a1);        // first block right after heap start
    do Memory.poke(602, a2 - a1);   // 22 apart (10+2 header)
    let a1[0] = 111;
    let a2[5] = 222;
    do Memory.poke(603, a1[0]);
    do Memory.poke(604, a2[5]);
    do Memory.dealloc(a2);
    let a3 = Memory.alloc(20);      // should reuse the freed block (first fit, exact size)
    do Memory.poke(605, a3 = a2);   // true -> -1
    let a3 = Memory.alloc(15000);   // too big for the remaining heap -> 0
    do Memory.poke(606, a3);
  `, "var Array a1;\n    var Array a2;\n    var Array a3;"));
  assert.equal(m.ram[602], 12); // payload spacing = size + 2 header cells
  assert.ok(m.ram[601] >= 2050, "first block inside heap");
  assert.equal(m.ram[603], 111);
  assert.equal(m.ram[604], 222);
  assert.equal(m.ram[605], 0xffff);
  assert.equal(m.ram[606], 0);
  assert.equal(m.ram[607], 0);
});

// ---------- String ----------

test("OS String: append/charAt/intValue/setInt incl. -32768", () => {
  const m = runOs(MAIN_WRAP(`
    let neg = 0 - 32767 - 1;   // -32768
    let s = String.new(8);
    do s.appendChar(72);   // H
    do s.appendChar(105);  // i
    do s.appendChar(33);   // !
    do Memory.poke(610, s.length());      // 3
    do Memory.poke(611, s.charAt(1));     // 105
    let t = String.new(8);
    do t.setInt(neg);
    do Memory.poke(612, t.length());      // 6 ("-32768")
    do Memory.poke(613, t.charAt(0));     // '-'
    do Memory.poke(614, t.charAt(1));     // '3'
    do Memory.poke(615, t.charAt(5));     // '8'
    do s.setInt(0);
    do Memory.poke(616, s.length());      // 1
    do Memory.poke(617, s.charAt(0));     // '0'
    do s.setInt(-42);
    do Memory.poke(618, s.length());      // 3
    do s.eraseLastChar();
    do Memory.poke(619, s.length());      // 2
    do s.setInt(4096);
    do Memory.poke(621, String.backSpace());  // 8 (SPEC)
    do Memory.poke(622, String.newLine());    // 13 (SPEC)
  `, "var String s;\n    var String t;\n    var int neg;"));
  assert.equal(m.ram[610], 3);
  assert.equal(m.ram[611], 105);
  assert.equal(m.ram[612], 6);
  assert.equal(m.ram[613], 45);
  assert.equal(m.ram[614], 51);
  assert.equal(m.ram[615], 56);
  assert.equal(m.ram[616], 1);
  assert.equal(m.ram[617], 48);
  assert.equal(m.ram[618], 3);
  assert.equal(m.ram[619], 2); // after eraseLastChar: "-4"
  assert.equal(m.ram[621], 8);
  assert.equal(m.ram[622], 13);
});

test("OS String.setInt respects maxLength (no heap overrun)", () => {
  const m = runOs(MAIN_WRAP(`
    let neg = 0 - 32767 - 1;   // -32768
    let tiny = String.new(2);
    do tiny.setInt(neg);
    do Memory.poke(640, tiny.length());
    do Memory.poke(641, tiny.charAt(0));
    do Memory.poke(642, tiny.charAt(1));
    let empty = String.new(0);
    do empty.setInt(neg);
    do Memory.poke(643, empty.length());
  `, "var String tiny;\n    var String empty;\n    var int neg;"));
  assert.equal(m.ram[640], 2, "length clamped to capacity");
  assert.equal(m.ram[641], 45, "'-' kept");
  assert.equal(m.ram[642], 51, "'3' kept");
  assert.equal(m.ram[643], 0, "zero-capacity string stays empty");
});

// ---------- Screen ----------

test("OS Screen: SPEC pixel mapping, drawPixel bits, rectangle, clear", () => {
  const m = runOs(MAIN_WRAP(`
    do Screen.drawPixel(0, 0);        // word 16384 bit 15
    do Memory.poke(630, Memory.peek(16384)); // 0x8000
    do Screen.setColor(0);
    do Screen.drawPixel(0, 0);        // erase
    do Memory.poke(631, Memory.peek(16384)); // 0
    do Screen.setColor(1);
    do Screen.drawPixel(15, 0);       // bit 0 of word 16384
    do Screen.drawPixel(16, 0);       // bit 15 of word 16385
    do Screen.drawPixel(511, 255);    // last word bit 0
    do Memory.poke(632, Memory.peek(16384));
    do Memory.poke(633, Memory.peek(16385));
    do Memory.poke(634, Memory.peek(16384 + 8191));
    do Screen.clearScreen();
    do Memory.poke(635, Memory.peek(16384));
    do Screen.drawRectangle(100, 10, 111, 19); // 12x12 block
    do Memory.poke(636, Memory.peek(16384 + (10 * 32) + 6)); // word with bits 15..4
    do Screen.setColor(0);
    do Screen.drawRectangle(100, 10, 111, 19);
    do Memory.poke(637, Memory.peek(16384 + (10 * 32) + 6));
  `));
  assert.equal(m.ram[630], 0x8000);
  assert.equal(m.ram[631], 0);
  assert.equal(m.ram[632], 0x0001); // after erase, only x=15 re-drawn (bit 0)
  assert.equal(m.ram[633], 0x8000); // x=16
  assert.equal(m.ram[634], 0x0001); // x=511: word offset 31 -> bit 0
  assert.equal(m.ram[635], 0);
  assert.equal(m.ram[636], 0x0fff); // x 100..111 -> word 6 (px 96..111): bits 11..0
  assert.equal(m.ram[637], 0);
});

test("OS Screen.drawRectangle clips y to the screen (no heap writes)", () => {
  const m = runOs(MAIN_WRAP(`
    do Screen.setColor(1);
    do Screen.drawRectangle(0, -5, 511, -5);
    do Screen.drawRectangle(0, -200, 511, -1);
    do Screen.drawRectangle(0, 250, 511, 300);
  `));
  assert.equal(m.ram[16384 - 160], 0, "row y=-5 must not address the heap");
  assert.equal(m.ram[16384 - 32], 0, "row y=-1 must not address the heap");
  assert.equal(m.ram[16384 + 250 * 32], 0xffff, "visible rows still drawn");
  assert.equal(m.ram[16384 + 255 * 32], 0xffff, "last visible row drawn");
});

// ---------- Output ----------

test("OS Output: printChar word layout, printString, printInt, moveCursor", () => {
  const m = runOs(MAIN_WRAP(`
    do Output.printChar(65);   // 'A' at (0,0)
    do Output.printChar(67);   // 'C' at (1,0)
    do Output.moveCursor(5, 0);
    do Output.printString("TV");
    do Output.moveCursor(20, 3);
    do Output.printInt(-1234);
  `));
  // Layout: glyph row r occupies ONE byte — high byte of word (16384 + r*32)
  // for even columns, low byte for odd columns. A rows: 18 3C 66 66 7E 66 66 00;
  // C rows: 3C 66 60 60 60 66 3C 00. Columns 0/1 -> word 0 (high/low byte).
  assert.equal(m.ram[16384], 0x183c);        // row 0
  assert.equal(m.ram[16384 + 32], 0x3c66);   // row 1
  assert.equal(m.ram[16384 + 96], 0x6660);   // row 3
  assert.equal(m.ram[16384 + 224], 0x0000);  // row 7
  // 'T' at (5,0), 'V' at (6,0): col 5 -> word 2 LOW byte, col 6 -> word 3 HIGH byte.
  // T rows: 7E 18 18 18 18 18 18 00; V rows: 66 66 66 66 66 3C 18 00.
  assert.equal(m.ram[16384 + 2], 0x007e);      // row 0
  assert.equal(m.ram[16384 + 3], 0x6600);      // row 0
  assert.equal(m.ram[16384 + 2 + 32], 0x0018); // row 1
  assert.equal(m.ram[16384 + 3 + 32], 0x6600); // row 1
  // "-1234" at (20,3): '-'20 '1'21 '2'22 '3'23 '4'24; col 24 -> word 12 high byte.
  // '4' row0 = 0x0C; col 25 untouched. Char row 3 = word offset 3*256.
  assert.equal(m.ram[16384 + 3 * 256 + 12], 0x0c00);
});

// ---------- Keyboard ----------

test("OS Keyboard: key() reflects injected script at cycle boundaries", () => {
  // main loop polls the keyboard into RAM[640] forever
  const m = runOs(MAIN_WRAP(`
    while (true) {
      do Memory.poke(640, Keyboard.key());
    }
  `), { input: "200 65\n400 37\n600 0\n", until: 80000 });
  assert.ok(m.ram[640] === 0 || m.ram[640] === 65 || m.ram[640] === 37, "keyboard value sane");
});

test("OS Keyboard: exact keycode after each injection window", () => {
  const w1 = runOs(MAIN_WRAP(`
    while (true) {
      do Memory.poke(641, Keyboard.key());
    }
  `), { input: "100 65\n", until: 3_000_000 });
  assert.equal(w1.ram[641], 65);
  const w2 = runOs(MAIN_WRAP(`
    while (true) {
      do Memory.poke(642, Keyboard.key());
    }
  `), { input: "100 65\n300 0\n400 37\n", until: 3_500_000 });
  assert.equal(w2.ram[642], 37);
});

// ---------- Boot ----------

test("OS boot: Sys.init clears screen; empty-screen hash is all-zero bytes", () => {
  const m = runOs(MAIN_WRAP(`
    do Memory.poke(650, 12345);
  `), { until: 5_000_000 });
  const expected = createHash("sha256").update(Buffer.alloc(16384)).digest("hex");
  assert.equal(m.screenSha256(), expected);
  assert.equal(m.ram[650], 12345);
  assert.ok(m.ram[0] >= 256 && m.ram[0] < 2048, "SP in stack range");
});
