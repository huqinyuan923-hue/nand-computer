import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileProgram } from "../src/cli/jackc";
import { parseVm } from "../src/vm/parse";
import { translateVm } from "../src/vm/translate";
import { assemble } from "../src/hack/asm";
import { HackMachine, parseInputScript } from "../src/hack/machine";

const ROOT = path.resolve(__dirname, "../..");
const GOLDEN = path.join(ROOT, "golden/tetris");
const ROM_LIMIT = 32768;

interface GoldenCheckpoint {
  cycle: number;
  label: string;
  screenSha256: string;
  lines: number;
  score: number;
  curType: number;
  curX: number;
  curY: number;
  curRot: number;
}

interface Golden {
  program: string;
  input: string;
  romWords: number;
  romSha256: string;
  totalCycles: number;
  final: { lines: number; score: number; screenSha256: string };
  checkpoints: GoldenCheckpoint[];
}

function jackSources(dir: string): Array<{ name: string; src: string }> {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs).filter((f) => f.endsWith(".jack")).sort()
    .map((f) => ({ name: `${dir}/${f}`, src: fs.readFileSync(path.join(abs, f), "utf8") }));
}

/** Same pipeline as tools/lib/build-rom.mjs: os/*.jack + tetris/*.jack -> ROM. */
function buildTetris(): { words: Uint16Array; symbols: Record<string, number> } {
  const { vms, errors } = compileProgram([...jackSources("os"), ...jackSources("tetris")]);
  assert.deepEqual(errors, [], JSON.stringify(errors));
  let combined = translateVm([], { module: "Sys", bootstrap: true });
  for (const { className, vm } of vms) {
    const { commands, errors: perr } = parseVm(vm);
    assert.deepEqual(perr, [], `${className}: ${JSON.stringify(perr)}`);
    combined += translateVm(commands, { module: className });
  }
  const r = assemble(combined);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  return { words: r.words, symbols: r.symbols };
}

function wordsSha256(words: Uint16Array): string {
  const buf = Buffer.alloc(words.length * 2);
  for (let i = 0; i < words.length; i++) buf.writeUInt16BE(words[i], i * 2);
  return createHash("sha256").update(buf).digest("hex");
}

function loadGolden(): { golden: Golden; rom: Uint16Array; inputText: string } {
  const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, "checkpoints.json"), "utf8")) as Golden;
  const rom = fs.readFileSync(path.join(ROOT, golden.program), "utf8")
    .trim().split(/\r?\n/).map((line) => parseInt(line, 2));
  assert.ok(rom.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff), "ROM words are 16-bit");
  const inputText = fs.readFileSync(path.join(ROOT, golden.input), "utf8");
  return { golden, rom: Uint16Array.from(rom), inputText };
}

const built = buildTetris();
const { golden, rom, inputText } = loadGolden();

// Jack statics are emitted as assembler variables ClassName.<index>; indices are
// assigned in declaration order, so map each named static to its RAM address.
const staticNames = [...fs.readFileSync(path.join(ROOT, "tetris/Tetris.jack"), "utf8")
  .matchAll(/^\s*static\s+(?:Array|int|boolean|char)\s+(\w+)\s*;/gm)].map((m) => m[1]);

function staticAddr(name: string): number {
  const idx = staticNames.indexOf(name);
  assert.ok(idx >= 0, `static ${name} declared`);
  const addr = built.symbols[`Tetris.${idx}`];
  assert.ok(addr !== undefined, `static ${name} has a symbol`);
  return addr;
}

const ADDR = {
  rot: staticAddr("rot"),
  curType: staticAddr("curType"),
  curRot: staticAddr("curRot"),
  curX: staticAddr("curX"),
  curY: staticAddr("curY"),
  lines: staticAddr("lines"),
  score: staticAddr("score"),
};
const s16 = (v: number): number => (v > 0x7fff ? v - 0x10000 : v);

test("Tetris ROM: rebuilt from source, equals the golden image, fits 32K", () => {
  assert.ok(built.words.length < ROM_LIMIT, `ROM overflow: ${built.words.length} words`);
  assert.equal(built.words.length, golden.romWords);
  assert.equal(wordsSha256(built.words), golden.romSha256);
  const goldenWords = fs.readFileSync(path.join(ROOT, golden.program), "utf8")
    .trim().split(/\r?\n/);
  assert.equal(goldenWords.length, built.words.length, "golden image line count");
  for (let i = 0; i < built.words.length; i++) {
    if (parseInt(goldenWords[i], 2) !== built.words[i]) {
      assert.fail(`golden image differs at word ${i} (run tools/record-tetris.mjs to refresh)`);
    }
  }
});

test("Tetris piece tables: 7 pieces x 4 rotations are well-formed at boot", () => {
  const m = new HackMachine(rom);
  m.run({ until: golden.checkpoints[0].cycle });
  assert.equal(s16(m.ram[ADDR.curType]), 1, "first piece is O");
  const p = m.ram[ADDR.rot];
  const cell = (base: number, k: number): [number, number] =>
    [s16(m.ram[p + base + k * 2]), s16(m.ram[p + base + k * 2 + 1])];
  const shape = (t: number, r: number): string => {
    const base = (t * 4 + r) * 8;
    return [0, 1, 2, 3].map((k) => cell(base, k).join(",")).sort().join(" ");
  };
  for (let t = 0; t < 7; t++) {
    for (let r = 0; r < 4; r++) {
      const base = (t * 4 + r) * 8;
      const cells = [0, 1, 2, 3].map((k) => cell(base, k));
      const unique = new Set(cells.map(([x, y]) => `${x},${y}`));
      assert.equal(unique.size, 4, `piece ${t} rot ${r} has 4 distinct cells`);
      for (const [x, y] of cells) {
        assert.ok(x >= 0 && x <= 3 && y >= 0 && y <= 3, `piece ${t} rot ${r} cell (${x},${y}) in 4x4 box`);
      }
    }
  }
  // O is rotation-invariant; I spawns horizontal and its first rotation is vertical.
  assert.equal(shape(1, 0), shape(1, 1));
  assert.equal(shape(1, 1), shape(1, 3));
  const xs = (t: number, r: number): Set<number> => new Set([0, 1, 2, 3].map((k) => cell((t * 4 + r) * 8, k)[0]));
  const ys = (t: number, r: number): Set<number> => new Set([0, 1, 2, 3].map((k) => cell((t * 4 + r) * 8, k)[1]));
  assert.equal(xs(0, 0).size, 4);
  assert.equal(ys(0, 0).size, 1, "I spawn is horizontal");
  assert.equal(xs(0, 1).size, 1, "I rotation 1 is vertical");
  assert.equal(ys(0, 1).size, 4);
});

test("Tetris golden run: script replays to every checkpoint hash and clears one line", () => {
  const input = parseInputScript(inputText);
  assert.ok(input.length > 0, "input script has events");
  const keySet = new Set([0, 37, 38, 39, 40]);
  for (let i = 0; i < input.length; i++) {
    assert.ok(keySet.has(input[i].key), `event ${i} keycode ${input[i].key} is a Tetris control`);
    if (i > 0) assert.ok(input[i].cycle >= input[i - 1].cycle, "input cycles non-decreasing");
  }

  const m = new HackMachine(rom, { input });
  for (const cp of golden.checkpoints) {
    m.run({ until: cp.cycle, input });
    assert.equal(m.screenSha256(), cp.screenSha256, `screen hash at cycle ${cp.cycle} (${cp.label})`);
    assert.equal(s16(m.ram[ADDR.lines]), cp.lines, `lines at ${cp.label}`);
    assert.equal(s16(m.ram[ADDR.score]), cp.score, `score at ${cp.label}`);
    assert.ok(m.ram[0] >= 256 && m.ram[0] < 2048, `SP sane at ${cp.label} (${m.ram[0]})`);
  }
  const last = golden.checkpoints[golden.checkpoints.length - 1];
  assert.equal(s16(m.ram[ADDR.curType]), last.curType);
  assert.equal(s16(m.ram[ADDR.curX]), last.curX);
  assert.equal(s16(m.ram[ADDR.curY]), last.curY);
  assert.equal(s16(m.ram[ADDR.curRot]), last.curRot);
  assert.equal(last.lines, 1, "exactly one line cleared");
  assert.equal(last.score, 100, "single-line clear scores 100");
  assert.equal(m.screenSha256(), golden.final.screenSha256);
  // debug instrumentation at 0x3F00: [frame, x, y, rot, type, lines, score]
  assert.equal(m.ram[0x3f05], 1);
  assert.equal(m.ram[0x3f06], 100);
});

test("Tetris golden run: hackrun CLI reproduces every checkpoint hash", () => {
  const script = inputText.trim().split(/\r?\n/).map((line) => line.trim()).join("; ");
  const cycles = golden.checkpoints.map((cp) => cp.cycle).join(",");
  const stdout = execFileSync(process.execPath, [
    path.join(__dirname, "../src/cli/hackrun.js"),
    "--script", script,
    "--until", String(golden.checkpoints[golden.checkpoints.length - 1].cycle),
    "--checkpoints", cycles,
  ], {
    input: fs.readFileSync(path.join(ROOT, golden.program), "utf8"),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const res = JSON.parse(stdout) as { checkpoints: Array<{ cycle: number; screenSha256: string }> };
  assert.deepEqual(
    res.checkpoints.map((cp) => [cp.cycle, cp.screenSha256]),
    golden.checkpoints.map((cp) => [cp.cycle, cp.screenSha256]),
  );
});

test("Tetris: a held direction key keeps auto-repeating", () => {
  const start = golden.checkpoints[0].cycle; // first piece (O) spawned
  const hold = 40_000_000;
  const input = parseInputScript(`${start} 39\n${start + hold} 0`);
  const m = new HackMachine(rom, { input });
  m.run({ until: start, input });
  const type = s16(m.ram[ADDR.curType]);
  assert.equal(type, 1, "first piece is O");
  let lastX = s16(m.ram[ADDR.curX]);
  let moves = 0;
  for (let c = start; c <= start + hold; c += 100_000) {
    m.run({ until: c, input });
    if (s16(m.ram[ADDR.curType]) !== type) break; // first piece locked
    const x = s16(m.ram[ADDR.curX]);
    if (x !== lastX) {
      moves += 1;
      lastX = x;
    }
  }
  // A stale repeat counter stops after 3 dispatches; a wrapping one keeps
  // moving until the wall blocks the piece.
  assert.ok(moves > 3, `held key repeats (moves=${moves}, x=${lastX})`);
});
