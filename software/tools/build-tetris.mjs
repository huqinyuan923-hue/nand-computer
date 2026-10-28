#!/usr/bin/env node
/**
 * Builds the complete Tetris ROM: os/*.jack + tetris/*.jack -> VM -> asm -> hack.
 * Emits .hack binary text on stdout (redirect to golden/tetris/tetris.hack);
 * diagnostics to stderr. Requires `npm run build` (dist/) first.
 */
import { buildRom } from "./lib/build-rom.mjs";
import { wordsToHack } from "../dist/src/hack/asm.js";

const LIMIT = 32768;

const { words } = buildRom();
process.stderr.write(`ROM: ${words.length} words (limit ${LIMIT})\n`);
if (words.length > LIMIT) {
  process.stderr.write(`ROM exceeds ${LIMIT} words\n`);
  process.exit(1);
}
process.stdout.write(wordsToHack(words));
