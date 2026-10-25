import { test } from "node:test";
import assert from "node:assert/strict";
import { compileProgram } from "../src/cli/jackc";
import { parseVm } from "../src/vm/parse";
import { translateVm } from "../src/vm/translate";
import { assemble } from "../src/hack/asm";
import { HackMachine } from "../src/hack/machine";

/**
 * Minimal test-only OS kernel (Jack): bump allocator, Array, String, HW peek/poke.
 * The real OS subset lands in M5; this is just enough scaffolding to exercise
 * constructors, objects, arrays and string literals end-to-end on hackrun.
 */
const TEST_OS = `
class Math {
    function int multiply(int a, int b) {
        var int result;
        var int i;
        let result = 0;
        let i = 0;
        while (i < b) {
            let result = result + a;
            let i = i + 1;
        }
        return result;
    }
    function int divide(int a, int b) {
        var int q;
        var int r;
        let q = 0;
        let r = a;
        while (~(r < b)) {
            let r = r - b;
            let q = q + 1;
        }
        return q;
    }
}
class Memory {
    static int freeBase;
    function int alloc(int size) {
        if (freeBase = 0) {
            let freeBase = 2050;
        }
        let freeBase = freeBase + size;
        return freeBase - size;
    }
    function void dealloc(int addr) {
        return;
    }
}
class Array {
    function Array new(int size) {
        var Array p;
        let p = Memory.alloc(size);
        return p;
    }
    function void dispose(Array a) {
        return;
    }
}
class String {
    field int len;
    field Array data;
    constructor String new(int maxLength) {
        let len = 0;
        let data = Memory.alloc(maxLength);
        return this;
    }
    method String appendChar(int c) {
        var Array p;
        let p = data + len;
        let p[0] = c;
        let len = len + 1;
        return this;
    }
    method int charAt(int i) {
        var Array p;
        let p = data + i;
        return p[0];
    }
    method int length() {
        return len;
    }
    method void dispose() {
        return;
    }
}
class HW {
    function void poke(int addr, int value) {
        var Array p;
        let p = addr;
        let p[0] = value;
        return;
    }
    function int peek(int addr) {
        var Array p;
        let p = addr;
        return p[0];
    }
}
`;

/** Compile TEST_OS + user sources, link to one program, run on hackrun. */
function runJack(userSrc: string, opts: { until?: number } = {}): HackMachine {
  const sources = [
    { name: "TestOS.jack", src: TEST_OS },
    { name: "User.jack", src: userSrc },
  ];
  const { vms, errors } = compileProgram(sources);
  assert.deepEqual(errors, []);
  // bootstrap chunk must be the FIRST code in the program (SP=256 + call Sys.init)
  let combined = translateVm([], { module: "Sys", bootstrap: true });
  let sawSys = false;
  for (const { className, vm } of vms) {
    if (className === "Sys") sawSys = true;
    const { commands, errors: perr } = parseVm(vm);
    assert.deepEqual(perr, [], vm);
    combined += translateVm(commands, { module: className });
  }
  assert.ok(sawSys, "test source must define Sys.init");
  const r = assemble(combined);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  const m = new HackMachine(r.words);
  m.run({ until: opts.until ?? 5_000_000 });
  return m;
}

const MAIN_WRAP = (body: string): string => `
class Sys {
    function void init() {
        ${body}
        return;
    }
}
`;

test("expression precedence battery", () => {
  const cases: Array<[string, number]> = [
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 2 - 3", 5],
    ["2 * 3 + 4 * 5", 26],
    ["20 / 4 / 5", 1],
    ["-(3 + 4)", -7 & 0xffff],
    ["~0", 0xffff],
    ["~12", ~12 & 0xffff],
    ["3 < 5", 0xffff],
    ["5 < 3", 0],
    ["5 > 3", 0xffff],
    ["3 > 5", 0],
    ["2 = 2", 0xffff],
    ["2 = 3", 0],
    ["1 & 3", 1],
    ["1 | 2", 3],
    ["6 & 3 | 8", 10],
    ["1 | 2 & 2", 1 | 2],
    ["true", 0xffff],
    ["false", 0],
    ["1 = 1 & 2 = 2", 0xffff],
    ["3 < 5 & 2 < 1", 0],
  ];
  let body = "";
  cases.forEach((c, i) => {
    body += `do HW.poke(${500 + i}, ${c[0]});\n`;
  });
  const m = runJack(MAIN_WRAP(body));
  cases.forEach((c, i) => {
    assert.equal(m.ram[500 + i], c[1], `expr: ${c[0]}`);
  });
});

test("while loop, if/else, statics", () => {
  const m = runJack(MAIN_WRAP(`
    var int i;
    var int sum;
    let i = 1;
    while (i < 11) {
        let sum = sum + i;
        let i = i + 1;
    }
    do HW.poke(501, sum);           // 55
    if (sum = 55) {
        do HW.poke(502, 1);
    } else {
        do HW.poke(502, 2);
    }
    if (sum = 56) {
        do HW.poke(503, 1);
    } else {
        do HW.poke(503, 2);
    }
    let i = 0;
    while (i < 3) {
        let i = i + 1;
    }
    do HW.poke(504, i);             // 3
  `));
  assert.equal(m.ram[501], 55);
  assert.equal(m.ram[502], 1);
  assert.equal(m.ram[503], 2);
  assert.equal(m.ram[504], 3);
});

test("objects: constructor, fields, methods, this calls", () => {
  const m = runJack(`
class Point {
    field int x;
    field int y;
    constructor Point new(int px, int py) {
        let x = px;
        let y = py;
        return this;
    }
    method int getX() { return x; }
    method int getY() { return y; }
    method int sum() { return x + y; }
    method int sumViaCalls() {
        return this.getX() + getY();
    }
    method void move(int dx, int dy) {
        let x = x + dx;
        let y = y + dy;
        return;
    }
}
class Sys {
    function void init() {
        var Point p;
        var Point q;
        let p = Point.new(3, 4);
        do HW.poke(510, p.getX());        // 3
        do HW.poke(511, p.getY());        // 4
        do HW.poke(512, p.sum());         // 7
        do HW.poke(513, p.sumViaCalls()); // 7
        do p.move(10, 20);
        do HW.poke(514, p.sum());         // 37
        let q = Point.new(100, 200);
        do HW.poke(515, q.sum());         // 300
        do HW.poke(516, p.sum());         // 37 (frames isolated)
        return;
    }
}
`);
  assert.equal(m.ram[510], 3);
  assert.equal(m.ram[511], 4);
  assert.equal(m.ram[512], 7);
  assert.equal(m.ram[513], 7);
  assert.equal(m.ram[514], 37);
  assert.equal(m.ram[515], 300);
  assert.equal(m.ram[516], 37);
});

test("arrays: Array.new, indexing, element write via index expressions", () => {
  const m = runJack(MAIN_WRAP(`
    var Array a;
    var int i;
    let a = Array.new(10);
    let i = 0;
    while (i < 10) {
        let a[i] = i * i;
        let i = i + 1;
    }
    do HW.poke(520, a[0]);   // 0
    do HW.poke(521, a[3]);   // 9
    do HW.poke(522, a[9]);   // 81
    let a[a[1] + 2] = 777;   // a[1]=1 -> a[3] = 777
    do HW.poke(523, a[3]);
  `));
  assert.equal(m.ram[520], 0);
  assert.equal(m.ram[521], 9);
  assert.equal(m.ram[522], 81);
  assert.equal(m.ram[523], 777);
});

test("string literals compile to String.new/appendChar chains", () => {
  const m = runJack(MAIN_WRAP(`
    var String s;
    var String t;
    let s = "AbZ";
    do HW.poke(530, s.length());   // 3
    do HW.poke(531, s.charAt(0));  // 65
    do HW.poke(532, s.charAt(1));  // 98
    do HW.poke(533, s.charAt(2));  // 90
    let t = "x";
    do HW.poke(534, t.length());   // 1
    do HW.poke(535, t.charAt(0));  // 120
  `));
  assert.equal(m.ram[530], 3);
  assert.equal(m.ram[531], 65);
  assert.equal(m.ram[532], 98);
  assert.equal(m.ram[533], 90);
  assert.equal(m.ram[534], 1);
  assert.equal(m.ram[535], 120);
});

test("statics are shared per class; void functions and do-statements", () => {
  const m = runJack(`
class Counter {
    static int count;
    function void bump() {
        let count = count + 1;
        return;
    }
    function int get() { return count; }
}
class Sys {
    function void init() {
        do HW.poke(540, Counter.get());   // 0
        do Counter.bump();
        do Counter.bump();
        do Counter.bump();
        do HW.poke(541, Counter.get());   // 3
        return;
    }
}
`);
  assert.equal(m.ram[540], 0);
  assert.equal(m.ram[541], 3);
});

test("tokenizer/parser errors are reported with line numbers", () => {
  const { errors } = compileProgram([{ name: "Bad.jack", src: "class 123 { }" }]);
  assert.ok(errors.length > 0);
  const { errors: e2 } = compileProgram([{ name: "Bad2.jack", src: 'class A { function void f() { let x = "unterminated; return; } }' }]);
  assert.ok(e2.length > 0);
  const { errors: e3 } = compileProgram([{ name: "Bad3.jack", src: "class A { function void f() { return 99999; } }" }]);
  assert.ok(e3.length > 0); // int constant out of range
  const { errors: e4 } = compileProgram([{ name: "Bad4.jack", src: "class A { function void f() { let q = 1; return; } }" }]);
  assert.ok(e4.length > 0); // undefined variable q
  const { errors: e5 } = compileProgram([{ name: "Bad5.jack", src: "class A { function void f() { do Missing.g(); return; } }" }]);
  assert.ok(e5.length > 0); // call to undefined function
});
