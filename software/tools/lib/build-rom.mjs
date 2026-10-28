#!/usr/bin/env node
/**
 * Shared ROM build pipeline: os/*.jack + game dirs -> VM -> asm -> words.
 * Returns the assembler symbol table too, so harnesses can read Jack statics.
 * Requires `npm run build` (dist/).
 */
import { compileProgram } from "../../dist/src/cli/jackc.js";
import { parseVm } from "../../dist/src/vm/parse.js";
import { translateVm } from "../../dist/src/vm/translate.js";
import { assemble } from "../../dist/src/hack/asm.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJackDir(dir) {
  return readdirSync(join(root, dir)).filter((f) => f.endsWith(".jack")).sort()
    .map((f) => ({ name: `${dir}/${f}`, src: readFileSync(join(root, dir, f), "utf8") }));
}

export function buildRom({ osDir = "os", gameDirs = ["tetris"] } = {}) {
  const sources = [osDir, ...gameDirs].flatMap(readJackDir);
  const { vms, errors } = compileProgram(sources);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => `compile error: line ${e.line}: ${e.msg}`).join("\n"));
  }
  let combined = translateVm([], { module: "Sys", bootstrap: true });
  for (const { className, vm } of vms) {
    const { commands, errors: perr } = parseVm(vm);
    if (perr.length > 0) throw new Error(`vm parse error in ${className}: ${perr[0].msg}`);
    combined += translateVm(commands, { module: className });
  }
  const r = assemble(combined);
  if (r.errors.length > 0) {
    throw new Error(r.errors.map((e) => `asm error line ${e.line}: ${e.msg}`).join("\n"));
  }
  return { words: r.words, symbols: r.symbols, asmSource: combined };
}
