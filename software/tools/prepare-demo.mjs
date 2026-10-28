#!/usr/bin/env node
/**
 * Stage the static browser demo in demo/.
 *
 * tsc emits demo/engine.js and demo/ui.js from src/browser/; this script copies
 * the golden ROM, the golden input script and the address map (statics +
 * debug cells) that the UI needs at runtime. Run via `npm run build:demo`.
 */
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./lib/build-rom.mjs";

const golden = join(root, "golden/tetris");
const demo = join(root, "demo");

const meta = JSON.parse(readFileSync(join(golden, "demo-meta.json"), "utf8"));
if (typeof meta.statics?.sceneDirty !== "number" || typeof meta.debug?.lines !== "number" ||
    typeof meta.debug?.score !== "number") {
  throw new Error("golden/tetris/demo-meta.json is malformed (run npm run record:tetris)");
}

for (const [src, dst] of [
  ["tetris.hack", "tetris.hack"],
  ["input.txt", "input.txt"],
  ["demo-meta.json", "meta.json"],
]) {
  copyFileSync(join(golden, src), join(demo, dst));
}

console.log(`demo staged: tetris.hack, input.txt, meta.json -> ${demo}`);
