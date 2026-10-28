#!/usr/bin/env node
/**
 * Closed-loop Tetris recorder.
 *
 * Drives the game on the behavioral Hack machine through the Jack statics
 * (addresses from the assembler symbol table), emitting the ROM
 * (golden/tetris/tetris.hack), a fixed SPEC input script
 * (golden/tetris/input.txt) plus screen-hash checkpoints
 * (golden/tetris/checkpoints.json). The plan clears one line on piece 5 and
 * finishes with a rotated-piece placement. Finally the recorded script is
 * replayed from scratch and every checkpoint hash is verified.
 *
 * Usage: npm run build && node tools/record-tetris.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildRom, root } from "./lib/build-rom.mjs";
import { wordsToHack } from "../dist/src/hack/asm.js";
import { HackMachine } from "../dist/src/hack/machine.js";

const CHUNK = 500;
const LIMIT = 32768;

const { words, symbols } = buildRom();
if (words.length > LIMIT) throw new Error(`ROM ${words.length} > ${LIMIT}`);

const staticNames = [...readFileSync(join(root, "tetris/Tetris.jack"), "utf8")
  .matchAll(/^\s*static\s+(?:Array|int|boolean|char)\s+(\w+)\s*;/gm)].map((mt) => mt[1]);
const addr = (name) => {
  const idx = staticNames.indexOf(name);
  if (idx < 0) throw new Error(`missing static Tetris.${name}`);
  const a = symbols[`Tetris.${idx}`];
  if (a === undefined) throw new Error(`missing symbol Tetris.${idx} (${name})`);
  return a;
};
const ADDR = {
  curType: addr("curType"), curRot: addr("curRot"), curX: addr("curX"), curY: addr("curY"),
  gameOver: addr("gameOver"), sceneDirty: addr("sceneDirty"), prevKey: addr("prevKey"),
  lines: addr("lines"), score: addr("score"), board: addr("board"),
};

const input = [];
let lastKey = 0;
const m = new HackMachine(words, { input });

function setKey(k) {
  if (k === lastKey) return;
  const tail = input[input.length - 1];
  if (tail !== undefined && tail.cycle === m.cycle) tail.key = k;
  else input.push({ cycle: m.cycle, key: k });
  lastKey = k;
}

const s16 = (v) => (v > 0x7fff ? v - 0x10000 : v);
const type = () => s16(m.ram[ADDR.curType]);
const rot = () => s16(m.ram[ADDR.curRot]);
const x = () => s16(m.ram[ADDR.curX]);
const y = () => s16(m.ram[ADDR.curY]);
const over = () => s16(m.ram[ADDR.gameOver]);
const dirty = () => s16(m.ram[ADDR.sceneDirty]);
const lines = () => s16(m.ram[ADDR.lines]);
const score = () => s16(m.ram[ADDR.score]);
const prevKey = () => s16(m.ram[ADDR.prevKey]);

function boardCells() {
  const p = m.ram[ADDR.board];
  const out = [];
  for (let i = 0; i < 200; i++) out.push(s16(m.ram[p + i]));
  return out;
}

function runUntil(pred, limit) {
  const start = m.cycle;
  while (m.cycle - start < limit) {
    m.run({ until: m.cycle + CHUNK });
    if (pred()) return true;
  }
  return false;
}

function tap(keyCode, pred, limit = 6_000_000) {
  // The game only resets its auto-repeat counter when it *observes* a key change.
  // A keyup that happens entirely between two subframes is invisible, so gate on
  // the game's own prevKey before re-pressing the same key.
  if (prevKey() === keyCode) {
    setKey(0);
    if (!runUntil(() => prevKey() === 0, 6_000_000)) throw new Error("key release not observed");
  }
  setKey(keyCode);
  const ok = runUntil(pred, limit);
  setKey(0);
  return ok;
}

function rotateTo(target) {
  let guard = 0;
  while (rot() !== target) {
    const before = rot();
    if (!tap(38, () => rot() !== before)) throw new Error(`rotation blocked at rot=${before}`);
    if (++guard > 6) throw new Error("rotation stuck");
  }
}

function moveTo(targetX) {
  while (x() !== targetX) {
    const before = x();
    const dir = targetX > before ? 39 : 37;
    if (!tap(dir, () => x() !== before)) throw new Error(`move blocked at x=${before}`);
  }
}

function settle() {
  // Wait for the pending redraw to finish. Callers must only invoke this after
  // the scene is known to be dirty (rotate/move/lock set sceneDirty first).
  if (!runUntil(() => dirty() === 0, 5_000_000)) throw new Error("redraw did not complete");
}

function dropUntilLocked(nextType) {
  setKey(40);
  const landed = runUntil(() => over() !== 0 || type() === nextType, 80_000_000);
  if (!landed) {
    setKey(0);
    throw new Error("piece did not lock");
  }
  if (over() !== 0) {
    setKey(0);
    throw new Error("game over during drop");
  }
  // gravityStep() spawns the next piece before setting sceneDirty, so the
  // previous redraw's dirty=0 is still visible right after the spawn. Wait for
  // the lock step to dirty the scene, then for its redraw (post-clear frame).
  if (!runUntil(() => dirty() === 1, 5_000_000)) {
    setKey(0);
    throw new Error("lock step did not dirty the scene");
  }
  settle();
  setKey(0);
}

const checkpoints = [];
function checkpoint(label) {
  checkpoints.push({
    cycle: m.cycle - 1,
    label,
    screenSha256: m.screenSha256(),
    lines: lines(),
    score: score(),
    curType: type(),
    curX: x(),
    curY: y(),
    curRot: rot(),
  });
}

const TYPES = "IOTSZJL";
const PLAN = [
  { x: 7, rot: 0, label: "O flat right" },
  { x: 2, rot: 0, label: "T flat left" },
  { x: 0, rot: 0, label: "S left" },
  { x: 4, rot: 0, label: "Z center" },
  { x: 6, rot: 1, label: "J rotated -> line clear" },
];

// boot -> first piece spawn (seed 7 -> seed 8 -> type 1 = O at (3,0))
if (!runUntil(() => over() === 0 && type() === 1 && x() === 3 && y() <= 1 && rot() === 0 && dirty() === 0, 15_000_000)) {
  throw new Error("first piece did not spawn");
}
checkpoint("boot: first piece spawned");

for (let i = 0; i < PLAN.length; i++) {
  const plan = PLAN[i];
  const expectType = (i + 1) % 7;
  const nextType = (i + 2) % 7;
  if (type() !== expectType) {
    throw new Error(`piece ${i + 1}: expected ${TYPES[expectType]}, got ${TYPES[type()]}`);
  }
  console.error(`piece ${i + 1} ${TYPES[expectType]} spawn @${m.cycle} (x=${x()} y=${y()})`);
  rotateTo(plan.rot);
  if (plan.rot !== 0) {
    settle(); // checkpoint must show the rotated piece, not the previous frame
    checkpoint(`piece ${i + 1} ${TYPES[expectType]}: rotated to ${plan.rot} (mid-air)`);
  }
  moveTo(plan.x);
  console.error(`  placed x=${x()} y=${y()} r=${rot()} @${m.cycle}`);
  dropUntilLocked(nextType);
  console.error(`  locked @${m.cycle} lines=${lines()} score=${score()}`);
  if (process.env.DEBUG_BOARD) {
    const cells = boardCells();
    for (let r = 14; r < 20; r++) console.error('   row' + r + ' ' + cells.slice(r * 10, r * 10 + 10).map((v) => (v ? '#' : '.')).join(''));
  }
  checkpoint(`piece ${i + 1} ${TYPES[expectType]}: locked @x=${plan.x} r=${plan.rot}; lines=${lines()} score=${score()}`);
  if (i === PLAN.length - 1 && !(lines() === 1 && score() === 100)) {
    throw new Error(`expected line clear after piece ${i + 1}, got lines=${lines()} score=${score()}`);
  }
}

// ---- write script + golden checkpoints ----
const scriptText = input.map((e) => `${e.cycle} ${e.key}`).join("\n") + "\n";
writeFileSync(join(root, "golden/tetris/input.txt"), scriptText);
writeFileSync(join(root, "golden/tetris/tetris.hack"), wordsToHack(words));

const romBytes = Buffer.alloc(words.length * 2);
for (let i = 0; i < words.length; i++) romBytes.writeUInt16BE(words[i], i * 2);
const romSha256 = createHash("sha256").update(romBytes).digest("hex");

const finalSha = m.screenSha256();
const golden = {
  program: "golden/tetris/tetris.hack",
  input: "golden/tetris/input.txt",
  romWords: words.length,
  romSha256,
  totalCycles: m.cycle,
  final: { lines: lines(), score: score(), screenSha256: finalSha },
  checkpoints,
};
writeFileSync(join(root, "golden/tetris/checkpoints.json"), JSON.stringify(golden, null, 2) + "\n");

// ---- replay verification ----
const replay = new HackMachine(words);
const res = replay.run({ until: m.cycle - 1, input, checkpoints: checkpoints.map((c) => c.cycle) });
const snaps = new Map(res.checkpoints.map((c) => [c.cycle, c.screenSha256]));
for (const cp of checkpoints) {
  const got = snaps.get(cp.cycle);
  if (got !== cp.screenSha256) throw new Error(`replay hash mismatch at cycle ${cp.cycle} (${cp.label})`);
}

console.log(`ROM ${words.length}/${LIMIT} words sha=${romSha256.slice(0, 16)}..., ${input.length} input events, ${m.cycle} cycles`);
console.log(`final: lines=${lines()} score=${score()} sha=${finalSha.slice(0, 16)}...`);
console.log("board rows 12-19:");
const cells = boardCells();
for (let r = 12; r < 20; r++) {
  console.log(String(r).padStart(2), cells.slice(r * 10, r * 10 + 10).map((v) => (v ? "#" : ".")).join(""));
}
console.log(`${checkpoints.length} checkpoints, replay verified`);
