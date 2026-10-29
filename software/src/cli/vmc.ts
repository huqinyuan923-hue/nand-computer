/**
 * vmc CLI: translate stack VM code from stdin to Hack assembly on stdout.
 * Usage: node vmc.js [--module NAME] [--bootstrap] [--to-hack] < in.vm
 *   --module NAME   module name for statics/label prefixes (default: "Main")
 *   --bootstrap     emit SP=256 + call Sys.init preamble (full-program builds)
 *   --to-hack       assemble the output too and emit .hack binary text instead
 */

import { parseVm } from "../vm/parse";
import { translateVm } from "../vm/translate";
import { assemble, wordsToHack } from "../hack/asm";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let module = "Main";
  let bootstrap = false;
  let toHack = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--module": module = args[++i]; break;
      case "--bootstrap": bootstrap = true; break;
      case "--to-hack": toHack = true; break;
      default: throw new Error(`unknown option: ${args[i]}`);
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const src = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  const { commands, errors } = parseVm(src);
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`<stdin>:${e.line}: error: ${e.msg}\n`);
    return 1;
  }
  const asm = translateVm(commands, { module, bootstrap });
  if (toHack) {
    const r = assemble(asm);
    if (r.errors.length > 0) {
      for (const e of r.errors) process.stderr.write(`internal asm error: ${e.line}: ${e.msg}\n`);
      return 1;
    }
    process.stdout.write(wordsToHack(r.words));
  } else {
    process.stdout.write(asm);
  }
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
