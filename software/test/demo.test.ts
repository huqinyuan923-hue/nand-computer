import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { HackCore, parseHackText, parseScriptText } from "../src/browser/engine";
import { HackMachine, parseInputScript } from "../src/hack/machine";

const ROOT = path.resolve(__dirname, "../..");
const GOLDEN = path.join(ROOT, "golden/tetris");

interface GoldenCheckpoint {
  cycle: number;
  label: string;
  screenSha256: string;
}

interface Golden {
  program: string;
  input: string;
  final: { screenSha256: string };
  checkpoints: GoldenCheckpoint[];
}

interface DemoMeta {
  statics: { sceneDirty: number };
  debug: { lines: number; score: number };
}

const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, "checkpoints.json"), "utf8")) as Golden;
const meta = JSON.parse(fs.readFileSync(path.join(GOLDEN, "demo-meta.json"), "utf8")) as DemoMeta;
const romText = fs.readFileSync(path.join(ROOT, golden.program), "utf8");
const scriptText = fs.readFileSync(path.join(ROOT, golden.input), "utf8");
const rom = parseHackText(romText);
const script = parseScriptText(scriptText);

function screenSha(core: HackCore): string {
  const buf = Buffer.alloc(8192 * 2);
  for (let i = 0; i < 8192; i++) buf.writeUInt16BE(core.ram[0x4000 + i], i * 2);
  return createHash("sha256").update(buf).digest("hex");
}

test("demo parsers: .hack words and cycle/key scripts follow the SPEC format", () => {
  assert.deepEqual(
    Array.from(parseHackText("0000000000000000\r\n0110000000000111 // add one\n\n")),
    [0x0000, 0x6007],
  );
  assert.throws(() => parseHackText("000000000000000"));
  assert.throws(() => parseHackText("0000000000000002"));
  assert.deepEqual(
    parseScriptText("0 0\n5 39 // press\n5 0\n9 40\n"),
    [{ cycle: 0, key: 0 }, { cycle: 5, key: 39 }, { cycle: 5, key: 0 }, { cycle: 9, key: 40 }],
  );
  assert.throws(() => parseScriptText("5 39\n4 0\n"));
});

test("demo engine: golden ROM + script replays to every checkpoint hash", () => {
  assert.equal(rom.length, romText.trim().split(/\r?\n/).length, "every .hack line becomes a word");
  const core = new HackCore(rom);
  core.loadScript(script);
  for (const cp of golden.checkpoints) {
    while (core.cycle <= cp.cycle) core.step();
    assert.equal(screenSha(core), cp.screenSha256, `screen hash at cycle ${cp.cycle} (${cp.label})`);
  }
  assert.equal(screenSha(core), golden.final.screenSha256);
  assert.equal(core.ram[meta.debug.lines], 1);
  assert.equal(core.ram[meta.debug.score], 100);
  // The UI only paints when the game's sceneDirty static reads 0 between redraws.
  assert.equal(core.ram[meta.statics.sceneDirty], 0, "scene settled at the final checkpoint");
});

test("demo engine: instruction-level lockstep with the oracle past the first key", () => {
  const core = new HackCore(rom);
  core.loadScript(script);
  const input = parseInputScript(scriptText);
  const machine = new HackMachine(rom, { input });
  const UNTIL = 6_000_000; // first scripted key is at 5,651,280
  core.run(UNTIL + 1);
  machine.run({ until: UNTIL, input });
  assert.equal(core.cycle, machine.cycle);
  assert.equal(core.a, machine.a, "A register");
  assert.equal(core.d, machine.d, "D register");
  assert.equal(core.pc, machine.pc, "PC");
  assert.deepEqual(core.ram, machine.ram, "full memory image");
});
